# Coinbase CDP Webhook → CommandLayer Receipt Integration Design

## 1. Overview

This document defines a **documentation-only** integration design for converting verified Coinbase CDP webhook events into CommandLayer-signed CLAS receipts.

The design is intentionally split into two trust stages:

1. **Private server verification**: Coinbase CDP webhook authenticity is verified using `X-Hook0-Signature` and a shared webhook secret.
2. **Portable public attestation**: After successful verification, CommandLayer emits an Ed25519-signed CLAS receipt that third parties can verify independently.

No production webhook implementation is included here.

## 2. Why Coinbase CDP webhooks matter for CommandLayer

Coinbase CDP webhooks provide low-latency signals for wallet and onchain lifecycle activity (for example, detected onchain activity and transaction state changes). For CommandLayer, these events are useful because they allow:

- deterministic ingestion of external execution events,
- immediate internal policy/evaluation hooks,
- a uniform CLAS receipt stream for downstream systems,
- independently verifiable distribution once CommandLayer signs receipts.

This gives operators both operational responsiveness (webhooks) and portable auditability (CLAS).

## 3. Trust boundary

### Boundary A: Coinbase → CommandLayer ingress (private verification)

- Verified with HMAC-SHA256 using a shared webhook secret.
- Requires exact raw body preservation and canonical payload reconstruction.
- Trust result: "our server has authenticated this request as Coinbase-signed with a configured secret."

### Boundary B: CommandLayer → external consumers (public verification)

- Verified with CommandLayer Ed25519 receipt signatures.
- Trust result: "CommandLayer attests this normalized event representation."

**Important**: Coinbase HMAC verification is not publicly verifiable by third parties, because verification requires private shared secret material.

## 4. Verification flow

The following sequence is required before any JSON parsing or business handling:

1. Read HTTP headers and capture `X-Hook0-Signature`.
2. Capture the **raw** request body bytes exactly as received.
3. Require configured webhook secret; fail closed if absent.
4. Parse `X-Hook0-Signature` into:
   - `t` (timestamp),
   - signed header name list,
   - `v1` signature.
5. Collect each signed header value from the request exactly as required by the signature scheme.
6. Rebuild the signed payload from:
   - timestamp,
   - signed header names,
   - resolved signed header values,
   - raw body.
7. Compute expected signature with HMAC-SHA256 using webhook secret.
8. Perform timing-safe comparison between expected `v1` and provided `v1`.
9. Enforce timestamp freshness window (replay defense).
10. Only after all checks pass, parse JSON payload and continue.

### Verification pseudocode

```text
input: headers, raw_body, secret
sig_header = headers["x-hook0-signature"]
if !sig_header: reject missing_signature
if !secret: reject missing_secret

parts = parse_signature_header(sig_header)
# parts: t, signed_headers[], v1

if abs(now_unix - parts.t) > freshness_window_sec:
  reject stale_timestamp

canonical = build_signed_payload(
  timestamp=parts.t,
  signed_headers=parts.signed_headers,
  header_values=lookup(headers, parts.signed_headers),
  raw_body=raw_body,
)

expected_v1 = hmac_sha256_hex(secret, canonical)
if !timing_safe_equal(expected_v1, parts.v1):
  reject hmac_mismatch

event = json_parse(raw_body)
accept event
```

## 5. CLAS receipt shape

A normalized CLAS receipt emitted after successful verification should include:

```json
{
  "receipt_id": "rcpt:coinbase_cdp:<event_id>",
  "source": "coinbase.cdp.webhook",
  "source_event_id": "evt_123",
  "event_type": "onchain.activity.detected",
  "observed_at": "2026-05-22T00:00:00Z",
  "ingested_at": "2026-05-22T00:00:02Z",
  "verification": {
    "method": "hmac_sha256",
    "header": "x-hook0-signature",
    "verified": true,
    "freshness_window_sec": 300
  },
  "metadata": {
    "trace": {
      "provider": "coinbase",
      "provider_event_id": "evt_123",
      "delivery_id": "deliv_456"
    }
  },
  "payload": {
    "...": "provider event subset or normalized fields"
  },
  "clas_signature": {
    "alg": "Ed25519",
    "key_id": "cl_key_1",
    "sig": "base64..."
  }
}
```

Notes:

- `source_event_id` is the Coinbase dedupe anchor.
- `receipt_id` is deterministic from source + event ID.
- `verification.verified=true` means server-side HMAC validation succeeded.
- `clas_signature` is what enables public third-party verification of the receipt artifact.

