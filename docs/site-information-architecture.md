# CommandLayer public-site information architecture — v3.2.1

## Primary pages

1. `/` — seller-side machine-service product story
2. `/services` — evidence-gated service catalog
3. `/discover` — machine discovery and acquisition flow
4. `/verify.html` — preserved working verifier tool
5. `/docs` — developer entry point
6. `/status` — truthful build / launch state
7. `/about` — company positioning
8. `/about/protocol` — protocol and trust-boundary background
9. `/catalog.json` — machine-readable catalog state

## Removed from primary navigation

The following older concepts remain as compatibility/reference pages where their files or demos are still useful, but they are no longer first-class product navigation:

- Capabilities
- Receipts
- Live Proof
- Claim
- Canonical Receipts
- Ambient Verification
- execution-receipt demos
- protocol-first homepage positioning

Public redirects retire the stale `capabilities.html`, `canonical-receipts.html`, and `ambient-verification.html` routes into the new information architecture. Other working proof/claim/admin/reference tools remain directly addressable until separately retired.

## Product truth requirements

- Never label a candidate service Live merely because a name or handler exists.
- First Three remain evidence-gated.
- Never represent a directory adapter as the product source of truth.
- Never represent a payment proof as execution proof.
- Never represent cryptographic receipt validity as factual truth.
- Keep irreversible action services gated until authorization, limits, replay safety, recovery, and compliance requirements are service-specifically satisfied.
