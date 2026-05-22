# x402 Paid Action → CLAS Receipt (Example Only)

This example demonstrates a **mock** integration flow where a paid action request is linked to a simulated x402 payment acceptance event and emitted as a CLAS-style action receipt.

> This is not production settlement or production signing. It is an educational example.

## What this example does

- Accepts a mock paid action request.
- Simulates an x402 `payment.accepted` event input.
- Executes a mock agent action (`summarize.text`).
- Emits a CLAS-style receipt containing:
  - `metadata.trace` for correlation.
  - `metadata.proof.payment` and `metadata.proof.execution`.
  - `proof.signature` placeholders for `payer`, `agent`, `runtime`, and `verifier`.

## Setup

```bash
cp examples/x402-paid-action-receipt/.env.example .env
```

No secrets are required for this mock example. Do not add private keys to `.env`.

## Environment variables

- `PORT` (default `4000`): local server port.
- `WORKFLOW_ID` (optional): trace workflow correlation id.
- `RUNTIME_SIGNING_KEY_ID` (optional): key identifier string used in placeholder runtime signature metadata.

## Run locally

```bash
node examples/x402-paid-action-receipt/server.js
```

Health check:

```bash
curl -s http://localhost:4000/health
```

## Sample curl command

```bash
curl -s -X POST http://localhost:4000/paid-action \
  -H 'content-type: application/json' \
  -d '{
    "paid_action_request": {
      "request_id": "req_9f2f5f25",
      "action": "summarize.text",
      "input": {"text": "CommandLayer receipts prove execution attestation separate from payment settlement."},
      "payment": {"required": true, "plan": "pro", "max_amount": "0.05", "currency": "USD"}
    },
    "payment_accepted": {
      "event": "payment.accepted",
      "request_id": "req_9f2f5f25",
      "payment_id": "pay_x402_7f31",
      "provider": "x402-compatible",
      "settled_amount": "0.05",
      "currency": "USD",
      "accepted_at": "2026-05-22T12:00:01Z"
    }
  }'
```

## Expected output

A `200` JSON response containing:

- `duplicate: false` on first execution.
- `receipt.receipt_id`, `request_id`, `payment_id`.
- `metadata.trace` fields including `request_id`, `payment_id`, `receipt_id`, `workflow_id`.
- `metadata.proof.commandlayer_signing_hook` placeholder to replace with real CommandLayer signing.
- `proof.signature` role entries for `payer`, `agent`, `runtime`, `verifier`.

If the same `request_id + payment_id` is sent again, response includes `duplicate: true` and returns the original receipt.

## Trust boundary

- **x402/payment provider proves settlement**: payment requirement, acceptance/rejection, settlement status.
- **CommandLayer proves execution**: action request, runtime execution output, and signed receipt artifact.
- **Do not conflate them**: payment acceptance does not prove execution correctness.

## Failure modes

The API documents and returns error states for:

- missing payment
- invalid payment
- duplicate `request_id` / `payment_id` (idempotent replay returns canonical receipt)
- action execution failed
- receipt signing failed
- verifier unavailable (documented operational dependency; this mock does not call an external verifier)

## Idempotency model

Use and persist three IDs:

- `request_id`: semantic request identity.
- `payment_id`: payment-settlement identity.
- `receipt_id`: emitted CLAS receipt identity.

Dedupe key in this example is `request_id + payment_id`.

## Production-readiness path

To move this example to production:

1. Replace mock payment validation with real x402 provider verification.
2. Persist idempotency state in durable storage (DB/cache), not in-memory maps.
3. Implement canonical receipt signing using CommandLayer keys/HSM/KMS (replace placeholders).
4. Add verifier invocation and signed verifier attestations for `verifier` role.
5. Add schema validation for incoming request/event payloads.
6. Add audit logging, retries, and alerting for `RECEIPT_SIGNING_FAILED` and verifier outages.
7. Protect endpoints with authn/authz and rate limiting.

## Validation commands

```bash
npm test
node --test tests/x402-paid-action-receipt.test.js
```
