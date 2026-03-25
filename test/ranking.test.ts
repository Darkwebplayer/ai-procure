import { describe, expect, it } from "vitest";
import { computeRankingEntries } from "../src/services/ranking";
import type { QuoteRow } from "../src/types";

const now = new Date().toISOString();

describe("computeRankingEntries", () => {
  it("ranks by weighted price, rating, distance deterministically", () => {
    const quotes: QuoteRow[] = [
      {
        id: "q1",
        job_id: "j1",
        vendor_id: "v1",
        price_min: 900,
        price_max: 1100,
        currency: "USD",
        timeline_days: 5,
        notes: "",
        confidence: 0.9,
        is_complete: 1,
        created_at: now,
        updated_at: now
      },
      {
        id: "q2",
        job_id: "j1",
        vendor_id: "v2",
        price_min: 1200,
        price_max: 1300,
        currency: "USD",
        timeline_days: 4,
        notes: "",
        confidence: 0.9,
        is_complete: 1,
        created_at: now,
        updated_at: now
      },
      {
        id: "q3",
        job_id: "j1",
        vendor_id: "v3",
        price_min: 1000,
        price_max: 1200,
        currency: "USD",
        timeline_days: 6,
        notes: "",
        confidence: 0.9,
        is_complete: 1,
        created_at: now,
        updated_at: now
      }
    ];

    const vendors = new Map([
      ["v1", { id: "v1", rating: 4.2, distance_km: 6 }],
      ["v2", { id: "v2", rating: 4.9, distance_km: 2 }],
      ["v3", { id: "v3", rating: 3.9, distance_km: 1 }]
    ] as Array<[string, any]>);

    const ranked = computeRankingEntries(quotes, vendors, {
      confidenceThreshold: 0.55,
      limit: 3
    });

    expect(ranked).toHaveLength(3);
    expect(ranked[0].vendorId).toBe("v1");
    expect(ranked[1].vendorId).toBe("v3");
    expect(ranked[2].vendorId).toBe("v2");
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
