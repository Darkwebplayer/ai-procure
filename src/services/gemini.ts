import { GoogleGenAI, Modality } from "@google/genai";
import { config } from "../config";
import type { QuestionnaireQuestion, QuotePayload } from "../types";
import { parseQuoteCandidate } from "./quoteParser";
import { fallbackQuestionnaire } from "./intake";

interface GeminiContentPart {
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
  }>;
}

interface NormalizeQueryResponse {
  searchQuery: string;
  serviceCategory: string;
}

interface AgentTurnResponse {
  agentReply: string;
  isComplete: boolean;
  quote: {
    priceMin: number | null;
    priceMax: number | null;
    currency: string | null;
    timelineDays: number | null;
    notes: string;
    confidence: number;
    isComplete: boolean;
  };
}

interface QuestionnaireResponse {
  questions: Array<{
    id?: string;
    prompt?: string;
    placeholder?: string;
    required?: boolean;
    options?: string[];
    allowCustomAnswer?: boolean;
  }>;
}

interface QuestionnaireGenerationResult {
  source: "ai" | "fallback";
  questions: QuestionnaireQuestion[];
}

interface LivePreflightResult {
  ok: boolean;
  reason: string;
}

let livePreflightCache: { at: number; result: LivePreflightResult } | null = null;
let livePreflightInFlight: Promise<LivePreflightResult> | null = null;

const extractJson = (text: string): string => {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "{}";
  return cleaned.slice(start, end + 1);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const hasLiveOutput = (message: unknown): boolean => {
  const data = message as any;
  const outputText =
    typeof data?.serverContent?.outputTranscription?.text === "string"
      ? data.serverContent.outputTranscription.text
      : typeof data?.serverContent?.output_transcription?.text === "string"
        ? data.serverContent.output_transcription.text
        : "";

  if (outputText.trim().length > 0) {
    return true;
  }

  const parts =
    data?.serverContent?.modelTurn?.parts ??
    data?.server_content?.model_turn?.parts ??
    data?.modelTurn?.parts ??
    data?.model_turn?.parts ??
    [];

  return Array.isArray(parts)
    ? parts.some((part: any) => {
        const inlineData = part?.inlineData ?? part?.inline_data;
        const mimeType = String(
          inlineData?.mimeType || inlineData?.mime_type || part?.audio?.mimeType || part?.audio?.mime_type || ""
        );
        const payload = inlineData?.data ?? part?.audio?.data;
        return mimeType.startsWith("audio/pcm") && Boolean(payload);
      })
    : false;
};

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiTextModel}:generateContent?key=${config.geminiApiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

export async function ensureGeminiLiveReady(force = false): Promise<LivePreflightResult> {
  if (config.mockMode || config.twilioVoiceMode !== "live_stream") {
    return { ok: true, reason: "live preflight not required" };
  }

  const now = Date.now();
  if (
    !force &&
    livePreflightCache &&
    now - livePreflightCache.at < config.geminiLivePreflightCacheMs
  ) {
    return livePreflightCache.result;
  }

  if (!force && livePreflightInFlight) {
    return livePreflightInFlight;
  }

  livePreflightInFlight = (async () => {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    let session: { sendClientContent?: (payload: unknown) => void; close: () => void } | null = null;
    let resolved = false;

    const finish = (result: LivePreflightResult): LivePreflightResult => {
      if (!resolved) {
        resolved = true;
        try {
          session?.close();
        } catch {
          // noop
        }
      }
      return result;
    };

    try {
      const result = await new Promise<LivePreflightResult>(async (resolve) => {
        const timeout = setTimeout(() => {
          resolve(
            finish({
              ok: false,
              reason: `timed out after ${config.geminiLivePreflightTimeoutMs}ms`
            })
          );
        }, config.geminiLivePreflightTimeoutMs);

        try {
          session = (await ai.live.connect({
            model: config.geminiLiveModel,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: config.geminiLiveVoiceName
                  }
                }
              }
            },
            callbacks: {
              onmessage: (message: unknown) => {
                if (!hasLiveOutput(message)) return;
                clearTimeout(timeout);
                resolve(
                  finish({
                    ok: true,
                    reason: "Gemini live preflight passed"
                  })
                );
              },
              onerror: (error: unknown) => {
                clearTimeout(timeout);
                resolve(
                  finish({
                    ok: false,
                    reason: `live error: ${getErrorMessage(error)}`
                  })
                );
              },
              onclose: () => {
                if (resolved) return;
                clearTimeout(timeout);
                resolve(
                  finish({
                    ok: false,
                    reason: "session closed before response"
                  })
                );
              }
            }
          } as any)) as { sendClientContent?: (payload: unknown) => void; close: () => void };

          if (!session?.sendClientContent) {
            clearTimeout(timeout);
            resolve(
              finish({
                ok: false,
                reason: "session missing sendClientContent"
              })
            );
            return;
          }

          session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: "Quick health check: say one short sentence confirming you are ready." }]
              }
            ],
            turnComplete: true
          });
        } catch (error) {
          clearTimeout(timeout);
          resolve(
            finish({
              ok: false,
              reason: `connect failed: ${getErrorMessage(error)}`
            })
          );
        }
      });

      livePreflightCache = { at: Date.now(), result };
      return result;
    } finally {
      livePreflightInFlight = null;
    }
  })();

  return livePreflightInFlight;
}

