# Site Map Audit (`public/*.html` and `public/docs/*.html`)

Scope audited:
- `public/*.html`
- `public/docs/*.html`
- No HTML files were modified.

## Classification summary

### Core product funnel
- `/index.html`
- `/capabilities.html`
- `/how-it-works.html`
- `/verify.html`
- `/docs.html`
- `/quickstart.html`

### Developer docs
- `/docs/wrap-your-agent.html`
- `/sdk-records.html`

### Protocol/reference
- `/trust-verification.html`
- `/commons.html`
- `/commercial.html`
- `/agent-cards.html`
- `/runtime.html`
- `/licensing.html`
- `/repositories.html`

### Commercial/revenue
- `/composer.html`
- `/demo-inner.html`
- `/commercial.html`
- `/licensing.html`

### Demo/dev-only
- `/verify-badge-demo.html`
- `/ambient-verification.html`
- `/demo.html`

### Candidate for deletion
- None hard-delete candidates in this pass (recommend soft-merge of overlaps first).

---

## Per-page audit

| Page path | Current purpose | Keep / Merge / Delete | Suggested destination if merged | Internal links that should point to it | Placement |
|---|---|---|---|---|---|
| `/index.html` | Primary marketing landing page and top-level CTA entry. | **Keep** | N/A | Site logo/home links, campaign links, docs intro links. | **Main nav** |
| `/capabilities.html` | Product capability overview with links to verification and docs. | **Keep** | N/A | Home CTA “capabilities”, docs cross-links, verification explainer links. | **Main nav** |
| `/how-it-works.html` | Explains verification model/flow in narrative form. | **Keep** | N/A | From `/docs.html`, `/verify.html`, and trust pages needing concept context. | **Main nav** |
| `/verify.html` | Main receipt verifier UI and entry for proof checks. | **Keep** | N/A | All “verify receipt/proof” CTAs, demos, docs references to live verifier. | **Main nav** |
| `/docs.html` | Docs hub/getting-started landing for implementation. | **Keep** | N/A | Header docs link, onboarding CTAs from home/capabilities/verify. | **Main nav** |
| `/quickstart.html` | Fast-start sequence for running and verifying flows. | **Keep** | N/A | Docs hub quickstart links and implementation CTAs. | **Main nav** |
| `/docs/wrap-your-agent.html` | Practical integration guide for wrapping agents and emitting receipts. | **Keep** | N/A | `/docs.html` primary implementation CTA; references from capabilities and verifier pages. | **Main nav** (via Docs section) |
| `/sdk-records.html` | Discovery/SDK record detail page (VerifyAgent.eth record). | **Keep** | N/A | From `/verify.html`, `/ambient-verification.html`, and technical trust pages. | **Footer only** |
| `/trust-verification.html` | Protocol-level schema/manifest trust verification reference. | **Keep** | N/A | From `/capabilities.html` and `/how-it-works.html` for deeper technical validation. | **Footer only** |
| `/commons.html` | Commons contract/semantics reference (v1.1.0). | **Merge** | Merge into docs reference area (canonical destination: `/docs.html` and docs/reference pages), keep URL as legacy redirect later. | Protocol/reference links currently pointing to standalone registry pages. | **Hidden/dev-only** (post-merge) |
| `/commercial.html` | Commercial extension verbs/spec page (v1.1.0). | **Merge** | Merge into docs reference/commercial section (canonical destination: `/docs.html` + docs/reference). | Revenue/protocol links that need extension verb definitions. | **Footer only** |
| `/agent-cards.html` | Agent Cards Registry versioned reference. | **Merge** | Merge into docs reference pages under agent discovery/reference. | References from repos/docs pages discussing registry format. | **Footer only** |
| `/runtime.html` | Runtime proof-boundary reference page. | **Merge** | Merge into runtime portability/reference docs pages. | Architecture links from technical documentation and FAQ/roadmap. | **Footer only** |
| `/licensing.html` | Licensing/economic model positioning. | **Keep** | N/A | Footer legal/commercial links and enterprise/commercial CTA trails. | **Footer only** |
| `/repositories.html` | Repository index page linking project repos. | **Keep** | N/A | Footer “repositories” links and roadmap/docs contribution references. | **Footer only** |
| `/composer.html` | Interactive proof demo (“run a flow, prove what happened”). | **Keep** | N/A | Primary demo CTA from home and commercial narratives; redirect target from `/demo.html`. | **Main nav** (as Demo) |
| `/demo-inner.html` | Commercial-flow focused demo variant. | **Merge** | Merge into `/composer.html` as scenario mode/tab. | Commercial/demo CTA links that currently deep-link to separate demo. | **Hidden/dev-only** (post-merge) |
| `/demo.html` | Redirect shim to demo endpoint (`/composer.html`). | **Keep** (as compatibility redirect) | N/A | Legacy demo links from external references and older docs. | **Hidden/dev-only** |
| `/verify-badge-demo.html` | Embeddable badge demo for receipt verification widgets. | **Keep** | N/A | From `/verify.html`, `/ambient-verification.html`, and developer implementation docs. | **Hidden/dev-only** |
| `/ambient-verification.html` | Ambient/continuous machine-action verification concept + examples. | **Keep** | N/A | Links from verifier and how-it-works pages for advanced trust model explanation. | **Footer only** |
| `/about.html` | Brand/about narrative and positioning statement. | **Keep** | N/A | Footer/about links, investor or press references. | **Footer only** |
| `/faq.html` | Objection handling and concise Q&A. | **Keep** | N/A | Footer/support links and onboarding friction points from home/docs. | **Footer only** |
| `/roadmap.html` | Public roadmap and execution hardening trajectory. | **Keep** | N/A | Footer/company links, repositories page, and strategic docs references. | **Footer only** |

---

## Consolidation notes (non-destructive)

1. **Reference sprawl is the biggest consolidation opportunity**: `/commons.html`, `/commercial.html`, `/agent-cards.html`, and `/runtime.html` overlap with what should likely be canonical docs/reference content. Recommend content merge first, then eventual redirects (not deletions).  
2. **Demo surface can be simplified**: keep `/composer.html` as canonical demo entry; fold `/demo-inner.html` into it as a scenario/state. Keep `/demo.html` as permanent compatibility redirect.  
3. **Developer pathway is mostly coherent**: `/docs.html` → `/quickstart.html` + `/docs/wrap-your-agent.html` + `/verify.html` should remain primary integration funnel.
