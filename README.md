# VoiceProcure AI (POC)

Web-first sourcing POC that:

1. Accepts a consumer request (text or mic input)
2. Generates an AI questionnaire with customer-friendly selectable options
3. Discovers local vendors via Google Maps
4. Contacts vendors via Twilio voice (Gather mode or Gemini Live streaming mode)
5. Uses Gemini Flash to drive call turns and extract quote data
6. Uses rating, review volume, and review text signal in vendor quality scoring
7. Returns top ranked 3-4 quotes

## Call strategy

- Calls are strictly sequential (one active outbound call at a time).
- The system tries the top 3 vendors first.
- If fewer than 3 valid quotes are collected, it falls back to additional vendors one by one.

## Setup

1. Fill `.env` with your keys.
2. Set `PUBLIC_BASE_URL` to your ngrok URL for real Twilio calls.
3. Keep `PUBLIC_BASE_URL` exactly matching your Twilio webhook URL host/protocol when `TWILIO_VALIDATE_SIGNATURES=true`.
4. Install dependencies and run:

```bash
pnpm install --no-frozen-lockfile
pnpm dev
```

## Docker

Run with Docker Compose (recommended):

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

Notes:
- `.env` is loaded via `docker-compose.yml`.
- SQLite data is persisted in the named volume `app_data`.
- Inside the container, DB path is set to `/app/data/voiceprocure.db`.

## Important test-call behavior

Real outbound calls are currently overridden to this test number for every vendor:

`+91 8589878253`

You can change this via:

```env
TWILIO_TEST_TO_NUMBER=+918589878253
```

## Endpoints

- `POST /api/questionnaire`
- `POST /api/jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/vendors`
- `POST /twilio/voice/intro`
- `POST /twilio/voice/live-intro`
- `POST /twilio/voice/turn`
- `POST /twilio/voice/status`
- `wss://<PUBLIC_BASE_URL>/twilio/media-stream` (Twilio bidirectional media stream)

## Gemini model settings

- `GEMINI_TEXT_MODEL=gemini-2.5-flash`
- `GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025`
- `GEMINI_LIVE_VOICE_NAME=Aoede`
- `AGENT_HUMAN_NAME=Alex Morgan`
- `QUESTIONNAIRE_REQUIRE_AI=true`

## Twilio voice mode

- `TWILIO_VOICE_MODE=live_stream` for Gemini Live voice streaming via Twilio media streams
- `TWILIO_VOICE_MODE=gather` for classic Twilio Gather speech turns
- Media Stream context is passed via Twilio `<Parameter>` values (not URL query params).
- Incoming Twilio webhooks and Media Stream upgrades are signature-validated by default in real mode.

## Mock mode

Set `MOCK_MODE=true` to run end-to-end without real phone calls.
