import type { QuotePayload } from "../types";

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseHumanPrice = (text: string): { priceMin: number | null; priceMax: number | null; currency: string | null } => {
  const compact = text.replace(/,/g, "");
  const inrHint = /\b(rs|inr|rupees?)\b/i.test(text);
  const usdHint = /\busd|\$\b/i.test(text);
  const priceHint = /\b(price|cost|quote|charge|estimate|budget)\b/i.test(text) || inrHint || usdHint;
  const currency = inrHint ? "INR" : usdHint ? "USD" : null;

  if (!priceHint) {
    return { priceMin: null, priceMax: null, currency };
  }

  const rangeMatch =
    compact.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/i) ??
    compact.match(/between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i);

  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return {
        priceMin: Math.min(a, b),
        priceMax: Math.max(a, b),
        currency
      };
    }
  }

  const singleMatch = compact.match(/(?:about|around|roughly|approx(?:imately)?)?\s*(\d{2,7}(?:\.\d+)?)/i);
  if (!singleMatch) {
    return { priceMin: null, priceMax: null, currency };
  }

  const value = Number(singleMatch[1]);
  if (!Number.isFinite(value)) {
    return { priceMin: null, priceMax: null, currency };
  }

  return { priceMin: value, priceMax: value, currency };
};

const parseHumanTimelineDays = (text: string): number | null => {
  const lower = text.toLowerCase();
  const dayMatch = lower.match(/(\d+)\s*(day|days)/);
  if (dayMatch) return Number(dayMatch[1]);

  const weekMatch = lower.match(/(\d+)\s*(week|weeks)/);
  if (weekMatch) return Number(weekMatch[1]) * 7;

  const monthMatch = lower.match(/(\d+)\s*(month|months)/);
  if (monthMatch) return Number(monthMatch[1]) * 30;

  if (/\bnext day\b/.test(lower)) return 1;
  if (/\btomorrow\b/.test(lower)) return 1;
  if (/\bthis week\b/.test(lower)) return 7;

  return null;
};

const extractJsonObject = (input: string): string | null => {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return input.slice(start, end + 1);
};

export const parseQuoteCandidate = (text: string): QuotePayload => {
  const humanPrice = parseHumanPrice(text);
  const humanTimelineDays = parseHumanTimelineDays(text);
  const humanHasPrice = humanPrice.priceMin !== null || humanPrice.priceMax !== null;
  const humanIsComplete = Boolean(humanHasPrice && humanTimelineDays !== null);
  const humanConfidence = humanIsComplete ? 0.7 : humanHasPrice || humanTimelineDays !== null ? 0.45 : 0.2;

  const fallback: QuotePayload = {
    priceMin: humanPrice.priceMin,
    priceMax: humanPrice.priceMax,
    currency: humanPrice.currency,
    timelineDays: humanTimelineDays,
    notes: text.trim().slice(0, 500),
    confidence: humanConfidence,
    isComplete: humanIsComplete
  };

  const jsonChunk = extractJsonObject(text);
  if (!jsonChunk) return fallback;

  try {
    const parsed = JSON.parse(jsonChunk) as Record<string, unknown>;

    const priceMin = toNullableNumber(parsed.priceMin);
    const priceMax = toNullableNumber(parsed.priceMax);
    const timelineDays = toNullableNumber(parsed.timelineDays);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.4)));
    const notes = String(parsed.notes ?? "").trim();

    const hasPrice = priceMin !== null || priceMax !== null;
    const isComplete =
      typeof parsed.isComplete === "boolean"
        ? parsed.isComplete
        : Boolean(hasPrice && timelineDays !== null && confidence >= 0.55);

    return {
      priceMin,
      priceMax,
      currency: parsed.currency ? String(parsed.currency) : null,
      timelineDays,
      notes: notes || fallback.notes,
      confidence,
      isComplete
    };
  } catch {
    return fallback;
  }
};
