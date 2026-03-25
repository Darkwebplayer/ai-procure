import { config } from "../config";
import { appDb, type VendorRow } from "../db";
import { ensureGeminiLiveReady, normalizeQuery } from "./gemini";
import { discoverVendors } from "./googleMaps";
import { computeRankingEntries } from "./ranking";
import { placeOutboundCall } from "./twilioVoice";

const terminalVendorStates = new Set(["responded", "failed", "skipped"]);
const activeVendorStates = new Set(["queued", "calling"]);

const baseUrl = (): string => config.publicBaseUrl || `http://localhost:${config.port}`;

const numberFromHash = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

class Orchestrator {
  private inProgress = new Set<string>();
  private advancingJobs = new Set<string>();
  private readonly primaryCallCount = 3;

  enqueue(jobId: string): void {
    if (this.inProgress.has(jobId)) return;

    this.inProgress.add(jobId);
    setImmediate(() => {
      this.process(jobId)
        .catch((error) => {
          console.error("Orchestrator error", { jobId, error });
          appDb.setJobStatus(jobId, "failed");
        })
        .finally(() => {
          this.inProgress.delete(jobId);
        });
    });
  }

  async process(jobId: string): Promise<void> {
    const job = appDb.getJobOrThrow(jobId);

    appDb.setJobStatus(jobId, "processing");

    const normalized = await normalizeQuery(job.request_text, job.location_text);
    appDb.setNormalizedQuery(jobId, normalized.searchQuery);

    const vendorCandidates = await discoverVendors({
      searchQuery: normalized.searchQuery,
      locationText: job.location_text,
      limit: config.maxVendorCalls
    });

    if (vendorCandidates.length === 0) {
      appDb.setJobStatus(jobId, "failed");
      return;
    }

    const vendors = appDb.insertVendors(jobId, vendorCandidates);

    if (config.mockMode) {
      await this.runMock(jobId, vendors, job.request_text);
      return;
    }

    if (config.twilioVoiceMode === "live_stream") {
      const preflight = await ensureGeminiLiveReady(true);
      if (!preflight.ok) {
        console.error("Gemini live preflight failed before starting outbound calls", { jobId, reason: preflight.reason });
        appDb.setJobStatus(jobId, "failed");
        return;
      }
    }

    appDb.setJobStatus(jobId, "calling");
    this.evaluateCompletion(jobId);
  }

  async runMock(jobId: string, vendors: VendorRow[], requestText: string): Promise<void> {
    appDb.setJobStatus(jobId, "calling");

    const job = appDb.getJobOrThrow(jobId);
    const target = this.minimumDesiredQuotes(job.target_quotes);
    let completedQuotes = 0;

    for (const vendor of vendors.slice(0, config.maxVendorCalls)) {
      if (completedQuotes >= target) {
        appDb.updateVendorStatus(vendor.id, "skipped");
        continue;
      }

      appDb.updateVendorStatus(vendor.id, "calling");
      const attempt = appDb.createCallAttempt(jobId, vendor.id, "answered");

      const seed = numberFromHash(vendor.id);
      const basePrice = 300 + (seed % 1200);
      const spread = 150 + (seed % 300);
      const timelineDays = 2 + (seed % 12);
      const confidence = 0.65 + (seed % 30) / 100;

      appDb.addConversationTurn(attempt.id, 1, "agent", `Hello, this is VoiceProcure calling about ${requestText}.`);
      appDb.addConversationTurn(
        attempt.id,
        1,
        "vendor",
        `We can do this for around ${basePrice}-${basePrice + spread} USD, timeline ${timelineDays} days.`
      );

      appDb.upsertQuote(jobId, vendor.id, {
        priceMin: basePrice,
        priceMax: basePrice + spread,
        currency: "USD",
        timelineDays,
        notes: `Mock quote from ${vendor.name}`,
        confidence: Number(Math.min(confidence, 0.99).toFixed(2)),
        isComplete: true
      });

      appDb.setCallAttemptStatus(attempt.id, "completed");
      appDb.updateVendorStatus(vendor.id, "responded");
      completedQuotes += 1;
      this.recomputeRankings(jobId);
    }

    appDb.setJobStatus(jobId, "completed");
  }

