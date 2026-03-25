import path from "node:path";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/gemini", () => ({
  normalizeQuery: vi.fn(),
  generateAgentTurn: vi.fn().mockResolvedValue({
    agentReply: "Thanks, that is enough for now.",
    isComplete: true,
    quote: {
      priceMin: 850,
      priceMax: 1100,
      currency: "USD",
      timelineDays: 4,
      notes: "Includes labor",
      confidence: 0.82,
      isComplete: true
    }
  })
}));

describe("Twilio webhook voice loop", () => {
  let app: import("express").Express;
  let appDb: typeof import("../src/db").appDb;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DB_PATH = path.join(process.cwd(), `test-twilio-${Date.now()}.db`);
    process.env.GOOGLE_MAPS_API_KEY = "test";
    process.env.GEMINI_API_KEY = "test";
    process.env.MOCK_MODE = "true";
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";

    vi.resetModules();

    const serverModule = await import("../src/server");
    const dbModule = await import("../src/db");

    app = serverModule.createApp();
    appDb = dbModule.appDb;
  });

  it("captures speech and stores quote then completes call", async () => {
    const job = appDb.createJob({ requestText: "plumbing repair", locationText: "Dallas, TX" }, 4);
    const [vendor] = appDb.insertVendors(job.id, [
      {
        placeId: "p-1",
        name: "Vendor One",
        phone: "+15125550100",
        address: "123 Main St",
        rating: 4.5,
        reviewCount: 42,
        reviewSnippets: ["4/5: Good response and fair pricing"],
        lat: 30.2,
        lng: -97.8,
        distanceKm: 5.2
      }
    ]);

    const attempt = appDb.createCallAttempt(job.id, vendor.id, "queued");

    const introRes = await request(app)
      .post(`/twilio/voice/intro?jobId=${job.id}&vendorId=${vendor.id}&attemptId=${attempt.id}`)
      .type("form")
      .send({ CallSid: "CA111" });

    expect(introRes.status).toBe(200);
    expect(introRes.text).toContain("<Gather");

    const turnRes = await request(app)
      .post(`/twilio/voice/turn?jobId=${job.id}&vendorId=${vendor.id}&attemptId=${attempt.id}&turn=1`)
      .type("form")
      .send({ SpeechResult: "Price is around 900 to 1100 and we can start this week" });

    expect(turnRes.status).toBe(200);
    expect(turnRes.text).toContain("<Hangup");

    const quotes = appDb.getQuotesForJob(job.id);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].price_min).toBe(850);

    const updatedVendor = appDb.getVendor(vendor.id);
    expect(updatedVendor?.status).toBe("responded");
  });
});
