# Tenant agent signer identity foundation

## Audit findings

- Claimed agents did **not** previously receive their own Ed25519 keypair during public claim intake, admin approval, card publishing, or genesis generation. Claim intake stores request metadata only; runtime receipt signing reads the platform signer from environment variables.
- Tenant private keys are not stored by the application today. The platform/runtime private key is read from signing environment variables for platform-issued receipts and webhook receipts; no tenant private-key custody table, encryption model, or KMS integration exists.
- Tenant public signer material was not stored per claimed agent before this foundation. Claim rows had legacy `public_key` / `kid` placeholders on `claim_requests`, but no per-agent signer identity tied to the claimed ENS name.
- ENS TXT verification already uses `receipt.signer` as the identity to resolve and expects `cl.sig.pub`, `cl.sig.kid`, `cl.sig.canonical`, and `cl.receipt.signer`; the verifier did not need a tenant hardcode.
- No onchain ENS TXT publication path exists in this repository. The admin flow now generates the exact record package and checks the records through the same resolver path used by receipt verification, but it does not claim to write records onchain.

## Custody model

This implementation chooses a user-controlled / bring-your-own-key foundation. CommandLayer stores only the tenant agent's public signer identity and deterministic ENS TXT instructions. The tenant or an external custody system remains responsible for the corresponding Ed25519 private key.

A production tenant-signed receipt endpoint should not be exposed until a secure tenant private-key custody decision is made, such as tenant-side signing, a KMS/HSM-backed custodial signer with scoped audit controls, or a one-time export flow with explicit user ownership. Until then, tenant action receipts are covered by injected signing fixtures in tests rather than a fake public/demo endpoint.

## Identity distinction

Platform-issued genesis receipts remain CommandLayer attestations:

```json
{
  "receipt_type": "genesis",
  "signer": "runtime.commandlayer.eth",
  "subject_agent": "acme.approveagent.eth",
  "issuer_role": "platform_genesis_attestor"
}
```

Tenant-issued action receipts are signed by the claimed agent and verified against that agent's own ENS TXT records:

```json
{
  "receipt_type": "action",
  "signer": "acme.approveagent.eth",
  "issuer_role": "tenant_agent",
  "verb": "approve"
}
```

## ENS TXT record package

For each tenant agent signer, publish these TXT records on the full agent ENS name:

```text
cl.sig.pub=ed25519:<tenant-public-key-base64>
cl.sig.kid=<tenant-key-id>
cl.sig.canonical=json.sorted_keys.v1
cl.receipt.signer=<full-agent-ens-name>
```

Record status must remain `records_pending` until ENS resolution confirms all four values match. A successful check can mark the signer identity `verified`.
