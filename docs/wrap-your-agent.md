# Wrap your agent

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

The verifier:

- rebuilds the canonical receipt payload
- recomputes the SHA-256 hash
- compares it to `metadata.proof.hash_sha256`
- resolves signer key metadata from ENS when available
- validates the Ed25519 signature
- returns `VERIFIED` or `INVALID`

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

If input or output is changed after signing, the recomputed hash will not match and verification returns `INVALID`.

## ERC-8004-ready discovery record

VerifyAgent.eth is published as an **ERC-8004-ready** and **discoverable verification service** metadata record:

- `/sdk-records/verifyagent.eth.json`

This is service metadata for discovery/readiness and does not claim on-chain ERC-8004 registration by itself.
