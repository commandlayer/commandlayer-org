# How to verify receipts

Receipt verification should be boring.

The goal is not to trust a runtime because it says something happened. The goal is to check whether a published contract result is well-formed and whether any attached proof material matches it.

## Verification flow

### 1. Validate the receipt against its published schema

Use the versioned `*.receipt.schema.json` artifact for the verb you received.

This checks contract shape first:

- required fields exist
- field types are correct
- enumerations and constraints match the published contract

### 2. Recompute the canonical hash

If the receipt includes hash-based proof material, recompute the hash from the canonicalized receipt bytes using the documented hashing rules.

This checks that the signed or referenced payload matches the visible receipt.

### 3. Verify signatures when present

If the runtime or signer attaches a signature, verify it against the claimed public key or identity binding.

That proves attribution of the receipt to the signer. It does **not** prove the output is universally true; it proves the signer produced this contract-shaped result.

## What verification does and does not prove

Verification proves:

- the receipt conforms to the published contract
- the hashed payload matches the visible receipt
- the signer produced the signed payload, when signatures are present

Verification does not prove:

- the agent's answer is philosophically correct
- the downstream world state is desirable
- every runtime must expose the same optional metadata

## Layering rule

Start with the canonical receipt.

Only after validating the contract should you inspect <code>runtime_metadata</code> for trace IDs, proof blocks, or orchestration details.

## Related references

- [What is an agent receipt](./what-is-a-receipt.md)
- [Receipt hashing](./receipt-hashing.md)
- [Runtime portability](./runtime-portability.md)
