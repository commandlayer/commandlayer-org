# x402 → CommandLayer Paid-Action Receipt Integration Design

## 1. Overview

This document defines a **documentation-only** integration design for representing x402 paid HTTP/API actions as CommandLayer-signed CLAS action receipts.

The integration separates two concerns that are often conflated:

1. **Payment settlement attestation (x402 domain)**: whether a payment requirement was negotiated, presented, and accepted under x402-compatible rules.
2. **Execution attestation (CommandLayer domain)**: what action was requested, what runtime executed, and what result was produced, with CLAS `metadata.proof` and signature evidence.

No production x402 implementation is included here.

## 2. Why x402 matters for CommandLayer

x402 introduces a standard interaction model for paid HTTP/API actions. For CommandLayer, this matters because it enables:

- explicit pre-execution payment gating for premium actions,
- uniform expression of payment requirements and acceptance state,
- deterministic mapping from paid request context to signed CLAS receipts,
- portable post-execution verification using CommandLayer signatures and VerifyAgent.

x402 improves economic coordination for APIs, while CommandLayer preserves verifiable agent/runtime execution semantics.

## 3. Trust boundary

### Boundary A: client ↔ x402 payment negotiation/settlement

- Covers payment requirement discovery, payment submission, and settlement acceptance/rejection.
- Establishes whether payment conditions were met for a specific paid action request.
- Trust result: "payment was accepted/rejected under the configured x402 provider flow."

### Boundary B: CommandLayer runtime execution + receipt signing

- Starts after the runtime decides a paid action is authorized to execute.
- Covers action input capture, execution outcome capture, and CLAS receipt signing.
- Trust result: "CommandLayer attests what executed and what result was returned."

**Important**:

- x402 payment proof is **not** a CLAS action receipt.
- x402 does **not** prove that the agent/runtime executed the action correctly.
- Public third-party verification begins when CommandLayer emits a signed CLAS receipt.

## 4. Paid-action lifecycle

1. **Client requests paid action**.
2. **Server returns `402 Payment Required`** with x402 payment requirements.
3. **Client pays through x402** and resubmits proof/payment context.
4. **Server verifies/accepts payment** using configured x402 provider adapters.
5. **Agent/runtime executes action** under CommandLayer policy.
6. **CommandLayer emits signed receipt** containing execution and payment linkage metadata.
7. **VerifyAgent verifies receipt** (signature integrity, policy checks, trace coherence).

## 5. CLAS receipt shape

A CLAS paid-action receipt should encode execution truth plus payment linkage, while keeping payment settlement and execution proof semantically separate:

```json
{
  "receipt_id": "rcpt:clas:act_01JW7R6Y8W8JQ5H7GH2D0P0F8N",
  "action": "summarize.text",
  "status": "succeeded",
  "requested_at": "2026-05-22T12:00:00Z",
  "executed_at": "2026-05-22T12:00:02Z",
  "result": {
    "summary": "Short technical summary..."
  },
  "metadata": {
    "trace": {
      "request_id": "req_9f2f5f25",
      "payment_id": "pay_x402_7f31",
      "provider": "x402-compatible",
      "workflow_id": "wf_2a10"
    },
    "proof": {
      "payment": {
        "scheme": "x402",
        "settlement_status": "accepted",
        "payment_ref": "pay_x402_7f31"
      },
      "execution": {
        "runtime_id": "rt_prod_1",
        "agent_id": "agent_summarizer_v3",
        "policy_hash": "sha256:ab12..."
      }
    }
  },
  "proof": {
    "signature": [
      {
        "role": "runtime",
        "alg": "Ed25519",
        "key_id": "cl_runtime_key_2026_01",
        "sig": "base64..."
      }
    ]
  }
}
```

## 6. `metadata.trace` usage

`metadata.trace` provides correlation fields across request ingress, payment processing, execution, and verification.

Recommended minimum fields:

- `request_id`: idempotency/correlation anchor for the paid action attempt,
- `payment_id`: x402 payment correlation identifier,
- `receipt_id`: CLAS artifact identifier (may also appear top-level),
- `workflow_id` or equivalent runtime correlation identifier.

Guidelines:

- include stable identifiers, not secrets;
- avoid raw private keys, bearer tokens, or full card/wallet secrets;
- keep trace values deterministic enough for replay analysis and duplicate detection.

## 7. `proof.signature` roles

CommandLayer supports single-signature and multi-signature role entries. For paid actions, roles may include:

- `user`: indicates end-user assent or request signing (optional).
- `payer`: indicates payer-side cryptographic attestation where available (optional and provider-dependent).
- `agent`: attests agent-level transformation/decision output.
- `runtime`: attests execution envelope and canonical receipt emission.
- `verifier`: attests post-hoc verification outcome in derived or companion receipts.

Role notes:

- Minimum public-verification baseline is usually a valid `runtime` signature.
- Multi-signature receipts should preserve explicit role labeling to avoid signature ambiguity.

## 8. Example: paid summarize action

### Paid action request

