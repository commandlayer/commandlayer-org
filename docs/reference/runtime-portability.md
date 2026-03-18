# Runtime portability

CommandLayer is designed so meaning survives a runtime swap.

That is the point of separating contracts from execution.

## What should stay stable

Across runtimes, the following should remain stable:

- verb names
- schema versions
- request semantics
- receipt semantics
- verification rules for canonical contracts

## What may differ safely

Different runtimes may still differ in:

- routing
- scheduling
- policy enforcement
- throughput
- pricing
- trace and orchestration metadata
- optional proof attachments

Those differences belong to the execution layer, not the contract layer.

## Portability rule

A client should be able to:

1. build against a published schema
2. send the request through different compliant runtimes
3. receive canonical receipts that still validate against the same published contract

That is the architectural trust story: open semantics, competitive execution.

## Commercial note

Commercial currently preserves a commerce-oriented compatibility shape, while Commons is the cleaner canonical model. That structural asymmetry should be understood as a compatibility-preserving product reality, not as a contradiction in the stack.

## Related references

- [What is an agent receipt](./what-is-a-receipt.md)
- [How to verify receipts](./verify-receipts.md)
