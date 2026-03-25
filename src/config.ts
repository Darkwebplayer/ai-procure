import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseVoiceMode = (value: string | undefined): "gather" | "live_stream" => {
  if (!value) return "live_stream";
  return value === "gather" ? "gather" : "live_stream";
};

const dbPath = process.env.DB_PATH?.trim() || path.resolve(process.cwd(), "voiceprocure.db");

export const config = {
  port: parseNumber(process.env.PORT, 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || "",
  mockMode: parseBoolean(process.env.MOCK_MODE, true),
  twilioValidateSignatures: parseBoolean(
    process.env.TWILIO_VALIDATE_SIGNATURES,
    !parseBoolean(process.env.MOCK_MODE, true)
  ),
  targetQuotes: parseNumber(process.env.TARGET_QUOTES, 4),
  maxVendorCalls: parseNumber(process.env.MAX_VENDOR_CALLS, 8),
  twilioMaxTurns: parseNumber(process.env.TWILIO_MAX_TURNS, 4),
  twilioVoiceMode: parseVoiceMode(process.env.TWILIO_VOICE_MODE),
  confidenceThreshold: Number(process.env.QUOTE_CONFIDENCE_THRESHOLD ?? 0.55),
  dbPath,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || "",
    authToken: process.env.TWILIO_AUTH_TOKEN?.trim() || "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER?.trim() || "",
    testToNumber: process.env.TWILIO_TEST_TO_NUMBER?.trim() || "+918589878253"
  },
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() || "",
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
  geminiTextModel: process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-2.5-flash",
  geminiLiveModel: process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-2.5-flash-native-audio-preview-12-2025",
  geminiLiveVoiceName: process.env.GEMINI_LIVE_VOICE_NAME?.trim() || "Aoede",
  geminiLivePreflightTimeoutMs: parseNumber(process.env.GEMINI_LIVE_PREFLIGHT_TIMEOUT_MS, 5000),
  geminiLivePreflightCacheMs: parseNumber(process.env.GEMINI_LIVE_PREFLIGHT_CACHE_MS, 20000),
  agentHumanName: process.env.AGENT_HUMAN_NAME?.trim() || "Alex Morgan",
  questionnaireRequireAi: parseBoolean(process.env.QUESTIONNAIRE_REQUIRE_AI, true)
};

export const validateConfig = (): void => {
  const missing: string[] = [];

  if (!config.googleMapsApiKey) missing.push("GOOGLE_MAPS_API_KEY");
  if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");

  if (!config.mockMode) {
    if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!config.twilio.phoneNumber) missing.push("TWILIO_PHONE_NUMBER");
    if (!config.publicBaseUrl) missing.push("PUBLIC_BASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
};
