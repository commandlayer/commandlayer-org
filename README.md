# CommandLayer

CommandLayer turns agent actions into signed, independently verifiable receipts.

## Core flow

Action requested
→ runtime signs canonical receipt
→ verifier checks `metadata.proof`
→ valid receipts pass
→ tampered receipts fail

## Verified surfaces

- Manual verifier: `/verify.html`
- Production proof: `/stack-proof-demo.html`
- Automatic verification demo: `/webhook-auto-verify.html`
- Runtime verifier: `POST https://runtime.commandlayer.org/verify`
- Runtime signer endpoints: `POST https://runtime.commandlayer.org/trust-verification/{verb}/v1.0.0`
- SDK: `@commandlayer/agent-sdk@1.2.0`

## SDK example

```ts
import { CommandLayer } from "@commandlayer/agent-sdk";

const cl = new CommandLayer({
  agent: "runtime.commandlayer.eth",
  privateKeyPem: process.env.CL_PRIVATE_KEY_PEM,
  keyId: "vC4WbcNoq2znSCiQ",
  verifierUrl: "https://runtime.commandlayer.org/verify"
});

const result = await cl.wrap("summarize", async () => {
  return { summary: "hello world" };
});

const verified = await cl.verify(result.receipt);
console.log(verified.status);
```

## Canonical proof fields

- `metadata.proof.canonicalization = json.sorted_keys.v1`
- `metadata.proof.hash.alg = SHA-256`
- `metadata.proof.hash.value`
- `metadata.proof.signature.alg = Ed25519`
- `metadata.proof.signature.kid = vC4WbcNoq2znSCiQ`
- `metadata.proof.signature.value`
- `metadata.proof.signer_id = runtime.commandlayer.eth`

## Automatic verification proof

Valid receipt:

- `status = accepted`
- `verifier_status = VALID`
- `hash_matches = true`
- `signature_valid = true`

Tampered receipt:

- `status = rejected`
- `verifier_status = INVALID`
- `hash_matches = false`
- `signature_valid = false`

## Trust boundaries

- Runtime signs.
- Verifier validates.
- MCP bridges.
- SDK wraps.
- Schemas describe.
- Schema-valid alone is not verified.
- Webhook sender authentication is separate from receipt verification.
