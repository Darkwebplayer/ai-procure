import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("discoverVendors", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    process.env.GOOGLE_MAPS_API_KEY = "test";
    process.env.GEMINI_API_KEY = "test";
    process.env.MOCK_MODE = "true";
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("filters out vendors without phone numbers", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ geometry: { location: { lat: 30.2672, lng: -97.7431 } } }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              place_id: "p1",
              name: "No Phone LLC",
              rating: 4.4,
              formatted_address: "A",
              geometry: { location: { lat: 30.26, lng: -97.74 } }
            },
            {
              place_id: "p2",
              name: "Phone Vendor",
              rating: 4.8,
              formatted_address: "B",
              geometry: { location: { lat: 30.27, lng: -97.75 } }
            }
          ]
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: {} }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { formatted_phone_number: "(512) 555-9876" } })
      });

    const { discoverVendors } = await import("../src/services/googleMaps");

    const vendors = await discoverVendors({
      searchQuery: "roofing",
      locationText: "Austin, TX",
      limit: 2
    });

    expect(vendors).toHaveLength(1);
    expect(vendors[0].name).toBe("Phone Vendor");
    expect(vendors[0].phone).toBe("5125559876");
  });
});
