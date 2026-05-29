# CLAS Trust Verification v1

## 1. Overview

Trust Verification v1 defines a standards-oriented, machine-readable schema family for trust-related machine actions and decisions. It provides canonical verbs and structured receipts for verification, identity confirmation, permissioning, attestations, approvals, rejections, signatures, and endorsements.

The intent is protocol interoperability: consistent request/receipt structures that can be validated, exchanged, and independently verified across systems.

## 2. Canonical verbs

Trust Verification v1 defines these canonical verbs:

- `verify`
- `authenticate`
- `authorize`
- `attest`
- `sign`
- `permit`
- `grant`
- `approve`
- `reject`
- `endorse`

## 3. Verb definitions

- **verify**: checks whether a subject, proof, receipt, signature, artifact, claim, or workflow result is valid.
- **authenticate**: confirms the identity of an actor, signer, agent, service, key, user, or caller.
- **authorize**: determines whether an actor is allowed to perform an action under a policy or scope.
- **attest**: creates a signed claim about a subject.
- **sign**: applies cryptographic authorship, approval, or intent to a payload.
- **permit**: represents a portable permission artifact.
- **grant**: issues access, authority, rights, or permission to an actor.
- **approve**: records a positive decision on a proposal, transaction, request, deployment, or workflow step.
- **reject**: records a negative decision on a proposal, transaction, request, deployment, or workflow step.
- **endorse**: adds reputation, support, or trust weight to an actor, signer, claim, schema, service, or capability.

## 4. Semantic boundaries

- **verify vs attest**
  - `verify` evaluates existing evidence and returns a validity outcome.
  - `attest` produces new signed evidence (a claim) about a subject.

- **authenticate vs authorize**
  - `authenticate` answers "who is this actor?"
  - `authorize` answers "what is this actor allowed to do?"

- **authorize vs approve**
  - `authorize` is policy/scope enforcement for allowed actions.
  - `approve` is a decision event on a specific request, transaction, or workflow step.

- **grant vs permit**
  - `grant` is the issuance action that assigns rights.
  - `permit` is the transferable/portable artifact expressing those rights.

- **approve vs reject**
  - `approve` records a positive decision.
  - `reject` records a negative decision.

- **sign vs attest**
  - `sign` binds cryptographic intent/authorship to payload bytes.
  - `attest` expresses a semantic claim about a subject and is typically signed.

- **endorse vs certify**
  - `endorse` adds support or trust weight without claiming formal institutional certification.
  - `certify` is intentionally excluded from v1 because it overlaps with `verify` and `attest` and may imply regulatory or institutional certification semantics.

## 5. Shared proof model

Every receipt references the shared proof schema:

- `../_shared/proof.schema.json`

Shared proof fields (as defined in `_shared/proof.schema.json`):

- `metadata.proof.canonicalization` — canonicalization identifier (const: `json.sorted_keys.v1`)
- `metadata.proof.hash.alg` — hash algorithm (const: `SHA-256`)
- `metadata.proof.hash.value` — lowercase SHA-256 hex digest (`64` hex chars)
- `metadata.proof.signature.alg` — signature algorithm (const: `Ed25519`)
- `metadata.proof.signature.value` — signature value
- `metadata.proof.signature.kid` — key identifier

These fields provide a common cryptographic envelope model across all verb receipts.

## 6. Optional receipt chain fields

Receipts may include optional chain-linking fields without requiring full chain continuity enforcement yet:

- `chain_root` — the receipt chain root. For genesis receipts, `chain_root` is `sha256:<genesis_anchor_hash>`, where `genesis_anchor_hash` is computed from the canonical genesis payload with the derived `chain_root` field excluded. The signed genesis payload then includes that non-circular `chain_root` value, so tampering with chain fields invalidates the receipt without requiring `chain_root` to equal the final signed receipt hash. Action/example receipts may set it to `null` until full receipt storage is available.
- `previous_receipt_hash` — the prior receipt hash, or `null` when the prior receipt is not stored/resolved yet.
- `chain_index` — the zero-based chain index. Genesis receipts use `0`; action/example receipts may set it to `null`.
- `parent_receipt_id` — an optional caller-supplied parent receipt identifier, or `null`.

Request schemas also allow optional `parent_receipt_id` input so callers can link a new action to a prior receipt before strict chain continuity is enforced.

## 7. Schema-valid vs cryptographically valid

A receipt can be valid JSON and pass schema validation while still failing cryptographic verification.

Tampered receipts are expected to remain schema-valid but fail signature/hash verification.

Schema conformance and cryptographic integrity are separate checks and must both be evaluated.

## 8. Examples

Each verb's `examples/` folder includes:

- `valid.request.json`: a schema-valid request example for the verb.
- `valid.receipt.json`: a schema-valid receipt example with intact proof fields.
- `tampered.receipt.json`: a schema-valid receipt whose payload/proof relationship has been altered and should fail cryptographic verification.
- `invalid.receipt.json`: a receipt that fails schema validation.

## 9. File convention

Each verb folder contains:

- `<verb>.request.schema.json`
- `<verb>.receipt.schema.json`
- `examples/`
