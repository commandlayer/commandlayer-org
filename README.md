# CommandLayer

CommandLayer is seller-side machine-service infrastructure: useful services that autonomous software buyers can discover, price, invoke, and verify.

The public site is intentionally moving from **protocol-first** positioning to **catalog / outcome-first** positioning. The protocol and verifier remain important infrastructure, but they are no longer the top-level product story.

## Primary public information architecture

- `/` — product home: machine services for autonomous agents
- `/services` — evidence-gated service catalog
- `/discover` — machine discovery / acquisition model
- `/verify.html` — existing public receipt verifier
- `/docs` — developer entry point
- `/status` — truthful public build / launch state
- `/about` — company positioning
- `/about/protocol` or `/protocol` — protocol background
- `/catalog.json` — machine-readable catalog state

## Catalog truth rules

- Candidate names are **not** live service claims.
- The First Three paid outcome services remain evidence-gated.
- A handler compiling does not make a service Live.
- A payment adapter existing does not make a service Live.
- An ENS name existing does not make a service Live.
- External directories are adapters/caches, not the product database.
- Execution receipts prove integrity/provenance/declared execution evidence; they do not certify factual truth.
- Payment proof and execution evidence remain separate concepts.

## Product flow

```text
machine need
  -> discover
  -> understand contract
  -> quote
  -> settle when required
  -> execute
  -> verify execution evidence
  -> repeat if useful
```

## Factory model

```text
primitives
  -> shared commercial factory
  -> evidence-selected outcomes
  -> generated discovery / identity / settlement adapters
```

The factory owns service manifests, economics, metering, provider composition, idempotency, state, telemetry, and execution evidence. HTTP/JSON is the canonical service surface; OpenAPI, MCP, ENS, x402, ERC-8004, A2A, and other ecosystems are adapters activated when appropriate.

## Existing proof and reference surfaces

The redesign does **not** delete working proof/verifier/reference tooling just to make the navigation cleaner. Existing pages such as the manual verifier, proof demos, runtime documentation, MCP documentation, SDK records, API reference, schemas, playground, integration demos, claim/admin tooling, and agent-card resources remain available unless separately retired.

The following legacy product pages are removed from the **primary information architecture/navigation** even when their files remain for compatibility:

- protocol-first Home positioning
- `Capabilities` as the primary catalog
- `Receipts` as the primary product page
- `Live Proof` as a top-level marketing section
- `Claim` as a top-level product CTA
- ambient/canonical/execution-receipt demo pages as primary navigation destinations

This avoids breaking existing links and demos while making the public story reflect the Machine-Service Factory.

## Verified technical surfaces

- Manual verifier: `/verify.html`
- Runtime verifier: `POST https://runtime.commandlayer.org/verify`
- Runtime signer endpoints: `POST https://runtime.commandlayer.org/trust-verification/{verb}/v1.0.0`
- SDK: `@commandlayer/agent-sdk`
- CLAS schemas: maintained in `commandlayer/clas`

## Trust boundaries

- Runtime executes/signs reference receipts.
- `runtime-core` owns canonicalization and cryptographic receipt primitives.
- VerifyAgent / verifier surfaces validate supported proof claims.
- MCP is an adapter.
- SDK wraps/integrates.
- Schemas describe contracts.
- Schema-valid alone is not cryptographically verified.
- A valid signature does not make an underlying factual statement universally true.

## Local checks

```bash
npm test
npm run check:links
npm run preview
```
