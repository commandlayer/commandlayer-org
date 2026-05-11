# Webhook Auto-Verification Demo

This demo shows how to automatically verify CLAS/CommandLayer receipts inside an incoming webhook flow.

## Why this demo

- **No manual paste required:** the webhook handler sends incoming receipts directly to VerifyAgent.
- **Systems can verify receipts automatically:** any backend service can perform this check on every inbound webhook.
- **Schema-valid does _not_ mean cryptographically valid:** JSON shape checks and cryptographic checks are different; both matter.
- **Demo only:** this is not production authentication middleware.

## What it does

- Exposes `POST /webhook` via Express.
- Expects a JSON body with:
  - `event`
  - `receipt`
- Calls VerifyAgent:
  - `POST https://www.commandlayer.org/api/verify`
  - body: `{ "receipt": { ... } }`
- Returns:
  - `200` with `{ "status": "accepted" }` when verified.
  - `400` with `{ "status": "rejected" }` when invalid.

It also logs key verification checks:

- `schema_valid`
- `hash_matched` / `hash_matches`
- `signature_valid`
- `signer_resolved` / `ens_resolved`
- `signer_matched`
- `trust_verb`

## Run

```bash
cd examples/webhook-auto-verify
npm install
npm start
```

Then send a webhook payload:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  --data @sample-valid-webhook.json
```

Try the tampered sample too:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  --data @sample-tampered-webhook.json
```
