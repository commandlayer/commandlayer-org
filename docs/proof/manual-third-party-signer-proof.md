# Manual third-party signer proof

## What this proves

A non-runtime agent identity can sign a CommandLayer action receipt locally, and the existing public verifier can verify it by resolving that agent’s ENS TXT public-key records.

## What this does not prove

* automated tenant onboarding is complete
* ENS TXT records are automatically published during claim flow
* CommandLayer holds tenant private keys
* full receipt chain continuity is enforced
* platform Genesis receipts are tenant-signed

## Procedure

1. Choose a controlled signer name, example:
   `proof.approveagent.eth`
2. Run identity generation command:

   ```bash
   TENANT_AGENT_ENS='proof.approveagent.eth' node scripts/manual-tenant-proof.cjs generate
   ```

   This writes the local identity package under `.local/tenant-proof/<TENANT_AGENT_ENS>/`. The private key remains local and must never be published, uploaded, or committed.
3. Publish the four generated TXT records in ENS Manager for that exact signer name.

   The four TXT records also appear in:

   ```text
   .local/tenant-proof/<TENANT_AGENT_ENS>/ens-records.txt
   ```

   They have this shape:

   ```text
   cl.sig.pub=ed25519:<base64 raw public key>
   cl.sig.kid=<generated kid>
   cl.sig.canonical=json.sorted_keys.v1
   cl.receipt.signer=<TENANT_AGENT_ENS>
   ```
4. Verify the TXT records are live using the same production resolver path where possible. The verifier must be able to resolve all four records from the chosen signer name before the signed receipt can verify.
5. Run signing command:

   ```bash
   TENANT_AGENT_ENS='proof.approveagent.eth' node scripts/manual-tenant-proof.cjs sign
   ```

   This writes the signed local receipt to:

   ```text
   .local/tenant-proof/<TENANT_AGENT_ENS>/signed-approve-receipt.json
   ```
6. Paste the generated receipt JSON into:
   `/verify.html`
7. Confirm expected successful output:

   * `status: VERIFIED`
   * `signer: proof.approveagent.eth`
   * `public_key_source: ens_txt`
   * `ens_resolved: true`
   * `hash_matches: true`
   * `signature_valid: true`
   * `key_id: <tenant kid>`

## Negative tests

1. Change `output.decision` after signing → expect `INVALID`.
2. Change top-level signer to `runtime.commandlayer.eth` without resigning → expect `INVALID`.
3. Change `metadata.proof.signature.kid` → expect `INVALID`.

## Evidence capture

Capture screenshots of:

* ENS TXT records configured for the chosen signer name, without any private key visible.
* Public verifier returning `VERIFIED` for the tenant-signed receipt.
* Public verifier returning `INVALID` after tampering.
