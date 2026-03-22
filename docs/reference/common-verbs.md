# Common verbs

Commons is the canonical open contract layer in CommandLayer.

It defines a small set of general-purpose verbs that give agents a shared language before runtime-specific behavior enters the picture.

## What Commons is for

Commons covers actions that appear across many agent systems, such as:

- fetching
- analyzing
- summarizing
- parsing
- formatting
- describing
- converting

The exact live set is published on the website and under versioned schema paths. For the active current line, builders should target Commons v1.1.0.

## Contract discipline

Each Commons verb ships with:

- a `*.request` schema
- a `*.receipt` schema

Those schemas are the canonical contract surface.

## Builder rule

If you are trying to understand CommandLayer, start with Commons first.

Why:

- it is the cleanest expression of the receipt model
- it defines the minimum verifiable receipt
- it avoids confusing execution metadata with contract truth

## Relationship to Commercial

Commercial does not replace Commons.

Commercial extends the same contract-first discipline for commerce-oriented flows. In the current line, Commons is non-x402 and remains the canonical baseline model the rest of the stack should be explained from.

## Related references

- [What is an agent receipt](./what-is-a-receipt.md)
- [How to verify receipts](./verify-receipts.md)
