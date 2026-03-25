import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { appDb } from "../db";
import { generateIntakeQuestions } from "../services/gemini";
import { buildRequestWithAnswers } from "../services/intake";
import { orchestrator } from "../services/orchestrator";
import { enrichTopQuotes } from "../services/ranking";
import type { JobInput } from "../types";

export const apiRouter = Router();
const parseReviewSnippets = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0);
  } catch {
    return [];
  }
};

apiRouter.post("/questionnaire", async (req, res) => {
  const body = req.body as Partial<JobInput>;

  if (!body.requestText?.trim() || !body.locationText?.trim()) {
    return res.status(400).json({ error: "requestText and locationText are required" });
  }

  try {
    const result = await generateIntakeQuestions(body.requestText, body.locationText);
    return res.json({ source: result.source, questions: result.questions });
  } catch (error) {
    return res.status(502).json({ error: "Failed to generate questionnaire with AI", details: String(error) });
  }
});

apiRouter.post("/jobs", (req, res) => {
  const body = req.body as Partial<JobInput>;

  if (!body.requestText?.trim() || !body.locationText?.trim()) {
    return res.status(400).json({ error: "requestText and locationText are required" });
  }

  const targetQuotes = Math.max(1, Math.min(Number(body.maxQuotes ?? config.targetQuotes), 4));

  const enrichedRequest = buildRequestWithAnswers(body.requestText, body.questionnaireAnswers);

  const job = appDb.createJob(
    {
      requestText: enrichedRequest,
      locationText: body.locationText,
      maxQuotes: targetQuotes
    },
    targetQuotes
  );

  orchestrator.enqueue(job.id);

  return res.status(202).json({ jobId: job.id, status: "queued" });
});

apiRouter.get("/jobs/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = appDb.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const vendors = appDb.listVendors(jobId);
  const topQuotes = enrichTopQuotes(appDb.getTopRankedQuotes(jobId, job.target_quotes));
  const attemptsSummary = appDb.getAttemptsSummary(jobId);

  const progress = {
    vendorsFound: vendors.length,
    vendorsResponded: vendors.filter((v) => v.status === "responded").length,
    vendorsFailed: vendors.filter((v) => v.status === "failed").length,
    quotesCollected: topQuotes.length,
    targetQuotes: job.target_quotes
  };

  return res.json({
    job,
    progress,
    topQuotes,
    attemptsSummary
  });
});

apiRouter.get("/jobs/:jobId/vendors", (req, res) => {
  const { jobId } = req.params;
  const job = appDb.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const vendors = appDb.listVendors(jobId);
  const quotes = appDb.getQuotesForJob(jobId);

  const quoteMap = new Map(quotes.map((q) => [q.vendor_id, q]));

  const response = vendors.map((vendor) => {
    const quote = quoteMap.get(vendor.id);
    return {
      ...vendor,
      reviewCount: Number(vendor.review_count ?? 0),
      reviewSnippets: parseReviewSnippets(vendor.reviews_text),
      quote: quote
        ? {
            priceMin: quote.price_min,
            priceMax: quote.price_max,
            currency: quote.currency,
            timelineDays: quote.timeline_days,
            confidence: quote.confidence,
            isComplete: Boolean(quote.is_complete),
            notes: quote.notes
          }
        : null
    };
  });

  return res.json({ vendors: response });
});

apiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, id: randomUUID() });
});
