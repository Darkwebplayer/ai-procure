import path from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

const enqueueSpy = vi.fn();

vi.mock("../src/services/orchestrator", () => ({
  orchestrator: {
    enqueue: enqueueSpy,
    recomputeRankings: vi.fn(),
    evaluateCompletion: vi.fn(),
    process: vi.fn()
  }
}));

describe("POST /api/jobs", () => {
  let app: import("express").Express;
  let appDb: typeof import("../src/db").appDb;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DB_PATH = path.join(process.cwd(), `test-api-${Date.now()}.db`);
    process.env.GOOGLE_MAPS_API_KEY = "test";
    process.env.GEMINI_API_KEY = "test";
    process.env.MOCK_MODE = "true";

    vi.resetModules();

    const serverModule = await import("../src/server");
    const dbModule = await import("../src/db");

    app = serverModule.createApp();
    appDb = dbModule.appDb;
  });

  it("creates a job and schedules orchestration", async () => {
    const res = await request(app).post("/api/jobs").send({
      requestText: "roof repair",
      locationText: "Austin, TX",
      maxQuotes: 4
    });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    expect(enqueueSpy).toHaveBeenCalledWith(res.body.jobId);

    const job = appDb.getJob(res.body.jobId);
    expect(job?.request_text).toBe("roof repair");
    expect(job?.status).toBe("queued");
  });
});
