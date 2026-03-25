import { describe, expect, it } from "vitest";
import { parseQuoteCandidate } from "../src/services/quoteParser";

describe("parseQuoteCandidate", () => {
  it("parses complete JSON quote payload", () => {
    const input = JSON.stringify({
      priceMin: 900,
      priceMax: 1200,
      currency: "USD",
      timelineDays: 5,
      notes: "Includes labor and materials",
      confidence: 0.81,
      isComplete: true
    });

    const quote = parseQuoteCandidate(input);

    expect(quote.priceMin).toBe(900);
    expect(quote.priceMax).toBe(1200);
    expect(quote.timelineDays).toBe(5);
    expect(quote.currency).toBe("USD");
    expect(quote.isComplete).toBe(true);
    expect(quote.confidence).toBeCloseTo(0.81, 2);
  });

  it("returns partial quote when fields are missing", () => {
    const input = JSON.stringify({ notes: "Need site visit first", confidence: 0.4 });
    const quote = parseQuoteCandidate(input);

    expect(quote.priceMin).toBeNull();
    expect(quote.timelineDays).toBeNull();
    expect(quote.notes).toContain("Need site visit");
    expect(quote.isComplete).toBe(false);
  });

  it("falls back safely on malformed JSON", () => {
    const quote = parseQuoteCandidate("{ malformed");

    expect(quote.isComplete).toBe(false);
    expect(quote.priceMin).toBeNull();
    expect(quote.notes).toContain("{ malformed");
  });
});
