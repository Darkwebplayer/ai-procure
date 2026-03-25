import type { QuoteRow, RankedQuote } from "../types";
import type { RankingInput, VendorRow } from "../db";

interface RankOptions {
  confidenceThreshold: number;
  limit: number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const positiveTerms = [
  "professional",
  "recommended",
  "excellent",
  "great",
  "quality",
  "on time",
  "responsive",
  "affordable",
  "honest"
];
const negativeTerms = ["late", "delay", "poor", "bad", "expensive", "unprofessional", "no response", "overcharge"];

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

const reviewSentimentScore = (snippets: string[]): number => {
  if (snippets.length === 0) return 0.5;

  let positive = 0;
  let negative = 0;

  for (const snippet of snippets) {
    const text = snippet.toLowerCase();
    for (const term of positiveTerms) {
      if (text.includes(term)) positive += 1;
    }
    for (const term of negativeTerms) {
      if (text.includes(term)) negative += 1;
    }
  }

  const denominator = Math.max(1, snippets.length * 3);
  return clamp(0.5 + (positive - negative) / denominator);
};

const avgPrice = (quote: QuoteRow): number | null => {
  if (quote.price_min !== null && quote.price_max !== null) {
    return (quote.price_min + quote.price_max) / 2;
  }
  return quote.price_min ?? quote.price_max ?? null;
};

export const computeRankingEntries = (
  quotes: QuoteRow[],
  vendorsById: Map<string, VendorRow>,
  options: RankOptions
): RankingInput[] => {
  const filtered = quotes.filter((q) => Number(q.is_complete) === 1 && q.confidence >= options.confidenceThreshold);
  if (filtered.length === 0) return [];

  const prices = filtered.map(avgPrice).filter((n): n is number => n !== null);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  const rankRows = filtered.map((quote) => {
    const vendor = vendorsById.get(quote.vendor_id);
    const priceValue = avgPrice(quote);
    let priceScore = 0.5;

    if (priceValue !== null) {
      if (maxPrice === minPrice) {
        priceScore = 1;
      } else {
        priceScore = clamp((maxPrice - priceValue) / (maxPrice - minPrice));
      }
    }

    const rating = vendor?.rating ?? 0;
    const ratingScore = clamp(rating / 5);
    const reviewCount = Math.max(0, Number(vendor?.review_count ?? 0));
    const reviewVolumeScore = clamp(Math.log10(1 + reviewCount) / 3);
    const sentimentScore = reviewSentimentScore(parseReviewSnippets(vendor?.reviews_text));
    const reviewQualityScore = ratingScore * 0.6 + reviewVolumeScore * 0.25 + sentimentScore * 0.15;
    const distanceKm = vendor?.distance_km ?? 50;
    const distanceScore = clamp(1 - Math.min(distanceKm, 50) / 50);

    const totalScore = priceScore * 0.5 + reviewQualityScore * 0.35 + distanceScore * 0.15;

    return {
      vendorId: quote.vendor_id,
      priceScore,
      ratingScore: reviewQualityScore,
      distanceScore,
      totalScore
    };
  });

  rankRows.sort((a, b) => b.totalScore - a.totalScore);

  return rankRows.slice(0, options.limit).map((row, idx) => ({ ...row, rank: idx + 1 }));
};

export const enrichTopQuotes = (ranked: RankedQuote[]): RankedQuote[] => {
  return ranked
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((row) => ({
      ...row,
      totalScore: Number(row.totalScore.toFixed(4)),
      priceScore: Number(row.priceScore.toFixed(4)),
      ratingScore: Number(row.ratingScore.toFixed(4)),
      distanceScore: Number(row.distanceScore.toFixed(4))
    }));
};
