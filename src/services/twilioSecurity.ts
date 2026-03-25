import type { IncomingMessage } from "node:http";
import twilio from "twilio";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const getPublicOrigin = (): string => {
  if (config.publicBaseUrl) {
    return trimTrailingSlash(config.publicBaseUrl);
  }

  return `http://localhost:${config.port}`;
};

const getSignature = (headers: IncomingMessage["headers"]): string => {
  const raw = headers["x-twilio-signature"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
};

const shouldValidate = (): boolean => {
  if (process.env.NODE_ENV === "test") return false;
  if (config.mockMode) return false;
  return config.twilioValidateSignatures;
};

const buildUrl = (requestPath: string): string => {
  return new URL(requestPath, `${getPublicOrigin()}/`).toString();
};

export const validateTwilioHttpRequest = (req: Request, res: Response, next: NextFunction): void => {
  if (!shouldValidate()) {
    next();
    return;
  }

  const signature = getSignature(req.headers);
  if (!signature) {
    res.status(403).json({ error: "Missing Twilio signature" });
    return;
  }

  const url = buildUrl(req.originalUrl);
  const params = typeof req.body === "object" && req.body ? req.body : {};
  const valid = twilio.validateRequest(config.twilio.authToken, signature, url, params);

  if (!valid) {
    res.status(403).json({ error: "Invalid Twilio signature" });
    return;
  }

  next();
};

export const validateTwilioUpgradeRequest = (req: IncomingMessage): boolean => {
  if (!shouldValidate()) return true;

  const requestPath = req.url ?? "/";
  const pathname = new URL(requestPath, `${getPublicOrigin()}/`).pathname;
  if (pathname !== "/twilio/media-stream") {
    return true;
  }

  const signature = getSignature(req.headers);
  if (!signature) {
    console.error("Twilio WS validation failed: missing X-Twilio-Signature header");
    return false;
  }

  const url = buildUrl(requestPath);
  const valid = twilio.validateRequest(config.twilio.authToken, signature, url, {});
  if (!valid) {
    console.error("Twilio WS validation failed: signature mismatch", {
      url
    });
  }
  return valid;
};
