export type JobStatus = "queued" | "processing" | "calling" | "completed" | "failed";
export type VendorStatus = "pending" | "queued" | "calling" | "responded" | "failed" | "skipped";

export interface JobInput {
  requestText: string;
  locationText: string;
  maxQuotes?: number;
  questionnaireAnswers?: QuestionnaireAnswer[];
}

export interface QuestionnaireQuestion {
  id: string;
  prompt: string;
  placeholder: string;
  required: boolean;
  options: string[];
  allowCustomAnswer?: boolean;
}

export interface QuestionnaireAnswer {
  questionId: string;
  prompt: string;
  answer: string;
}

export interface VendorCandidate {
  placeId: string;
  name: string;
  phone: string;
  address: string;
  rating: number;
  reviewCount: number;
  reviewSnippets: string[];
  lat: number;
  lng: number;
  distanceKm: number;
}

export interface QuotePayload {
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  timelineDays: number | null;
  notes: string;
  confidence: number;
  isComplete: boolean;
}

export interface QuoteRow {
  id: string;
  job_id: string;
  vendor_id: string;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  timeline_days: number | null;
  notes: string;
  confidence: number;
  is_complete: number;
  created_at: string;
  updated_at: string;
}

export interface RankedQuote {
  vendorId: string;
  vendorName: string;
  phone: string;
  rating: number;
  distanceKm: number;
  quoteId: string;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  timelineDays: number | null;
  notes: string;
  confidence: number;
  priceScore: number;
  ratingScore: number;
  distanceScore: number;
  totalScore: number;
  rank: number;
}
