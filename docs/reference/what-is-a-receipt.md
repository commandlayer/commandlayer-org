# What is an agent receipt

An agent receipt is CommandLayer's proof object for completed execution.

It is not just a log line and not just an opaque runtime payload. A receipt is the canonical, versioned result contract returned after an agent action runs.

## Definition

A receipt should tell an independent reader enough to answer the core trust questions:

- which verb executed
- which schema version governed the result
- whether execution succeeded or failed
- what the verb-specific output was
- which signer or proving surface produced the result, when signatures are attached

## Why receipts matter

CommandLayer's thesis is simple: agents can act, so systems need proof of what they did.

Receipts are that proof surface because they are:

- **structured**: they validate against published JSON Schemas
- **portable**: the contract can survive a runtime swap
- **inspectable**: clients can store and review them later
- **verifiable**: hashes and signatures can be checked independently

## Minimal receipt model

At minimum, a canonical receipt is the contract-level result of a published verb.

Typical fields include:

- `verb`
- `schema_version`
- `status`
- verb-specific output fields

Runtime-specific trace or proof metadata may be attached around that receipt, but those additions should not redefine the canonical contract.

## Where receipts sit in the stack

- **Commons** defines the minimum verifiable receipt model.
- **Commercial** extends the same idea for commerce-oriented flows.
- **Runtime** executes contracts and may attach extra proof metadata.
- **Agent Cards** help clients discover who supports which contracts.

## Canonical source

For the primary public explanation, use the site docs and contract pages in `public/`.
