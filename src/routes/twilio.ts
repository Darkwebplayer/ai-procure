import { Router } from "express";
import { config } from "../config";
import { appDb } from "../db";
import { generateAgentTurn } from "../services/gemini";
import { orchestrator } from "../services/orchestrator";
import { validateTwilioHttpRequest } from "../services/twilioSecurity";
import { createVoiceResponse } from "../services/twilioVoice";

export const twilioRouter = Router();
twilioRouter.use(validateTwilioHttpRequest);
const getBaseUrl = (): string => config.publicBaseUrl || `http://localhost:${config.port}`;
const getWsBaseUrl = (): string => getBaseUrl().replace(/^http/i, "ws");

const toString = (value: unknown): string => (typeof value === "string" ? value : "");

const appendGather = (
  voice: ReturnType<typeof createVoiceResponse>,
  actionUrl: string,
  prompt: string,
  noSpeechPrompt = "I did not hear a response. Goodbye."
): void => {
  const gather = voice.gather({
    input: ["speech"],
    action: actionUrl,
    method: "POST",
    speechTimeout: "auto",
    language: "en-US"
  });

  gather.say({ voice: "alice" }, prompt);

  voice.say({ voice: "alice" }, noSpeechPrompt);
  voice.hangup();
};

const gatherSpeech = (actionUrl: string, prompt: string): string => {
  const voice = createVoiceResponse();
  appendGather(voice, actionUrl, prompt);
  return voice.toString();
};

twilioRouter.post("/voice/intro", (req, res) => {
  const attemptId = toString(req.query.attemptId);
  const vendorId = toString(req.query.vendorId);

  const attempt = appDb.getCallAttempt(attemptId);
  if (!attempt) {
    return res.type("text/xml").send(createVoiceResponse().toString());
  }

  const callSid = toString(req.body.CallSid);
  if (callSid) {
    appDb.attachCallSid(attemptId, callSid);
  }

  appDb.updateVendorStatus(vendorId, "calling");
  appDb.setCallAttemptStatus(attemptId, "answered");

  const introPrompt =
    "Hi, this is VoiceProcure AI. We are collecting a quote for a local customer. Could you share your estimated price and timeline?";

  appDb.addConversationTurn(attemptId, 0, "agent", introPrompt);

  const actionUrl = new URL(`${getBaseUrl()}/twilio/voice/turn`);
  actionUrl.searchParams.set("jobId", toString(req.query.jobId));
  actionUrl.searchParams.set("vendorId", vendorId);
  actionUrl.searchParams.set("attemptId", attemptId);
  actionUrl.searchParams.set("turn", "1");

  const xml = gatherSpeech(actionUrl.toString(), introPrompt);
  return res.type("text/xml").send(xml);
});

twilioRouter.post("/voice/live-intro", (req, res) => {
  const attemptId = toString(req.query.attemptId);
  const vendorId = toString(req.query.vendorId);
  const jobId = toString(req.query.jobId);

  const attempt = appDb.getCallAttempt(attemptId);
  if (!attempt) {
    return res.type("text/xml").send(createVoiceResponse().toString());
  }

  const callSid = toString(req.body.CallSid);
  if (callSid) {
    appDb.attachCallSid(attemptId, callSid);
  }

  appDb.updateVendorStatus(vendorId, "calling");
  appDb.setCallAttemptStatus(attemptId, "answered");

  const streamUrl = new URL(`${getWsBaseUrl()}/twilio/media-stream`);

  const voice = createVoiceResponse();
  const connect = voice.connect();
  const stream = connect.stream({ url: streamUrl.toString() });
  stream.parameter({ name: "jobId", value: jobId });
  stream.parameter({ name: "vendorId", value: vendorId });
  stream.parameter({ name: "attemptId", value: attemptId });

  // If media stream setup fails or disconnects early, continue on the same call with Gather flow.
  const fallbackActionUrl = new URL(`${getBaseUrl()}/twilio/voice/turn`);
  fallbackActionUrl.searchParams.set("jobId", jobId);
  fallbackActionUrl.searchParams.set("vendorId", vendorId);
  fallbackActionUrl.searchParams.set("attemptId", attemptId);
  fallbackActionUrl.searchParams.set("turn", "1");

  appendGather(
    voice,
    fallbackActionUrl.toString(),
    "Sorry, we had a connection issue. I can still help now. Could you share your estimated price and timeline?",
    "No problem. We can follow up later. Goodbye."
  );

  return res.type("text/xml").send(voice.toString());
});