## 6. Example: `onchain.activity.detected` receipt

```json
{
  "receipt_id": "rcpt:coinbase_cdp:evt_act_001",
  "source": "coinbase.cdp.webhook",
  "source_event_id": "evt_act_001",
  "event_type": "onchain.activity.detected",
  "verification": {
    "method": "hmac_sha256",
    "verified": true
  },
  "payload": {
    "network": "base-mainnet",
    "address": "0xabc...",
    "activity_kind": "transfer_detected",
    "tx_hash": "0xdef..."
  }
}
```

## 7. Example: wallet/onchain transaction receipt

```json
{
  "receipt_id": "rcpt:coinbase_cdp:evt_tx_009",
  "source": "coinbase.cdp.webhook",
  "source_event_id": "evt_tx_009",
  "event_type": "wallet.onchain.transaction",
  "verification": {
    "method": "hmac_sha256",
    "verified": true
  },
  "payload": {
    "wallet_id": "w_123",
    "transaction_id": "tx_987",
    "status": "confirmed",
    "network": "base-mainnet",
    "tx_hash": "0x123..."
  }
}
```

## 8. Failure modes

- **missing signature**: `X-Hook0-Signature` absent → reject with auth error.
- **missing secret**: verifier secret not configured → fail closed; no best-effort processing.
- **stale timestamp**: signature timestamp outside freshness window → reject as replay risk.
- **HMAC mismatch**: computed signature differs from `v1` → reject as authenticity failure.
- **malformed payload**: body is not valid JSON after successful verification → reject payload parse.
- **duplicate event**: Coinbase event ID already processed → return idempotent success/no-op.
- **unsupported event type**: verified event type has no mapper yet → emit controlled unsupported-type handling path (no silent drop).

## 9. Idempotency

- Use Coinbase event ID as the primary dedupe key.
- Derive `receipt_id` deterministically from `(source, source_event_id)`.
- Recommended format: `rcpt:coinbase_cdp:<event_id>`.
- Store processing state transitions (`received`, `verified`, `mapped`, `signed`, `published`) keyed by source event ID.

This prevents duplicate delivery from generating divergent receipts.

## 10. `metadata.trace` usage

`metadata.trace` should carry cross-system correlation identifiers needed for audit and debugging:

```json
{
  "metadata": {
    "trace": {
      "provider": "coinbase",
      "provider_event_id": "evt_123",
      "delivery_id": "deliv_456",
      "request_id": "req_789",
      "ingress_path": "/webhooks/coinbase/cdp"
    }
  }
}
```

Guidelines:

- Keep trace identifiers stable and minimally sufficient.
- Avoid storing secret values or raw signatures in `metadata.trace`.
- Use trace fields to connect ingress logs, dedupe decisions, and receipt publication logs.

## 11. Future x402 paid-action flow

A future flow can gate premium downstream actions on verified Coinbase-triggered events:

1. Coinbase webhook verifies at ingress.
2. CommandLayer emits signed CLAS receipt.
3. A policy engine evaluates receipt content.
4. If policy passes, trigger x402 paid action (e.g., settlement, routing, execution).

Design intent: payment-trigger logic should depend on CommandLayer receipt semantics, not raw webhook payload alone, to preserve a consistent audit surface.

## 12. What this does not prove

- Coinbase HMAC verification is private server-side verification only.
- Third parties cannot independently validate Coinbase authenticity without the shared secret.
- Public verifiability begins when CommandLayer signs the receipt (Ed25519) and distributes that signed artifact.


## Signed example endpoint

A server-side example endpoint is available at `api/examples/coinbase-webhook.js`.

Processing order is strict:
1. Verify Coinbase webhook authenticity first (`X-Hook0-Signature` HMAC over raw body + signed headers).
2. Normalize the accepted event into a CLAS-style `observe` receipt.
3. Sign the normalized receipt with CommandLayer runtime Ed25519 signing material.

This ordering matters: receipt signing happens **only** for accepted, HMAC-verified Coinbase events. Invalid or stale webhook signatures are rejected before parsing JSON and before any receipt signature work.

Required environment variables:
- `COINBASE_WEBHOOK_SECRET`
- `COINBASE_WEBHOOK_MAX_AGE_SECONDS` (optional, defaults to 300)
- `CL_RECEIPT_SIGNER_ID`
- `CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM`
- `CL_RECEIPT_SIGNING_KID`

Public portability begins after CommandLayer signs the normalized receipt artifact. Third-party verification depends on signer public key distribution (for example ENS text records expected by local verifier logic).
