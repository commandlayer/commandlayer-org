# CommandLayer documentation

The public docs hub for CommandLayer lives on the website in `public/docs.html`, with the related contract pages in `public/commons.html`, `public/commercial.html`, `public/runtime.html`, and `public/agent-cards.html`.

This `docs/` tree is the lightweight repo-facing companion:

- it gives contributors and reviewers a short Markdown reference to the core trust model
- it points at the canonical public pages and schema paths
- it avoids duplicating long-form product copy that is maintained on the site

## Read in this order

1. [What is an agent receipt](./reference/what-is-a-receipt.md)
2. [How to verify receipts](./reference/verify-receipts.md)
3. [Receipt hashing](./reference/receipt-hashing.md)
4. [Common verbs](./reference/common-verbs.md)
5. [Runtime portability](./reference/runtime-portability.md)
6. [Agent discovery and identity](./reference/agent-discovery.md)
7. [ERC-8004 and x402 compatibility](./reference/erc8004-and-x402.md)

## Authority model

- The site is the primary **public explanation** surface.
- The Markdown docs in this repo are short reference notes for contributors, reviewers, and source control readers.
- The canonical **contract authority** lives in the upstream protocol repos; published `/schemas/...` paths in this repo are mirrors of those versioned artifacts, not a separate source of protocol truth.
- Runtime and SDK repos should implement and consume those artifacts without becoming competing authorities over contract meaning.


## Project architecture

- **VerifyAgent.eth:** Public verifier for CommandLayer receipts (MIT) — https://github.com/commandlayer/verifyagent
- **Runtime:** executes agent actions and emits signed receipts
- **SDK:** wraps agents and provides receipt tooling
- **Agent Cards:** identity and capability metadata
- **CommandLayer Commercial:** hosted runtime, paid APIs, x402, indexing, dashboards, and support
