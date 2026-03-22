# commandlayer-org

Public website and proof surface for CommandLayer.

CommandLayer is a trust layer for autonomous agent execution:

- **Commons** is the canonical open contract layer and current-line builder default.
- **Commercial** is a separate commerce-oriented contract line that remains payment-aware.
- **Agent Cards** handle discovery and routing across both lines.
- **Runtime** executes contracts and may attach proof metadata without redefining the canonical receipt.

## Documentation authority

This repo intentionally has two documentation surfaces with different roles:

- **Primary public docs:** the website pages in `public/`, especially `public/docs.html`, `public/commons.html`, `public/commercial.html`, `public/runtime.html`, and `public/repositories.html`
- **Secondary repo reference:** the concise Markdown notes in `docs/` for contributors and reviewers

If the two ever drift, the site copy and published schema artifacts should be treated as the product-facing source of truth and corrected first.

## What this repo contains

- `public/` — static HTML pages, schema publishing paths, Agent Card examples, and demo assets
- `api/` — Vercel serverless endpoints used by the live demo and composer
- `docs/` — short repo-side reference notes that complement the public site docs

This repo should teach one architectural story consistently:

1. Commons v1.1.0 is the active current line and the minimum verifiable receipt model.
2. Commercial v1.1.0 is a separate payment-aware extension for economic flows.
3. Agent Cards define discovery and routing without changing contract semantics.
4. Runtime executes the contract and may add proof, trace, or orchestration metadata around the receipt.

## Version policy

- **Commons:** `v1.1.0` is the current builder target across the site and demo composer.
- **Commercial:** `v1.1.0` is the current commercial release across docs, schemas, demos, and runtime flows.
- **Agent Cards:** `v1.1.0` is the current card format across the registry, manifests, and linked examples.
- **Runtime:** execution layer, not a schema version line.
- **Compatibility:** published older paths remain live for verification and pinned integrations.

## Local development

### Install

```bash
npm install
```

### Run locally

```bash
vercel dev
```

If you use another local workflow, keep the site static-first and preserve published URL paths.

## Deployment note

Published URLs are part of the protocol surface.

Do not rename or move stable public paths for:

- docs pages
- schema URLs
- Agent Card URLs
- demo surfaces
