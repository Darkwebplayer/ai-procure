import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/googleMaps", () => ({
  discoverVendors: vi.fn().mockResolvedValue([
    {
      placeId: "g1",
      name: "Alpha Roofing",
      phone: "+15125550101",
      address: "1 A St",
      rating: 4.8,
      lat: 30.1,
      lng: -97.7,
      distanceKm: 2.1
    },
    {
      placeId: "g2",
      name: "Bravo Roofing",
      phone: "+15125550102",
      address: "2 B St",
      rating: 4.5,
      lat: 30.2,
      lng: -97.8,
      distanceKm: 5.4
    },
    {
      placeId: "g3",
      name: "Charlie Roofing",
      phone: "+15125550103",
      address: "3 C St",
      rating: 4.3,
      lat: 30.3,
      lng: -97.85,
      distanceKm: 7.1
    },
    {
      placeId: "g4",
      name: "Delta Roofing",
      phone: "+15125550104",
      address: "4 D St",
      rating: 4.1,
      lat: 30.4,
      lng: -97.9,
      distanceKm: 9.6
    }
  ])
}));

vi.mock("../src/services/gemini", () => ({
  normalizeQuery: vi.fn().mockResolvedValue({
    searchQuery: "roofing contractors",
    serviceCategory: "roofing"
  }),
  generateAgentTurn: vi.fn()
}));

describe("orchestrator mock mode", () => {
  let appDb: typeof import("../src/db").appDb;
  let orchestrator: typeof import("../src/services/orchestrator").orchestrator;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DB_PATH = path.join(process.cwd(), `test-mock-${Date.now()}.db`);
    process.env.GOOGLE_MAPS_API_KEY = "test";
    process.env.GEMINI_API_KEY = "test";
    process.env.MOCK_MODE = "true";
    process.env.TARGET_QUOTES = "4";

    vi.resetModules();

    const dbModule = await import("../src/db");
    const orchestrationModule = await import("../src/services/orchestrator");

    appDb = dbModule.appDb;
    orchestrator = orchestrationModule.orchestrator;
  });

  it("produces top ranked quotes without real Twilio calls", async () => {
    const job = appDb.createJob({ requestText: "roof replacement", locationText: "Austin, TX" }, 4);

    await orchestrator.process(job.id);

    const updated = appDb.getJob(job.id);
    expect(updated?.status).toBe("completed");

    const ranked = appDb.getTopRankedQuotes(job.id, 4);
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    expect(ranked.length).toBeLessThanOrEqual(4);
    expect(ranked[0].rank).toBe(1);
  });
});
