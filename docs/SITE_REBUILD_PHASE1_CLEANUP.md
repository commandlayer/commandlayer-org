# SITE REBUILD — Phase 1 Cleanup & Navigation Containment

## Scope of this phase
- **No file deletion.**
- **No homepage rewrite.**
- **No CSS refactor.**
- Objective: contain legacy surfaces in navigation, define redirect/archive plan, and reduce protocol-credibility risk before foundation rebuild.

## Navigation audit (current state)
Current public pages use multiple inconsistent nav systems:
- Legacy protocol nav (`Home`, `Capabilities`, `Verifier`, `SDK`, `Docs`, `Claim`, `GitHub`) on pages like `verify.html`, `claim.html`, `trust-verification.html`, `how-it-works.html`.
- Demo-heavy nav (`Home`, `Commons Demo`, `Commerce Demo`, `Verifier`, `Quickstart`, `Docs` dropdown, `Claim`, `GitHub`) on pages like `commons.html`, `commercial.html`, `runtime.html`, `demo-inner.html`, `repositories.html`, `licensing.html`.
- Docs-specific nav on `docs.html` (`Home`, `Verifier`, `Quickstart`, `Wrap Your Agent`, `Ambient Verify`, `How It Works`, `Claim`, `GitHub`).

This split weakens information hierarchy and protocol trust posture.

## Recommended final navigation
### Top nav (target)
1. Home
2. Protocol
3. Capabilities
4. Verifier
5. SDK
6. Docs
7. Claim
8. GitHub (external)

### Footer nav (target)
- Protocol
- Proof
- Runtime
- MCP
- VerifyAgent
- Schemas
- API
- Licensing
- Security
- Changelog

### Docs nav (target)
- Getting Started
- Proof Model
- Capabilities
- Trust Verification
- SDK
- API
- Schemas
- Examples

## Pages to remove from main nav (not deleted)
- `/composer.html` (Commons Demo)
- `/demo-inner.html` (Commerce Demo)
- `/quickstart.html` (legacy quickstart surface)
- `/ambient-verification.html`
- `/how-it-works.html`
- `/verify-badge-demo.html`
- `/stack-proof-demo.html`
- `/repositories.html`
- `/faq.html`
- `/about.html`
- Existing docs dropdown leaf pages as top-level affordances (`/commons.html`, `/commercial.html`, `/agent-cards.html`, `/runtime.html`)

## Page disposition plan (archive/merge/redirect)

| Page | Action | Redirect target | Salvage content? | Risk if left live |
|---|---|---|---|---|
| `/commons.html` | Merge into new `/protocol` information architecture | `/protocol` | Yes — schema model and contract language | Keeps “Commons” as top-level concept, conflicting with preferred nav and increasing cognitive load |
| `/commercial.html` | Merge into `/capabilities` + `/protocol` | `/capabilities` | Yes — commerce verb framing | Splinters protocol model and looks product-fragmented |
| `/agent-cards.html` | Merge into docs (`/docs` capability/discovery section) | `/docs` | Yes — discovery mechanics | Over-indexes implementation detail in primary journey |
| `/runtime.html` | Keep as protocol subpage but remove from top-level nav | `/protocol/runtime` (future) | Yes — execution layer explanation | Competes with primary narrative and exposes unfinished architecture edges |
| `/quickstart.html` | Archive and replace with docs getting-started | `/docs#getting-started` | Partial — runnable snippets | Legacy flow and proof language mismatches likely persist |
| `/ambient-verification.html` | Merge into verifier/proof docs | `/docs#trust-verification` | Yes | Repetition and possible over-claim confusion |
| `/how-it-works.html` | Merge into protocol overview | `/protocol` | Yes | Duplicative explanations diverge over time |
| `/verify-badge-demo.html` | Archive | `/verify.html` | Minimal | Demo endpoints may be interpreted as production guarantees |
| `/stack-proof-demo.html` | Archive to proof docs examples | `/docs#proof-model` | Yes — explanatory caveats | Terminology drift around proof semantics |
| `/demo.html` | Archive | `/capabilities` | No/Minimal | Outdated demo can undermine trust posture |
| `/composer.html` | Archive from nav; keep discoverable from capability docs | `/capabilities#actions` | Partial | Demo-centric framing dominates protocol-first messaging |
| `/demo-inner.html` | Archive from nav; keep in examples only | `/docs#examples` | Partial | Contains placeholder verifier language, credibility risk |
| `/sdk-records.html` | Merge into `/sdk` page | `/sdk` | Yes | Fragmented SDK story |
| `/docs.html` + `/docs/wrap-your-agent.html` | Merge under unified docs IA | `/docs` | Yes | Two parallel docs entrypoints dilute authority |
| `/verify/r/index.html` | Clarify as verifier route variant | `/verify.html` | No (route utility only) | Duplicate verifier surface confuses canonical endpoint |
| `/trust-verification.html` | Keep but fold into docs/proof model | `/docs#trust-verification` | Yes | Standalone page duplicates verifier docs |
| `/repositories.html` | Archive from nav to footer/developer resources | `/docs#repositories` | Partial | Repo catalog in main journey feels internal/unfinished |
| `/faq.html` | Footer-only | `/docs#faq` (future) | Yes | Can age quickly and conflict with docs |
| `/about.html` | Footer-only | `/protocol` (or `/about` if retained) | Partial | Non-protocol-first attention diversion |
| `/licensing.html` | Footer-only keep live | `/licensing.html` | Yes | Low risk if accurate; should not dominate top nav |