  recomputeRankings(jobId: string): void {
    const vendors = appDb.listVendors(jobId);
    const quotes = appDb.getQuotesForJob(jobId);
    const vendorMap = new Map(vendors.map((v) => [v.id, v]));

    const entries = computeRankingEntries(quotes, vendorMap, {
      confidenceThreshold: config.confidenceThreshold,
      limit: config.targetQuotes
    });

    appDb.replaceRankings(jobId, entries);
  }

  private minimumDesiredQuotes(jobTargetQuotes: number): number {
    return Math.max(1, Math.min(jobTargetQuotes, this.primaryCallCount));
  }

  private hasActiveCall(vendors: VendorRow[]): boolean {
    return vendors.some((vendor) => activeVendorStates.has(vendor.status));
  }

  private selectNextVendor(vendors: VendorRow[], completedQuotes: number, minimumDesired: number): VendorRow | null {
    const primarySlice = vendors.slice(0, Math.min(this.primaryCallCount, vendors.length));
    const primaryPending = primarySlice.find((vendor) => vendor.status === "pending");
    if (primaryPending) {
      return primaryPending;
    }

    if (completedQuotes >= minimumDesired) {
      return null;
    }

    return vendors.find((vendor, idx) => idx >= this.primaryCallCount && vendor.status === "pending") ?? null;
  }

  private skipRemainingPending(vendors: VendorRow[]): void {
    for (const vendor of vendors) {
      if (vendor.status === "pending") {
        appDb.updateVendorStatus(vendor.id, "skipped");
      }
    }
  }

  private async startCall(jobId: string, vendor: VendorRow): Promise<boolean> {
    appDb.updateVendorStatus(vendor.id, "queued");
    const attempt = appDb.createCallAttempt(jobId, vendor.id, "queued");

    try {
      const call = await placeOutboundCall({
        to: vendor.phone,
        jobId,
        vendorId: vendor.id,
        attemptId: attempt.id,
        baseUrl: baseUrl()
      });

      appDb.attachCallSid(attempt.id, call.sid);
      appDb.setCallAttemptStatus(attempt.id, "initiated");
      appDb.updateVendorStatus(vendor.id, "calling");
      return true;
    } catch (error) {
      appDb.setCallAttemptStatus(attempt.id, "failed", String(error));
      appDb.updateVendorStatus(vendor.id, "failed");
      return false;
    }
  }

  private async evaluateCompletionInternal(jobId: string): Promise<void> {
    const job = appDb.getJob(jobId);
    if (!job) return;

    while (true) {
      this.recomputeRankings(jobId);

      const completedQuotes = appDb.countCompletedQuotes(jobId, config.confidenceThreshold);
      const minimumDesired = this.minimumDesiredQuotes(job.target_quotes);
      const vendors = appDb.listVendors(jobId);

      if (completedQuotes >= minimumDesired) {
        this.skipRemainingPending(vendors);
        appDb.setJobStatus(jobId, "completed");
        return;
      }

      if (this.hasActiveCall(vendors)) {
        appDb.setJobStatus(jobId, "calling");
        return;
      }

      const allTerminal = vendors.length > 0 && vendors.every((vendor) => terminalVendorStates.has(vendor.status));
      if (allTerminal) {
        appDb.setJobStatus(jobId, "completed");
        return;
      }

      const nextVendor = this.selectNextVendor(vendors, completedQuotes, minimumDesired);
      if (!nextVendor) {
        appDb.setJobStatus(jobId, "completed");
        return;
      }

      const started = await this.startCall(jobId, nextVendor);
      if (started) {
        appDb.setJobStatus(jobId, "calling");
        return;
      }
    }
  }

  evaluateCompletion(jobId: string): void {
    if (this.advancingJobs.has(jobId)) {
      return;
    }

    this.advancingJobs.add(jobId);
    void this.evaluateCompletionInternal(jobId)
      .catch((error) => {
        console.error("Completion evaluation failed", { jobId, error });
        appDb.setJobStatus(jobId, "failed");
      })
      .finally(() => {
        this.advancingJobs.delete(jobId);
      });
  }
}

export const orchestrator = new Orchestrator();
