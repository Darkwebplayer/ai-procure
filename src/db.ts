import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { JobInput, JobStatus, QuotePayload, QuoteRow, RankedQuote, VendorCandidate, VendorStatus } from "./types";

type DatabaseSyncType = import("node:sqlite").DatabaseSync;
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};

interface JobRow {
  id: string;
  request_text: string;
  location_text: string;
  status: JobStatus;
  target_quotes: number;
  normalized_query: string | null;
  created_at: string;
  completed_at: string | null;
}

interface VendorRow {
  id: string;
  job_id: string;
  place_id: string;
  name: string;
  phone: string;
  address: string | null;
  rating: number | null;
  review_count: number | null;
  reviews_text: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  status: VendorStatus;
  created_at: string;
}

interface CallAttemptRow {
  id: string;
  job_id: string;
  vendor_id: string;
  twilio_call_sid: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  failure_reason: string | null;
}

interface RankingInput {
  vendorId: string;
  priceScore: number;
  ratingScore: number;
  distanceScore: number;
  totalScore: number;
  rank: number;
}

export class AppDb {
  private readonly db: DatabaseSyncType;

  constructor() {
    this.db = new DatabaseSync(config.dbPath);
    this.runMigrations();
  }

  private runMigrations(): void {
    const schemaPath = path.resolve(process.cwd(), "src/schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");
    this.db.exec(schemaSql);
    this.ensureColumn("vendors", "review_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("vendors", "reviews_text", "TEXT NOT NULL DEFAULT '[]'");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const exists = columns.some((row) => row.name === column);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  createJob(input: JobInput, targetQuotes: number): JobRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO jobs (id, request_text, location_text, status, target_quotes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, input.requestText.trim(), input.locationText.trim(), "queued", targetQuotes, now);
    return this.getJobOrThrow(id);
  }

  getJob(jobId: string): JobRow | null {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`);
    return (stmt.get(jobId) as JobRow | undefined) ?? null;
  }

  getJobOrThrow(jobId: string): JobRow {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return job;
  }

  setJobStatus(jobId: string, status: JobStatus): void {
    const now = new Date().toISOString();
    const isTerminal = status === "completed" || status === "failed";

    const stmt = this.db.prepare(
      `UPDATE jobs
       SET status = ?, completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
           normalized_query = normalized_query
       WHERE id = ?`
    );
    stmt.run(status, isTerminal ? 1 : 0, now, jobId);
  }

  setNormalizedQuery(jobId: string, normalizedQuery: string): void {
    const stmt = this.db.prepare(`UPDATE jobs SET normalized_query = ? WHERE id = ?`);
    stmt.run(normalizedQuery, jobId);
  }

  insertVendors(jobId: string, vendors: VendorCandidate[]): VendorRow[] {
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO vendors (id, job_id, place_id, name, phone, address, rating, review_count, reviews_text, lat, lng, distance_km, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.db.exec("BEGIN");
    try {
      for (const vendor of vendors) {
        insert.run(
          randomUUID(),
          jobId,
          vendor.placeId,
          vendor.name,
          vendor.phone,
          vendor.address,
          vendor.rating,
          vendor.reviewCount,
          JSON.stringify(vendor.reviewSnippets ?? []),
          vendor.lat,
          vendor.lng,
          vendor.distanceKm,
          "pending",
          now
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.listVendors(jobId);
  }

  listVendors(jobId: string): VendorRow[] {
    const stmt = this.db.prepare(`SELECT * FROM vendors WHERE job_id = ? ORDER BY rating DESC, distance_km ASC`);
    return stmt.all(jobId) as unknown as VendorRow[];
  }

  getVendor(vendorId: string): VendorRow | null {
    const stmt = this.db.prepare(`SELECT * FROM vendors WHERE id = ?`);
    return (stmt.get(vendorId) as unknown as VendorRow | undefined) ?? null;
  }

  updateVendorStatus(vendorId: string, status: VendorStatus): void {
    const stmt = this.db.prepare(`UPDATE vendors SET status = ? WHERE id = ?`);
    stmt.run(status, vendorId);
  }

  createCallAttempt(jobId: string, vendorId: string, status = "queued"): CallAttemptRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO call_attempts (id, job_id, vendor_id, status, started_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(id, jobId, vendorId, status, now);
    return this.getCallAttemptOrThrow(id);
  }

  getCallAttemptBySid(callSid: string): CallAttemptRow | null {
    const stmt = this.db.prepare(`SELECT * FROM call_attempts WHERE twilio_call_sid = ?`);
    return (stmt.get(callSid) as unknown as CallAttemptRow | undefined) ?? null;
  }

  getCallAttempt(attemptId: string): CallAttemptRow | null {
    const stmt = this.db.prepare(`SELECT * FROM call_attempts WHERE id = ?`);
    return (stmt.get(attemptId) as unknown as CallAttemptRow | undefined) ?? null;
  }

  getCallAttemptOrThrow(attemptId: string): CallAttemptRow {
    const row = this.getCallAttempt(attemptId);
    if (!row) {
      throw new Error(`Call attempt not found: ${attemptId}`);
    }
    return row;
  }

  attachCallSid(attemptId: string, callSid: string): void {
    const stmt = this.db.prepare(`UPDATE call_attempts SET twilio_call_sid = ? WHERE id = ?`);
    stmt.run(callSid, attemptId);
  }

  setCallAttemptStatus(attemptId: string, status: string, failureReason?: string): void {
    const terminal = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE call_attempts
       SET status = ?,
           ended_at = CASE WHEN ? THEN ? ELSE ended_at END,
           failure_reason = COALESCE(?, failure_reason)
       WHERE id = ?`
    );
    stmt.run(status, terminal.has(status) ? 1 : 0, now, failureReason ?? null, attemptId);
  }

