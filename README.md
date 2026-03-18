# commandlayer-org

The CommandLayer website + demo surface.

## Version policy

- **Commons:** `v1.1.0` is the current builder target across the site and demo composer.
- **Commercial:** `v1.0.0` is the current commercial release.
- **Agent Cards:** `v1.0.0` is the current card format.
- **Runtime:** execution layer, not a schema version line; it proves execution for the published schema versions above.
- **Compatibility:** published `v1.0.0` Commons URLs remain live for verification and older integrations, but new examples should point to `v1.1.0`.

This repo hosts the static site at **commandlayer.org** and the small set of **Vercel serverless APIs** that power the live demo and flow composer against the CommandLayer runtime. The public website should teach the layer boundary in this order: Commons defines the minimum verifiable receipt, then Runtime executes actions and may attach optional metadata for chaining, orchestration, and proof.

- Website: https://www.commandlayer.org/
- GitHub org: https://github.com/commandlayer
- Runtime (example): https://runtime.commandlayer.org

---

## What this repo is

**commandlayer-org** is intentionally simple and boring by design.

- **Static pages** live in `public/` (plain HTML / CSS / JS).
- **Serverless endpoints** live in `api/` (Vercel Functions).
- The root contains standard Node / Vercel project files.

This keeps the site:
- easy to deploy
- cacheable
- auditable
- contributor-friendly

> Rule of thumb: **if it can be static, keep it static.**  
> Use `api/` only when you must.

---

## Repository structure
```
├── public/ # Static site (served as-is)
│ ├── index.html
│ ├── quickstart.html
│ ├── demo.html
│ ├── commons.html
│ ├── commercial.html
│ ├── agent-cards.html
│ ├── runtime.html
│ ├── manifest.html
│ ├── roadmap.html
│ ├── licensing.html
│ ├── about.html
│ ├── schemas/ # Static JSON Schemas
│ ├── agent-cards/ # Static Agent Card JSON
│ └── assets/ # Images, PDFs, sample receipts
│
├── api/ # Vercel serverless functions
│ ├── commons-flow.js
│ └── commercial-flow.js
│
├── package.json
├── vercel.json
├── README.md
└── LICENSE
```

URLs are part of the protocol surface.  
**Do not rename or move published paths.**

---

## Key pages

Typical pages in `public/`:

- `index.html` — Overview / homepage
- `quickstart.html` — 5-minute setup + receipt verification
- `demo.html` — Live demo UI (flow composer)
- `commons.html` — Commons verbs overview
- `commercial.html` — Commercial verbs overview
- `agent-cards.html` — Agent Cards spec + examples
- `runtime.html` — Runtime guarantees + verification model
- `manifest.html` — Reserved future verbs / namespace map
- `roadmap.html`, `licensing.html`, `about.html`, etc.

Static assets:

- `public/assets/` — images, icons, PDFs, sample receipts
- `public/schemas/` — schema hosting path (static JSON)
- `public/agent-cards/` — Agent Card hosting path (static JSON)

Once published, **URLs must remain stable**.

---

## API endpoints (Vercel)

The `api/` directory contains serverless endpoints used by the site.

### `/api/commons-flow`

Orchestrates a multi-step “Commons flow” for the demo UI and Commons composer while preserving the Commons-first teaching model.

What it does:
- Accepts an ordered list of steps: `{ verb, input }`
- For each step:
  - POSTs to the runtime at  
    `${RUNTIME_BASE_URL}/{verb}/v1.1.0` (default for Commons)
- Returns:
  - per-step request JSON
  - per-step receipt JSON (canonical contract first)
  - per-step reproducible `curl`
  - verification results (when enabled)
  - optional runtime metadata when the executor exposes it

Why this exists:
- Browsers have CORS and request-size constraints
- We want a stable, inspectable response shape
- We enforce timeouts and safety limits server-side

The API is intentionally thin.  
It does **not** implement protocol logic.

---

## Configuration

### Runtime target

The demo and flow composer call the runtime defined by:



RUNTIME_BASE_URL


Example:


https://runtime.commandlayer.org


In Vercel:
- Project → Settings → Environment Variables
- Add `RUNTIME_BASE_URL` for **Production** and **Preview**

---

## Local development

### Requirements
- Node.js (LTS recommended)

### Install
```bash
npm install
```
### Run locally (recommended)

If you use Vercel Functions locally:
```
npm install -g vercel
vercel dev
```

This serves:

- `public/` as the site
- `api/` as local serverless endpoints

If the repo defines a custom dev script instead:
```
npm run dev
```

(Use whichever is defined in package.json.)

### Health check

Once running:

- Runtime health:
  https://runtime.commandlayer.org/health
- The Demo page should report runtime status as ok

If the runtime is cold, retry once.

### Deploy

This repo is designed for **Vercel.**

**Vercel setup**

1.Import the GitHub repo into Vercel
2. Ensure:
   - Build command: none (static)
   - Output: defaults (Vercel auto-detects public/)

3. Add environment variable:

RUNTIME_BASE_URL=https://runtime.commandlayer.org

## Page structure & invariants

This site is intentionally framework-free and static.

- New pages are plain HTML files under `public/`
- There is no router, build step, or client-side framework
- Header / footer markup is duplicated intentionally to keep pages self-contained

Styling rules:

- Reuse the same `:root` theme variables
- Reuse existing card and grid patterns
- Do not introduce per-page visual systems

If shared styles are needed:

- Add them to `public/assets/css/cl-base.css`
- Link explicitly from each page

Once published, page URLs must remain stable.

## Downloads (sample receipts and static assets)

To make assets downloadable:

- Commit them under `public/assets/`

Examples:

public/assets/receipts/clean.quickstart.v1.1.0.json

Link using same-origin URLs:

/assets/receipts/clean.quickstart.v1.1.0.json

Tip: the HTML `<a download>` attribute works best for same-origin files.

### `/api/commercial-flow`

Orchestrates the commercial demo flow used by `public/demo.html` and `public/demo-inner.html`.

What it does:
- Accepts ordered Commercial steps: `authorize`, `checkout`, `purchase`, `ship`, `verify`
- Forwards them to `${COMMERCIAL_RUNTIME_BASE_URL}/{verb}/v1.0.0`
- Returns per-step requests, receipts, and reproducible `curl`

This is the only backend surface required by the public commercial demo, which should be framed as a runtime execution surface rather than the canonical protocol contract.

---

## License

Website code and documentation are published under this repo’s `LICENSE` file.

CommandLayer protocol licensing (Commons, Commercial, Agent Cards, Runtime) is documented at:

https://commandlayer.org/licensing.html
