# Receipt hashing

Hashing turns a visible receipt into a deterministic byte-level fingerprint.

That matters because signatures and proofs are only trustworthy if different verifiers can recompute the same digest from the same receipt.

## Deterministic rules

A useful receipt hash depends on three things staying stable:

- the exact receipt content being hashed
- the canonical serialization rule
- the hash algorithm identifier

If any of those change silently, verification becomes ambiguous.

## What should affect the hash

The canonical receipt content should affect the digest.

For example:

- verb identity
- schema version
- status
- verb-specific output fields

## What should not affect the hash

Presentation-only or transport-only differences should not change the digest.

For example:

- pretty-print whitespace
- field order when canonical serialization already defines one
- wrapper metadata that sits outside the canonical receipt contract

## Why this matters for CommandLayer

CommandLayer separates contract truth from execution context.

That means a runtime may expose trace IDs, timing, or proof metadata around a receipt, while the canonical receipt hash remains focused on the contract-level result being proven.

## Practical guidance

When documenting or implementing receipt hashing, always publish:

- the canonicalization rule name
- the hash algorithm
- the exact payload scope being hashed

Without those three pieces, a verifier cannot reproduce the proof reliably.