  addConversationTurn(callAttemptId: string, turnIndex: number, speaker: "agent" | "vendor", text: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO conversation_turns (id, call_attempt_id, turn_index, speaker, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmt.run(randomUUID(), callAttemptId, turnIndex, speaker, text, new Date().toISOString());
  }

  getConversationTurns(callAttemptId: string): Array<{ turn_index: number; speaker: string; text: string }> {
    const stmt = this.db.prepare(
      `SELECT turn_index, speaker, text
       FROM conversation_turns
       WHERE call_attempt_id = ?
       ORDER BY turn_index ASC, created_at ASC`
    );
    return stmt.all(callAttemptId) as unknown as Array<{ turn_index: number; speaker: string; text: string }>;
  }

  hasVendorSpeech(callAttemptId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 as ok
       FROM conversation_turns
       WHERE call_attempt_id = ? AND speaker = 'vendor'
       LIMIT 1`
    );
    const row = stmt.get(callAttemptId) as { ok: number } | undefined;
    return Boolean(row?.ok);
  }

  upsertQuote(jobId: string, vendorId: string, quote: QuotePayload): QuoteRow {
    const existing = this.db
      .prepare(`SELECT * FROM quotes WHERE vendor_id = ?`)
      .get(vendorId) as unknown as QuoteRow | undefined;

    const now = new Date().toISOString();

    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO quotes (id, job_id, vendor_id, price_min, price_max, currency, timeline_days, notes, confidence, is_complete, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          jobId,
          vendorId,
          quote.priceMin,
          quote.priceMax,
          quote.currency,
          quote.timelineDays,
          quote.notes,
          quote.confidence,
          quote.isComplete ? 1 : 0,
          now,
          now
        );
    } else {
      this.db
        .prepare(
          `UPDATE quotes
           SET price_min = COALESCE(?, price_min),
               price_max = COALESCE(?, price_max),
               currency = COALESCE(?, currency),
               timeline_days = COALESCE(?, timeline_days),
               notes = ?,
               confidence = ?,
               is_complete = ?,
               updated_at = ?
           WHERE vendor_id = ?`
        )
        .run(
          quote.priceMin,
          quote.priceMax,
          quote.currency,
          quote.timelineDays,
          quote.notes,
          quote.confidence,
          quote.isComplete ? 1 : 0,
          now,
          vendorId
        );
    }

    return this.db.prepare(`SELECT * FROM quotes WHERE vendor_id = ?`).get(vendorId) as unknown as QuoteRow;
  }

  getQuotesForJob(jobId: string): QuoteRow[] {
    const stmt = this.db.prepare(`SELECT * FROM quotes WHERE job_id = ? ORDER BY updated_at DESC`);
    return stmt.all(jobId) as unknown as QuoteRow[];
  }

  replaceRankings(jobId: string, entries: RankingInput[]): void {
    const now = new Date().toISOString();
    const del = this.db.prepare(`DELETE FROM rankings WHERE job_id = ?`);
    const ins = this.db.prepare(
      `INSERT INTO rankings (id, job_id, vendor_id, price_score, rating_score, distance_score, total_score, rank, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.db.exec("BEGIN");
    try {
      del.run(jobId);
      for (const row of entries) {
        ins.run(
          randomUUID(),
          jobId,
          row.vendorId,
          row.priceScore,
          row.ratingScore,
          row.distanceScore,
          row.totalScore,
          row.rank,
          now
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getTopRankedQuotes(jobId: string, limit: number): RankedQuote[] {
    const stmt = this.db.prepare(
      `SELECT
         r.vendor_id AS vendorId,
         v.name AS vendorName,
         v.phone AS phone,
         COALESCE(v.rating, 0) AS rating,
         COALESCE(v.distance_km, 999) AS distanceKm,
         q.id AS quoteId,
         q.price_min AS priceMin,
         q.price_max AS priceMax,
         q.currency AS currency,
         q.timeline_days AS timelineDays,
         q.notes AS notes,
         q.confidence AS confidence,
         r.price_score AS priceScore,
         r.rating_score AS ratingScore,
         r.distance_score AS distanceScore,
         r.total_score AS totalScore,
         r.rank AS rank
       FROM rankings r
       JOIN vendors v ON v.id = r.vendor_id
       JOIN quotes q ON q.vendor_id = r.vendor_id
       WHERE r.job_id = ?
       ORDER BY r.rank ASC
       LIMIT ?`
    );
    return stmt.all(jobId, limit) as unknown as RankedQuote[];
  }

  getAttemptsSummary(jobId: string): Array<{ status: string; count: number }> {
    const stmt = this.db.prepare(
      `SELECT status, COUNT(*) as count
       FROM call_attempts
       WHERE job_id = ?
       GROUP BY status`
    );
    return stmt.all(jobId) as unknown as Array<{ status: string; count: number }>;
  }

  countCompletedQuotes(jobId: string, confidenceThreshold: number): number {
    const stmt = this.db.prepare(
      `SELECT COUNT(*) as count
       FROM quotes
       WHERE job_id = ? AND is_complete = 1 AND confidence >= ?`
    );
    const row = stmt.get(jobId, confidenceThreshold) as unknown as { count: number };
    return row.count;
  }
}

export const appDb = new AppDb();

export type { JobRow, VendorRow, CallAttemptRow, RankingInput };