## Carefully handled pages (explicitly retained for rebuild)
- `capabilities.html`: **rebuild, do not delete**. Make this the expandable verb-family hub:
  - Trust Verification v1
  - AI Actions / Utility Actions
  - Commerce
  - Identity
  - Governance
  - Data
  - Messaging
  - Payments
  - Policy
  - Compliance
- `claim.html`: **rebuild, do not delete** unless fully non-functional after audit.
- Verifier surfaces (`verify.html`, `verify/r/index.html`, trust-verification pages): **merge/clarify canonical route and docs**; do not remove verification utility.
- `GitHub` remains top-nav external link.

## Stale claims & terminology audit (by file)

### High-risk stale/legacy wording
- `public/docs.html`
  - “hackathon demo” language in ENS verification note.
- `public/demo-inner.html`
  - Placeholder verifier result language (`stub_verifier`, “placeholder”).

### Proof-field exposure requiring migration planning (not immediate deletion)
- `docs/wrap-your-agent.md`
  - Uses `metadata.proof.hash_sha256` examples.
- `public/index.html`
  - References `metadata.proof.hash_sha256`.
- `public/composer.html`, `public/quickstart.html`, `public/demo-inner.html`
  - References `hash_sha256` and `signature_b64` proof internals.
- Sample/demo receipts under `public/assets/receipts`, `public/examples`, `public/receipts`
  - Include `hash_sha256` / `signature_b64` fields.

### Terms searched and status
- Found: `hash_sha256`, `signature_b64`, `schema-valid`, `hackathon`, `placeholder`, `trust root` references.
- Not found in audited pages: `proof.alg`, `proof.signature`, `proof.canonical`, `proof.kid`, explicit `top-level proof`, explicit `lowercase ed25519`, explicit `MCP signs`, explicit `MVP`, explicit `coming soon`.

## “Do not carry forward” list (for Phase 2 content rewrite)
1. Legacy proof-field emphasis as primary trust UX (e.g., raw `hash_sha256`/`signature_b64` education in primary marketing surfaces).
2. Fake/stub verification language or placeholder production framing.
3. Any wording that implies “schema-valid” alone equals cryptographically verified.
4. Any wording that implies MCP is signer or trust root.
5. Hackathon/MVP framing on production-facing protocol pages.
6. Unsupported production guarantees not backed by canonical verifier behavior.

## Redirect implementation plan (execution-ready map)
- `/commons.html` -> `/protocol`
- `/commercial.html` -> `/capabilities`
- `/agent-cards.html` -> `/docs`
- `/runtime.html` -> `/protocol/runtime`
- `/quickstart.html` -> `/docs#getting-started`
- `/ambient-verification.html` -> `/docs#trust-verification`
- `/how-it-works.html` -> `/protocol`
- `/verify-badge-demo.html` -> `/verify.html`
- `/stack-proof-demo.html` -> `/docs#proof-model`
- `/demo.html` -> `/capabilities`
- `/composer.html` -> `/capabilities#actions`
- `/demo-inner.html` -> `/docs#examples`
- `/sdk-records.html` -> `/sdk`
- `/docs/wrap-your-agent.html` -> `/docs`
- `/verify/r/` -> `/verify.html`
- `/trust-verification.html` -> `/docs#trust-verification`
- `/repositories.html` -> `/docs#repositories`
- `/faq.html` -> `/docs#faq`
- `/about.html` -> `/protocol`

## Phase 1 completion criteria
- Navigation containment complete (no obsolete/demo-first links in top nav).
- Redirect map approved.
- Archive list approved.
- Capability/Claim/Verifier pages tagged for rebuild with retained URLs.
