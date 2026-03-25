import path from "node:path";
import http from "node:http";
import express from "express";
import { config, validateConfig } from "./config";
import { apiRouter } from "./routes/api";
import { twilioRouter } from "./routes/twilio";
import { validateTwilioUpgradeRequest } from "./services/twilioSecurity";

export const createApp = (): express.Express => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use("/api", apiRouter);
  app.use("/twilio", twilioRouter);

  app.use(express.static(path.resolve(process.cwd(), "public")));

  app.get("*", (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), "public/index.html"));
  });

  return app;
};

export const createServer = (): { app: express.Express; server: http.Server } => {
  const app = createApp();
  const server = http.createServer(app);

  if (!config.mockMode && config.twilioVoiceMode === "live_stream") {
    const { TwilioGeminiLiveBridge } = require("./services/liveVoiceBridge") as {
      TwilioGeminiLiveBridge: new () => {
        handleUpgrade: (req: http.IncomingMessage, socket: NodeJS.ReadWriteStream, head: Buffer) => boolean;
      };
    };
    const bridge = new TwilioGeminiLiveBridge();
    server.on("upgrade", (req, socket, head) => {
      if (!validateTwilioUpgradeRequest(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const upgraded = bridge.handleUpgrade(req, socket, head);
      if (!upgraded) {
        socket.destroy();
      }
    });
  }

  return { app, server };
};

if (process.env.NODE_ENV !== "test") {
  validateConfig();
  const { server } = createServer();

  server.listen(config.port, () => {
    console.log(`VoiceProcure server listening on http://localhost:${config.port}`);
    console.log(`Mock mode: ${config.mockMode ? "enabled" : "disabled"}`);
    console.log(`Twilio voice mode: ${config.twilioVoiceMode}`);
  });
}
