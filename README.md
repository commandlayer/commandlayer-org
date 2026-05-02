# commandlayer-org

Agents don’t make claims — they produce proof.
Wrap → sign → verify.
CommandLayer turns any agent action into a signed, verifiable receipt.
VerifyAgent.eth is the public verifier for CommandLayer receipts.

## Shipped proof flow

- Verifier UI: https://www.commandlayer.org/verify.html
- Raw verifier API: POST https://www.commandlayer.org/api/verify
- Callable VerifyAgent endpoint: POST https://www.commandlayer.org/api/agents/verifyagent
- npm: `npm install @commandlayer/agent-sdk`

## Core flow

Agent action  
→ SDK wraps action  
→ signed receipt is emitted  
→ VerifyAgent verifies receipt  
→ VERIFIED or INVALID

If the output changes, the proof breaks.

## Repos

- **agent-sdk**: wrap any agent action and emit a signed receipt
- **verifyagent**: reference verifier and tamper-detection demo
- **commandlayer-org**: hosted UI, public APIs, and docs

## Developer quickstart

```ts
import { CommandLayer } from "@commandlayer/agent-sdk";

const cl = new CommandLayer({
  agent: "runtime.commandlayer.eth",
  privateKey: process.env.CL_PRIVATE_KEY_PEM,
  keyId: "vC4WbcNoq2znSCiQ"
});

const result = await cl.wrap("summarize", async () => {
  return { summary: "hello world" };
});

const verified = await cl.verify(result.receipt);
console.log(verified.status);
```

## Public verification APIs

### 1) `POST /api/verify`

**Purpose:** Verifies a raw CommandLayer receipt.

**Request:** Raw receipt JSON.

**Response:**

```json
{
  "ok": true,
  "status": "VERIFIED",
  "reason": "Receipt verification passed.",
  "signer": "runtime.commandlayer.eth",
  "verb": "agent.execute",
  "hash": "...",
  "hash_matches": true,
  "signature_valid": true,
  "ens_resolved": true,
  "key_id": "..."
}
```

### 2) `POST /api/agents/verifyagent`

**Purpose:** Callable VerifyAgent.eth endpoint for agent-to-agent or app-to-agent verification.

**Request:**

```json
{
  "receipt": { "...": "CommandLayer receipt" }
}
```

**Response:**

```json
{
  "agent": "verifyagent.eth",
  "action": "verify_receipt",
  "ok": true,
  "status": "VERIFIED",
  "result": {
    "reason": "Receipt verification passed.",
    "hash_matches": true,
    "signature_valid": true,
    "ens_resolved": true
  }
}
```

VerifyAgent.eth does not execute the original task. It verifies whether a submitted receipt is valid or tampered.

### cURL examples

```bash
curl -X POST https://www.commandlayer.org/api/verify \
  -H "Content-Type: application/json" \
  --data-binary @public/examples/sample-receipt.json
```

```bash
printf '{"receipt":' > verifyagent-body.json
cat public/examples/sample-receipt.json >> verifyagent-body.json
printf '}' >> verifyagent-body.json

curl -X POST https://www.commandlayer.org/api/agents/verifyagent \
  -H "Content-Type: application/json" \
  --data-binary @verifyagent-body.json
```

## What verification checks

- canonical JSON payload using `json.sorted_keys.v1`
- SHA-256 hash matches `metadata.proof.hash_sha256`
- Ed25519 signature validates
- signer key metadata resolves through ENS when available
- tampered input/output returns `INVALID`

## Advanced protocol layers

CommandLayer also includes deeper protocol and discovery work, including Commons, Agent Cards, Runtime, and Commercial extensions. These are supporting layers. The current public demo focuses on the proof loop: signed receipts and public verification.

## Local development

### Install

```bash
npm install
```

### Run locally

```bash
vercel dev
```

If you use another local workflow, keep the site static-first and preserve published URL paths.

## Deployment note

Published URLs are part of the protocol surface.

Do not rename or move stable public paths for:

- docs pages
- schema URLs
- Agent Card URLs
- demo surfaces
