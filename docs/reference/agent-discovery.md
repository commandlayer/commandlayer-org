# Agent discovery and identity

CommandLayer separates discovery from contract definition.

That is why Agent Cards exist.

## What Agent Cards do

Agent Cards tell clients:

- who the agent is
- which verbs it supports
- which schema versions it speaks
- where requests should be routed
- which identity claims are associated with it

## What Agent Cards do not do

Agent Cards do **not** redefine request or receipt semantics.

The contract still lives in Commons or Commercial schemas. Agent Cards sit above that layer and help clients find compatible agents. VerifyAgent.eth is separate: it is the public verifier layer, not an Agent Card.

## Identity role

Human-readable identity matters because receipts are stronger when attribution is legible.

In practice, CommandLayer uses identity bindings so a verifier can connect:

- a contract result
- a signer or proving surface
- a discovery record
- a routable agent endpoint

## Stack placement

- **Commons / Commercial:** contract truth
- **Agent Cards:** discovery and routing
- **Runtime:** execution and optional proof metadata

Keeping those roles separate makes the system easier to audit.

## Related references

- [Common verbs](./common-verbs.md)
- [How to verify receipts](./verify-receipts.md)