```json
{
  "request_id": "req_9f2f5f25",
  "action": "summarize.text",
  "input": {
    "text": "Long technical document..."
  },
  "payment": {
    "required": true,
    "plan": "pro",
    "max_amount": "0.05",
    "currency": "USD"
  }
}
```

### Payment accepted event

```json
{
  "event": "payment.accepted",
  "request_id": "req_9f2f5f25",
  "payment_id": "pay_x402_7f31",
  "provider": "x402-compatible",
  "settled_amount": "0.05",
  "currency": "USD",
  "accepted_at": "2026-05-22T12:00:01Z"
}
```

### CLAS receipt after execution

```json
{
  "receipt_id": "rcpt:clas:act_01JW7R6Y8W8JQ5H7GH2D0P0F8N",
  "request_id": "req_9f2f5f25",
  "payment_id": "pay_x402_7f31",
  "action": "summarize.text",
  "status": "succeeded",
  "result": {
    "summary": "Short technical summary..."
  },
  "proof": {
    "signature": [
      {
        "role": "runtime",
        "alg": "Ed25519",
        "key_id": "cl_runtime_key_2026_01",
        "sig": "base64..."
      }
    ]
  }
}
```

## 9. Example: paid verification call

A verifier-facing flow can be payment-gated while still yielding a CLAS-verifiable output artifact:

1. Client requests `verify.receipt` for a target receipt.
2. Service returns `402` with verification pricing requirements.
3. Client completes x402 payment flow.
4. Service executes VerifyAgent and/or runtime verification.
5. Service returns verification result plus signed verification receipt.

Illustrative response payload:

```json
{
  "action": "verify.receipt",
  "target_receipt_id": "rcpt:clas:act_01JW7R6Y8W8JQ5H7GH2D0P0F8N",
  "verification": {
    "status": "valid",
    "checks": ["signature", "trace_consistency", "policy_constraints"]
  },
  "proof": {
    "signature": [
      {
        "role": "verifier",
        "alg": "Ed25519",
        "key_id": "cl_verify_key_2026_01",
        "sig": "base64..."
      }
    ]
  }
}
```

## 10. Failure modes

- **payment missing**: no valid payment context after `402` requirement; action is not executed.
- **payment invalid**: payment proof fails provider validation; action is not executed.
- **payment accepted but action failed**: receipt should record `status: failed` with structured error outcome.
- **action executed but receipt signing failed**: execution occurred but no portable attestation; must emit internal critical event and retry/compensate.
- **duplicate payment/action request**: idempotency logic must prevent duplicate execution and duplicate receipts.
- **verifier unavailable**: verification action cannot complete; return explicit retriable/unavailable state.

## 11. Idempotency

Use three distinct identifiers:

- `request_id`: semantic action-attempt identity.
- `payment_id`: settlement identity in x402 provider domain.
- `receipt_id`: CLAS attestation artifact identity.

Recommended constraints:

- one `request_id` maps to at most one canonical execution outcome;
- one accepted `payment_id` is bound to one request scope/policy scope;
- one canonical execution outcome maps to one canonical `receipt_id` (retries should not fork receipt truth).

## 12. Settlement vs execution proof

Settlement proof answers: **"Was payment accepted for this request scope?"**

Execution proof answers: **"What action executed, under what runtime context, with what result?"**

Design rule: keep these proofs linked but non-substitutable. A valid payment signal is insufficient to claim execution correctness; a valid execution receipt does not imply payment settlement unless explicitly linked.

## 13. Future integration with Coinbase AgentKit / Agentic Wallet

Future adapters may use Coinbase AgentKit or Agentic Wallet primitives as one x402-compatible payment backend. In that model:

- AgentKit/Wallet tools can originate payer intents and settlement references.
- CommandLayer still owns canonical action execution receipt emission.
- Provider abstraction remains open so non-Coinbase x402-compatible providers can be added without changing CLAS receipt semantics.

## 14. Non-goals

- This design does **not** claim CommandLayer settles payments.
- This design does **not** claim x402 alone proves agent/runtime execution.
- This design does **not** require Coinbase/CDP as the only x402 provider.
- This design does **not** introduce production x402 runtime code in this change.

## Signed example endpoint

A server-side example endpoint is available at `POST /api/examples/x402-paid-action` (`api/examples/x402-paid-action.js`).

### Request example

```json
{
  "request_id": "req_9f2f5f25",
  "action": "summarize.text",
  "input": {
    "text": "Long technical document..."
  },
  "payment": {
    "payment_id": "pay_x402_7f31",
    "protocol": "x402",
    "status": "accepted",
    "asset": "USDC",
    "amount": "0.01",
    "network": "base"
  }
}
```

### Success status

The endpoint returns status `PAID_ACTION_EXECUTED_AND_SIGNED` with a signed CLAS-style receipt.

### Verification command

You can verify the returned receipt with the existing verify endpoint:

```bash
curl -sS -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"receipt": {"...": "signed receipt payload"}}'
```

### Trust boundary reminder

x402 payment acceptance is not the same as execution proof. Payment rails attest payment acceptance/settlement state, while CommandLayer receipts attest the requested action, execution result, and signer-bound proof for that execution.
