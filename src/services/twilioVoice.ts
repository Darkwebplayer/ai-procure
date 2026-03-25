import twilio from "twilio";
import { config } from "../config";
import { ensureGeminiLiveReady } from "./gemini";

let twilioClient: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (!twilioClient) {
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return twilioClient;
}

export function createVoiceResponse() {
  return new twilio.twiml.VoiceResponse();
}

export async function placeOutboundCall(input: {
  to: string;
  jobId: string;
  vendorId: string;
  attemptId: string;
  baseUrl: string;
}): Promise<{ sid: string }> {
  if (config.mockMode) {
    return { sid: `MOCK-${input.attemptId}` };
  }

  if (config.twilioVoiceMode === "live_stream") {
    const preflight = await ensureGeminiLiveReady();
    if (!preflight.ok) {
      throw new Error(`Gemini Live preflight failed: ${preflight.reason}`);
    }
  }

  const client = getClient();
  const destination = config.twilio.testToNumber || input.to;
  const introPath = config.twilioVoiceMode === "live_stream" ? "/twilio/voice/live-intro" : "/twilio/voice/intro";

  const intro = new URL(`${input.baseUrl}${introPath}`);
  intro.searchParams.set("jobId", input.jobId);
  intro.searchParams.set("vendorId", input.vendorId);
  intro.searchParams.set("attemptId", input.attemptId);

  const status = new URL(`${input.baseUrl}/twilio/voice/status`);
  status.searchParams.set("jobId", input.jobId);
  status.searchParams.set("vendorId", input.vendorId);
  status.searchParams.set("attemptId", input.attemptId);

  const call = await client.calls.create({
    to: destination,
    from: config.twilio.phoneNumber,
    url: intro.toString(),
    method: "POST",
    statusCallback: status.toString(),
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST"
  });

  return { sid: call.sid };
}

export async function redirectCallToUrl(input: { callSid: string; url: string }): Promise<void> {
  if (config.mockMode) return;
  const client = getClient();
  await client.calls(input.callSid).update({
    url: input.url,
    method: "POST"
  });
}

export async function completeCall(input: { callSid: string }): Promise<void> {
  if (config.mockMode) return;
  const client = getClient();
  await client.calls(input.callSid).update({
    status: "completed"
  });
}
