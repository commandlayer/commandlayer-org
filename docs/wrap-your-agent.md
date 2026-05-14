# Wrap Your Agent

Turn any agent action into a signed, verifiable receipt.

This is the core primitive of CommandLayer:

**Agents don't make claims — they produce proof.**

---

## Install

```bash
npm install @commandlayer/agent-sdk
```

## What this does

When you wrap an agent action:

- Your action executes normally
- CommandLayer captures the output
- A canonical receipt is created
- The receipt is hashed with SHA-256
- The hash is signed with Ed25519
- The receipt can be verified independently through VerifyAgent.eth

## Quick start

```ts
import { CommandLayer } from "@commandlayer/agent-sdk";

const cl = new CommandLayer({
  agent: "runtime.commandlayer.eth",
  privateKey: process.env.CL_PRIVATE_KEY_PEM,
  keyId: "vC4WbcNoq2znSCiQ",
  verifierUrl: "https://www.commandlayer.org/api/verify"
});

const result = await cl.wrap("summarize", async () => {
  return { summary: "hello world" };
});

console.log(result.output);
console.log(result.receipt);

const verified = await cl.verify(result.receipt);
console.log(verified.status);
```

## What `wrap()` returns

`wrap()` returns both:

- `output` — the value returned by your agent function
- `receipt` — the signed CommandLayer receipt for that action

### Example

```ts
const result = await cl.wrap("summarize", async () => {
  return { summary: "AI agents need verification" };
});

console.log(result.output);
console.log(result.receipt);
```

### Example receipt

```json
{
  "signer": "runtime.commandlayer.eth",
  "verb": "summarize",
  "ts": "2026-05-02T02:53:33.056Z",
  "input": {},
  "output": {
    "summary": "hello world"
  },
  "execution": {
    "status": "ok",
    "duration_ms": 1,
    "started_at": "2026-05-02T02:53:33.056Z",
    "completed_at": "2026-05-02T02:53:33.057Z"
  },
  "metadata": {
    "proof": {
      "canonicalization": "json.sorted_keys.v1",
      "hash_sha256": "14e559e9454eaba437934220623b95947fdbaf38d45a1d358c327622c8352617"
    }
  },
  "signature": {
    "alg": "ed25519",
    "kid": "vC4WbcNoq2znSCiQ",
    "sig": "..."
  }
}
```

## What verification checks

The verifier:

- Rebuilds the canonical receipt payload
- Recomputes the SHA-256 hash
- Compares it to `metadata.proof.hash_sha256`
- Resolves signer key metadata from ENS when available
- Validates the Ed25519 signature
- Returns `VERIFIED` or `INVALID`

If the input or output changes after signing, the recomputed hash no longer matches and verification returns `INVALID`.

## ENS signer records

The signer should publish key metadata through ENS TXT records.

For `runtime.commandlayer.eth`, the important records are:

```
cl.sig.kid=vC4WbcNoq2znSCiQ
cl.sig.pub=ed25519:<base64-public-key>
cl.sig.canonical=json.sorted_keys.v1
cl.receipt.signer=runtime.commandlayer.eth
```

The private key stays local. Never commit it, paste it into frontend code, or publish it.

## Verify through the public API

```ts
const verified = await cl.verify(result.receipt);
if (verified.status === "VERIFIED") {
  console.log("VERIFIED");
} else {
  console.log("INVALID");
}
```

Default verifier:

```
POST https://www.commandlayer.org/api/verify
```

## VerifyAgent.eth callable endpoint

VerifyAgent.eth can also be called directly:

```
POST https://www.commandlayer.org/api/agents/verifyagent
```

### Request

```json
{
  "receipt": {
    "...": "CommandLayer receipt"
  }
}
```

VerifyAgent.eth does not execute the original task. It verifies whether a submitted receipt is valid or tampered.

## Verify in the browser

Paste any receipt into:

```
https://www.commandlayer.org/verify.html
```

Expected behavior:

- valid receipt → VERIFIED
- tampered receipt → INVALID

## Full proof demo

The SDK includes a full proof-loop demo:

```bash
npm run example:demo
```

It runs:

```
wrap action → emit receipt → verify → tamper → verify invalid
```

Expected output:

```
Original receipt verification: VERIFIED
Tampered receipt verification: INVALID
```

## Why this matters

Without CommandLayer:

- agents only claim what happened
- platforms are trusted by default
- outputs can be edited without proof
- verification is not portable

With CommandLayer:

- every action can produce a signed receipt
- signer identity can be resolved through ENS
- receipts can be verified independently
- tampering breaks the proof

## Design principles

- deterministic receipts
- independent verification
- no platform trust required
- composable across agents and apps

## Next steps

- Install the SDK
- Wrap one important agent action
- Emit a signed receipt
- Verify it through VerifyAgent.eth
- Expose receipts anywhere users need proof

## One-line summary

**Wrap your agent → produce a receipt → prove what actually happened.**