twilioRouter.post("/voice/complete", (req, res) => {
  const attemptId = toString(req.query.attemptId);
  const vendorId = toString(req.query.vendorId);
  const jobId = toString(req.query.jobId);

  if (attemptId) {
    appDb.setCallAttemptStatus(attemptId, "completed");
  }
  if (vendorId) {
    const quotes = jobId ? appDb.getQuotesForJob(jobId).filter((q) => q.vendor_id === vendorId) : [];
    const vendorSpoke = attemptId ? appDb.hasVendorSpeech(attemptId) : false;
    appDb.updateVendorStatus(vendorId, quotes.length > 0 || vendorSpoke ? "responded" : "failed");
  }
  if (jobId) {
    orchestrator.evaluateCompletion(jobId);
  }

  const voice = createVoiceResponse();
  voice.hangup();
  return res.type("text/xml").send(voice.toString());
});

twilioRouter.post("/voice/turn", async (req, res) => {
  const jobId = toString(req.query.jobId);
  const vendorId = toString(req.query.vendorId);
  const attemptId = toString(req.query.attemptId);
  const turn = Number(req.query.turn ?? 1);

  const job = appDb.getJob(jobId);
  const attempt = appDb.getCallAttempt(attemptId);

  if (!job || !attempt) {
    return res.type("text/xml").send(createVoiceResponse().toString());
  }

  const speechResult = toString(req.body.SpeechResult).trim();
  if (speechResult) {
    appDb.addConversationTurn(attemptId, turn, "vendor", speechResult);
  }

  const history = appDb
    .getConversationTurns(attemptId)
    .map((row) => ({ speaker: row.speaker === "agent" ? "agent" : "vendor", text: row.text })) as Array<{
    speaker: "agent" | "vendor";
    text: string;
  }>;

  const agentTurn = await generateAgentTurn({
    requestText: job.request_text,
    locationText: job.location_text,
    history,
    latestVendorSpeech: speechResult,
    turn
  });

  appDb.addConversationTurn(attemptId, turn + 1, "agent", agentTurn.agentReply);
  appDb.upsertQuote(jobId, vendorId, agentTurn.quote);
  orchestrator.recomputeRankings(jobId);

  if (agentTurn.isComplete || turn >= config.twilioMaxTurns) {
    appDb.updateVendorStatus(vendorId, "responded");
    appDb.setCallAttemptStatus(attemptId, "completed");
    orchestrator.evaluateCompletion(jobId);

    const done = createVoiceResponse();
    done.say({ voice: "alice" }, "Thank you. We have captured your quote and will follow up if needed.");
    done.hangup();
    return res.type("text/xml").send(done.toString());
  }

  const actionUrl = new URL(`${getBaseUrl()}/twilio/voice/turn`);
  actionUrl.searchParams.set("jobId", jobId);
  actionUrl.searchParams.set("vendorId", vendorId);
  actionUrl.searchParams.set("attemptId", attemptId);
  actionUrl.searchParams.set("turn", String(turn + 1));

  const xml = gatherSpeech(actionUrl.toString(), agentTurn.agentReply);
  return res.type("text/xml").send(xml);
});

twilioRouter.post("/voice/status", (req, res) => {
  const attemptId = toString(req.query.attemptId);
  const vendorId = toString(req.query.vendorId);
  const jobId = toString(req.query.jobId);

  const callStatus = toString(req.body.CallStatus).toLowerCase();
  const callDurationSec = Number(toString(req.body.CallDuration));
  if (!attemptId || !vendorId) {
    return res.status(200).json({ ok: true });
  }

  if (callStatus) {
    appDb.setCallAttemptStatus(attemptId, callStatus);
  }

  if (["busy", "no-answer", "failed", "canceled"].includes(callStatus)) {
    appDb.updateVendorStatus(vendorId, "failed");
  }

  if (callStatus === "completed") {
    const quotes = appDb.getQuotesForJob(jobId).filter((q) => q.vendor_id === vendorId);
    const vendorSpoke = appDb.hasVendorSpeech(attemptId);
    const hadMeaningfulInteraction = quotes.length > 0 || vendorSpoke || (Number.isFinite(callDurationSec) && callDurationSec >= 12);
    appDb.updateVendorStatus(vendorId, hadMeaningfulInteraction ? "responded" : "failed");
  }

  orchestrator.evaluateCompletion(jobId);

  return res.status(200).json({ ok: true });
});
