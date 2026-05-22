# Coinbase CDP Webhook → CommandLayer (CLAS) Adapter (Example)

> Example-only adapter. Do not deploy this directly to production.

This example receives a Coinbase CDP webhook, verifies the `X-Hook0-Signature`, deduplicates by event id, and normalizes the webhook event into a CLAS-style observe receipt.

## Setup

```bash
cd examples/coinbase-cdp-webhook-adapter
npm init -y
npm install express
cp .env.example .env
```

## Environment variables

- `PORT` (default: `3001`)
- `WEBHOOK_SECRET` (required, never hardcode)
- `FRESHNESS_WINDOW_SECONDS` (default: `300` = 5 minutes)

## Run locally

```bash
export $(cat .env | xargs)
node server.js
```

## How verification works

1. Uses `express.raw({ type: "application/json" })` to preserve exact bytes.
2. Reads `X-Hook0-Signature` and parses `t`, `h`, `v1`.
3. Rebuilds signed payload as:
   - `timestamp + "." + signedHeaderNames + "." + signedHeaderValues + "." + rawBody`
4. Computes `HMAC-SHA256` with `WEBHOOK_SECRET`.
5. Compares provided signature vs computed with `crypto.timingSafeEqual`.
6. Enforces freshness window (default 5 minutes).
7. Parses JSON only after signature verification succeeds.
8. Deduplicates by event id.
9. Normalizes event to CLAS observe receipt with `metadata.trace` and a `metadata.proof` signing placeholder.

## Trust boundary

- Coinbase HMAC verification proves authenticity to **this adapter server** (shared-secret model).
- Coinbase HMAC is **not publicly verifiable**.
- Public verifiability starts only after CommandLayer signs the normalized receipt.

## Local validation with samples

Create a fresh signature for the sample using your local `WEBHOOK_SECRET` and current timestamp:

```bash
node -e 'const fs=require("fs");const crypto=require("crypto");const body=fs.readFileSync("sample-valid-webhook.json","utf8").trim();const t=Math.floor(Date.now()/1000);const h="content-type;x-cdp-event-id";const vals="application/json;evt_123";const v1=crypto.createHmac("sha256",process.env.WEBHOOK_SECRET).update(`${t}.${h}.${vals}.${body}`).digest("hex");console.log(`X-Hook0-Signature: t=${t},h=${h},v1=${v1}`);'
```

Use the printed header in curl:

```bash
curl -i -X POST http://localhost:3001/coinbase/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-cdp-event-id: evt_123' \
  -H 'X-Hook0-Signature: t=REPLACE,h=content-type;x-cdp-event-id,v1=REPLACE' \
  --data-binary @sample-valid-webhook.json
```

Tampered sample (reuse same signature header from valid sample) should fail:

```bash
curl -i -X POST http://localhost:3001/coinbase/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-cdp-event-id: evt_123' \
  -H 'X-Hook0-Signature: t=REPLACE,h=content-type;x-cdp-event-id,v1=REPLACE' \
  --data-binary @sample-tampered-webhook.json
```

Expected behavior:
- Valid body + matching signature + fresh timestamp → `200 accepted`
- Tampered body with reused signature → `400 rejected`
- Duplicate event id after first accept → `200 duplicate_ignored`

## Placeholder vs production-ready

Included:
- Signature verification, freshness check, constant-time compare, JSON-after-verify, dedupe, normalization.

Still placeholder for production:
- Persistent idempotency store (Redis/DB) instead of in-memory set.
- Rate limiting, structured audit logging, secret rotation, alerting.
- CommandLayer signing step for public verifiability (`metadata.proof` hook is included but not wired).