export async function normalizeQuery(requestText: string, locationText: string): Promise<NormalizeQueryResponse> {
  const fallback: NormalizeQueryResponse = {
    searchQuery: `${requestText.trim()} near ${locationText.trim()}`,
    serviceCategory: requestText.trim()
  };

  try {
    const prompt = [
      "You convert user sourcing requests into Google Maps vendor search text.",
      "Return strict JSON with keys: searchQuery, serviceCategory.",
      `Request: ${requestText}`,
      `Location: ${locationText}`
    ].join("\n");

    const raw = await callGemini(prompt);
    const parsed = JSON.parse(extractJson(raw)) as Partial<NormalizeQueryResponse>;

    return {
      searchQuery: parsed.searchQuery?.trim() || fallback.searchQuery,
      serviceCategory: parsed.serviceCategory?.trim() || fallback.serviceCategory
    };
  } catch {
    return fallback;
  }
}

export async function generateAgentTurn(input: {
  requestText: string;
  locationText: string;
  history: Array<{ speaker: "agent" | "vendor"; text: string }>;
  latestVendorSpeech: string;
  turn: number;
}): Promise<{ agentReply: string; quote: QuotePayload; isComplete: boolean }> {
  const fallbackReply =
    "Thanks. For this customer request, could you share your quote amount and earliest start timeline?";

  try {
    const prompt = [
      "You are a procurement call agent speaking to a local service vendor.",
      "IMPORTANT: The other party is a vendor, not the end customer.",
      "Speak as sourcing/procurement representative collecting vendor quote for a customer request.",
      "Goal: collect quote price, timeline, and constraints in <=4 turns.",
      "Allowed questions: can you take this job, quote price/range, start date/timeline, what's included/excluded, visit/inspection fee, warranty/guarantee.",
      "Do NOT ask customer-intake questions (customer budget preference, personal profile, questionnaire-style discovery).",
      "Return strict JSON with keys: agentReply, isComplete, quote.",
      "quote must include: priceMin, priceMax, currency, timelineDays, notes, confidence, isComplete.",
      `Customer request: ${input.requestText}`,
      `Location: ${input.locationText}`,
      `Turn number: ${input.turn}`,
      `Conversation history: ${JSON.stringify(input.history)}`,
      `Latest vendor speech: ${input.latestVendorSpeech}`
    ].join("\n");

    const raw = await callGemini(prompt);
    const parsed = JSON.parse(extractJson(raw)) as Partial<AgentTurnResponse>;

    const quote = parseQuoteCandidate(JSON.stringify(parsed.quote ?? {}));

    return {
      agentReply: parsed.agentReply?.trim() || fallbackReply,
      isComplete: Boolean(parsed.isComplete ?? quote.isComplete),
      quote
    };
  } catch {
    const quote = parseQuoteCandidate(input.latestVendorSpeech);
    return {
      agentReply: fallbackReply,
      isComplete: quote.isComplete,
      quote
    };
  }
}

export async function generateIntakeQuestions(
  requestText: string,
  locationText: string
): Promise<QuestionnaireGenerationResult> {
  const fallback = fallbackQuestionnaire(requestText);
  const now = new Date();
  const monthName = now.toLocaleString("en-US", { month: "long" });
  const year = now.getFullYear();

  try {
    const prompt = [
      "You are generating an intake questionnaire for a procurement request.",
      "Return strict JSON with key: questions (array of 3 to 5 questions).",
      "Each question object keys: id, prompt, placeholder, required, options, allowCustomAnswer.",
      "Questions must be customer-friendly and easy to answer.",
      "Write plain, natural questions suitable for end customers (not internal procurement jargon).",
      "Do not include raw date text like month/year inside the question sentence.",
      "Each question must include 3 to 5 options in plain language.",
      "Set allowCustomAnswer=true when user may need to add details.",
      `Current month/year: ${monthName} ${year}`,
      "Include at least one question that is time-sensitive for the current month/season (weather, lead time, permit timing, urgency, or availability).",
      `Request: ${requestText}`,
      `Location: ${locationText}`
    ].join("\n");

    const raw = await callGemini(prompt);
    const parsed = JSON.parse(extractJson(raw)) as Partial<QuestionnaireResponse>;
    const rows = Array.isArray(parsed.questions) ? parsed.questions : [];

    const normalized = rows
      .map((row, idx) => ({
        id: (row.id?.trim() || `q${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
        prompt: row.prompt?.trim() || "",
        placeholder: row.placeholder?.trim() || fallback[idx]?.placeholder || "Your answer",
        required: typeof row.required === "boolean" ? row.required : idx < 2,
        options: Array.isArray(row.options)
          ? row.options
              .map((option) => String(option).trim())
              .filter((option) => option.length > 0)
              .slice(0, 5)
          : [],
        allowCustomAnswer: typeof row.allowCustomAnswer === "boolean" ? row.allowCustomAnswer : true
      }))
      .map((row) => ({
        ...row,
        options: row.options.length >= 3 ? row.options : fallback.find((q) => q.id === row.id)?.options || fallback[0].options
      }))
      .filter((row) => row.prompt.length > 0)
      .slice(0, 5);

    if (normalized.length >= 3) {
      return { source: "ai", questions: normalized };
    }

    if (config.questionnaireRequireAi) {
      throw new Error("AI generated questionnaire was incomplete");
    }

    return { source: "fallback", questions: fallback };
  } catch (error) {
    if (config.questionnaireRequireAi) {
      throw error;
    }
    return { source: "fallback", questions: fallback };
  }
}
