'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_PATH = path.join(PUBLIC, 'data', 'service-categories.json');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const categoryPath = (slug) => `/services/${slug}`;
const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function nav(active = 'services') {
  const items = [
    ['home', '/', 'Home'],
    ['services', '/services', 'Services'],
    ['discover', '/discover', 'Discover'],
    ['verify', '/verify.html', 'Verify'],
    ['docs', '/docs', 'Docs'],
    ['about', '/about', 'About'],
  ];
  return `<nav class="site-nav"><div class="container nav-inner"><a class="brand" href="/"><span class="brand-mark">CL</span><span class="brand-name">CommandLayer</span></a><ul class="nav-links">${items.map(([id,href,label]) => `<li><a${id===active?' class="active"':''} href="${href}">${label}</a></li>`).join('')}</ul><a class="nav-cta" href="https://github.com/commandlayer" target="_blank" rel="noopener">GitHub ↗</a></div></nav>`;
}

function footer() {
  return `<footer class="footer"><div class="container"><div class="footer-grid"><div class="footer-brand"><a class="brand" href="/"><span class="brand-mark">CL</span><span class="brand-name">CommandLayer</span></a><p>Seller-side machine-service infrastructure: discover, price, settle, execute and verify useful outcomes.</p></div><div><h4>Product</h4><a href="/services">Service families</a><a href="/discover">Machine buyer flow</a><a href="/status">Build status</a></div><div><h4>Developers</h4><a href="/docs">Docs</a><a href="/verify.html">Verifier</a><a href="/protocol">Protocol</a></div><div><h4>Company</h4><a href="/about">About</a><a href="https://github.com/commandlayer" target="_blank" rel="noopener">GitHub ↗</a></div></div><div class="footer-note"><span>© 2026 CommandLayer.</span><span>Execution evidence ≠ factual truth. Payment proof ≠ execution proof.</span></div></div></footer>`;
}

function head(title, description, canonical) {
  return `<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${esc(title)}</title><meta name="description" content="${esc(description)}"/><link rel="canonical" href="https://www.commandlayer.org${canonical}"/><meta property="og:type" content="website"/><meta property="og:site_name" content="CommandLayer"/><meta property="og:title" content="${esc(title)}"/><meta property="og:description" content="${esc(description)}"/><meta property="og:url" content="https://www.commandlayer.org${canonical}"/><meta property="og:image" content="https://www.commandlayer.org/commandlayer-logo.png"/><meta name="twitter:card" content="summary_large_image"/><link rel="icon" href="/favicon.ico"/><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/><link rel="stylesheet" href="/css/factory.css"/></head>`;
}

function statusBadge(service) {
  const cls = service.status === 'qualified' ? 'live' : service.status === 'frozen' ? 'gated' : 'pending';
  return `<span class="badge ${cls}">${esc(service.status_label)}</span>`;
}

function priceText(service) {
  if (typeof service.price === 'number') return `$${service.price.toFixed(2)} <small>pre-production recommendation</small>`;
  return 'Not activation-priced';
}

function serviceCard(service) {
  return `<article class="card service-detail-card" id="${esc(service.id)}">
    <div class="service-detail-top"><div><div class="eyebrow">${esc(service.class)} · ${esc(service.mode)}</div><h3>${esc(service.name)}</h3></div>${statusBadge(service)}</div>
    <p class="service-job">${esc(service.job)}</p>
    <div class="service-facts"><div><span>Input contract</span><strong>${esc(service.inputs)}</strong></div><div><span>Returns</span><strong>${esc(service.returns)}</strong></div><div><span>Price state</span><strong>${priceText(service)}</strong></div></div>
    <div class="evidence-box"><strong>Current evidence</strong><p>${esc(service.evidence)}</p></div>
  </article>`;
}

function requestExample(category) {
  const svc = category.services[0];
  if (!svc) {
    return `{
  "category": "${category.slug}",
  "intent": "discover_service",
  "constraints": {
    "machine_readable_contract": true,
    "bounded_execution": true,
    "execution_evidence": true
  }
}`;
  }
  return `{
  "service": "${svc.id}",
  "request": {
    "inputs": "${svc.inputs}",
    "acceptance": "declared service contract",
    "evidence": "commandlayer.execution-evidence.v1"
  }
}`;
}

function categoryPage(category, index) {
  const canonical = categoryPath(category.slug);
  const serviceCount = category.services.length;
  const title = `${category.name} — CommandLayer Services`;
  const description = `${category.short} Explore machine-readable contracts, current services, examples, boundaries and evidence status in CommandLayer's ${category.name} family.`;
  const serviceSection = serviceCount
    ? category.services.map(serviceCard).join('\n')
    : `<div class="empty-family card"><div class="eyebrow">Current First Ten assignment</div><h3>No First-Ten service is assigned to this family yet.</h3><p>This is intentional. The category is part of the long-term service architecture, but CommandLayer will not manufacture a public product merely to fill a catalog slot. New services enter this family only after a testable acceptance contract and evidence justify activation.</p></div>`;

  return `<!DOCTYPE html><html lang="en">${head(title, description, canonical)}<body>${nav('services')}<main>
  <section class="page-hero category-hero"><div class="container"><div class="kicker"><span class="kicker-dot"></span>Service family ${String(index + 1).padStart(2,'0')} / 12</div><div class="category-title-row"><div><h1>${esc(category.name)}</h1><p class="lead">${esc(category.short)}</p></div><div class="family-stat"><strong>${serviceCount}</strong><span>First Ten service${serviceCount===1?'':'s'} assigned</span></div></div><p class="category-thesis">${esc(category.thesis)}</p><div class="actions"><a class="btn btn-dark" href="/services">All 12 service families</a><a class="btn btn-light" href="/docs">Developer docs</a></div></div></section>

  <section class="section white"><div class="container"><div class="eyebrow">What machines buy here</div><h2 class="section-title">Outcome contracts, not a list of endpoints.</h2><p class="section-copy">${esc(category.contract_pattern)}</p><div class="grid-3">${category.examples.map((x,i)=>`<article class="card"><div class="card-icon">0${i+1}</div><h3>${esc(x)}</h3><p>${esc(category.buyers[i % category.buyers.length])} can purchase this class of work through one bounded service contract.</p></article>`).join('')}</div></div></section>

  <section class="section"><div class="container"><div class="eyebrow">Current factory services</div><h2 class="section-title">What exists in this family today.</h2><p class="section-copy">Status below reflects controlled build and reliability evidence. “Evidence-qualified” does not mean publicly paid production is already live; settlement, trust and activation gates still apply.</p><div class="service-detail-list">${serviceSection}</div></div></section>

  <section class="section white"><div class="container split"><div><div class="eyebrow">Machine contract example</div><h2 class="section-title">A service is something software can understand before it buys.</h2><p class="section-copy">The canonical definition carries inputs, output shape, execution mode, pricing/settlement requirements, acceptance conditions and evidence profile. Discovery adapters can expose the same definition through different ecosystems without forking the contract.</p></div><div class="code-card"><div class="code-head">illustrative category request</div><pre>${esc(requestExample(category))}</pre></div></div></section>

  <section class="section"><div class="container"><div class="eyebrow">Execution discipline</div><h2 class="section-title">What the contract refuses matters too.</h2><div class="grid-2">${category.boundaries.map((x,i)=>`<article class="card"><div class="card-icon">${i+1}</div><h3>${esc(x)}</h3><p>Acceptance and failure semantics are explicit so the buyer can distinguish completed work, degraded output, provider failure and unsupported requests.</p></article>`).join('')}</div><div class="notice"><strong>Category truth rule:</strong> ${esc(data.truth_rule)}</div></div></section>

  <section class="section white"><div class="container"><div class="eyebrow">Who uses this family</div><h2 class="section-title">Built for software buyers first.</h2><div class="badges">${category.buyers.map(b=>`<span class="badge adapter">${esc(b)}</span>`).join('')}</div><p class="section-copy" style="margin-top:22px">The human website explains the family. Machines consume the canonical manifest, schema, quote, settlement and invocation surfaces directly.</p></div></section>
</main>${footer()}</body></html>`;
}

function servicesHub() {
  const assigned = data.categories.flatMap(c => c.services.map(s => ({...s, category:c})));
  const qualified = assigned.filter(s => s.status === 'qualified');
  const cards = data.categories.map((c,i)=>`<a class="category-card" href="${categoryPath(c.slug)}"><div class="category-num">${String(i+1).padStart(2,'0')}</div><div><h3>${esc(c.name)}</h3><p>${esc(c.short)}</p><div class="category-meta"><span>${c.services.length} First Ten assigned</span><span>Explore →</span></div></div></a>`).join('');
  const firstTenRows = assigned.map(s => `<div class="service-row"><div class="service-name"><a href="${categoryPath(s.category.slug)}#${s.id}">${esc(s.name)}</a><small>${esc(s.category.name)}</small></div><div class="service-desc">${esc(s.job)}</div><div class="service-state">${statusBadge(s)}</div></div>`).join('');
  const description = 'Explore CommandLayer through 12 scalable machine-service families. See the First Ten, measured evidence, current pricing state, contracts and category boundaries.';
  return `<!DOCTYPE html><html lang="en">${head('Services — CommandLayer', description, '/services')}<body>${nav('services')}<main>
  <section class="page-hero services-hero"><div class="container"><div class="kicker"><span class="kicker-dot"></span>12 machine-service families</div><h1>One factory. <span class="gradient-text">Twelve service families.</span></h1><p class="lead">CommandLayer is designed to scale to hundreds of purchasable machine outcomes without turning the website into hundreds of disconnected product pages. Services are organized by the job software is trying to get done.</p><div class="actions"><a class="btn btn-dark" href="#families">Explore the 12 families</a><a class="btn btn-light" href="/discover">How machine buyers use CommandLayer</a></div></div></section>

  <section class="section white"><div class="container"><div class="metric-strip"><div class="metric"><strong>12</strong><span>human-readable service families</span></div><div class="metric"><strong>10</strong><span>First Ten implemented behind one factory</span></div><div class="metric"><strong>${qualified.length}</strong><span>currently evidence-qualified launch candidates</span></div><div class="metric"><strong>0</strong><span>public paid production services until trust/settlement gates clear</span></div></div><div class="notice"><strong>Why categories:</strong> individual service contracts can grow from 10 to 125 to hundreds while the human information architecture stays understandable. Machines discover services from structured manifests; humans browse durable problem families.</div></div></section>

  <section class="section" id="families"><div class="container"><div class="eyebrow">Service architecture</div><h2 class="section-title">Browse by the outcome a machine needs.</h2><p class="section-copy">Each family page explains the job, contract pattern, current factory services, evidence state, boundaries and buyer examples. Empty families are shown honestly rather than padded with invented products.</p><div class="category-grid">${cards}</div></div></section>

  <section class="section white"><div class="container"><div class="eyebrow">The First Ten</div><h2 class="section-title">What is actually implemented now.</h2><p class="section-copy">Every First Ten service maps to exactly one primary family below. Composition can reuse primitives across families without creating duplicate marketing pages.</p><div class="card" style="margin-top:32px">${firstTenRows}</div></div></section>

  <section class="section"><div class="container split"><div><div class="eyebrow">Scaling rule</div><h2 class="section-title">A service earns a contract. A category earns the page.</h2><p class="section-copy">Most future services will appear as catalog entries inside one of these 12 families. Only unusually important products or use cases should earn separate editorial pages. This keeps CommandLayer coherent when the catalog reaches 125+ machine capabilities.</p></div><div class="card dark"><h3>One factory, many storefronts</h3><p>Reusable primitives, provider adapters, durable state, metering, settlement, acceptance evaluation and execution evidence sit underneath every service. New names should reuse that factory instead of multiplying infrastructure.</p><div class="badges"><span class="badge adapter">HTTP / JSON</span><span class="badge adapter">OpenAPI</span><span class="badge adapter">MCP</span><span class="badge adapter">x402</span><span class="badge adapter">ENS / ERC-8004 adapters</span></div></div></div></section>
</main>${footer()}</body></html>`;
}

function updateCatalog() {
  const services = data.categories.flatMap(c => c.services.map(s => ({
    id: s.id, name: s.name, category: c.slug, category_name: c.name, class: s.class,
    execution_mode: s.mode, status: s.status, status_label: s.status_label,
    preproduction_price_usd: s.price, evidence: s.evidence,
  })));
  const catalog = {
    schema: 'commandlayer.catalog.v1',
    program: 'machine-service-factory', program_version: '3.2.1',
    status: 'pre-production-activation-gated', positioning: 'seller-side machine-service infrastructure',
    human_catalog: '/services', category_count: data.categories.length,
    categories: data.categories.map(c => ({slug:c.slug, name:c.name, href:categoryPath(c.slug), first_ten_assigned:c.services.map(s=>s.id)})),
    first_ten: services,
    evidence_qualified_activation_candidates: services.filter(s=>s.status==='qualified').map(s=>s.id),
    public_live_services: [], truth_rule: data.truth_rule,
    principles: ['one_factory_many_storefronts','categories_scale_human_navigation','canonical_manifest_is_source_of_truth','external_directories_are_adapters','receipts_prove_execution_not_factual_truth','evidence_before_activation_and_expansion']
  };
  fs.writeFileSync(path.join(PUBLIC, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
}

function updateVercel() {
  const p = path.join(ROOT, 'vercel.json');
  const config = JSON.parse(fs.readFileSync(p, 'utf8'));
  const slugs = new Set(data.categories.map(c => categoryPath(c.slug)));
  config.rewrites = (config.rewrites || []).filter(r => !slugs.has(r.source));
  for (const c of data.categories) config.rewrites.push({source:categoryPath(c.slug), destination:`/services/${c.slug}.html`});
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

function appendCss() {
  const p = path.join(PUBLIC, 'css', 'factory.css');
  let css = fs.readFileSync(p, 'utf8');
  if (css.includes('/* service-category-system-v1 */')) return;
  css += `\n/* service-category-system-v1 */\n.category-title-row{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:28px;align-items:end}.category-title-row h1{max-width:14ch}.category-thesis{max-width:860px;margin:28px 0 0;color:#556078;font-size:1.08rem;line-height:1.8}.family-stat{padding:22px;border:1px solid var(--line);background:#fff;border-radius:20px}.family-stat strong{display:block;font-size:38px;letter-spacing:-.05em}.family-stat span{display:block;font-size:12px;color:var(--muted);margin-top:4px}.category-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:34px}.category-card{display:grid;grid-template-columns:42px 1fr;gap:16px;padding:24px;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:20px;transition:.18s ease;min-height:190px}.category-card:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:#d7dded}.category-num{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:#eef2ff;color:#5267c8;font-weight:900;font-size:12px}.category-card h3{margin:2px 0 8px;font-size:18px;letter-spacing:-.025em}.category-card p{margin:0;color:#68728a;font-size:14px}.category-meta{display:flex;justify-content:space-between;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;font-weight:800;color:#7a849a}.service-name small{display:block;font-size:10px;color:#8a93a7;margin-top:2px;font-weight:650}.service-name a{text-decoration:none}.service-detail-list{display:grid;gap:18px;margin-top:34px}.service-detail-card{padding:28px}.service-detail-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.service-detail-top h3{font-size:25px}.service-job{font-size:15px!important;line-height:1.7;margin-top:6px!important;max-width:820px}.service-facts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:22px}.service-facts>div{padding:14px;border:1px solid var(--line);border-radius:14px;background:#fafbfe}.service-facts span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:850;color:#8a93a7}.service-facts strong{display:block;margin-top:5px;font-size:12px;color:#39445e}.service-facts small{font-weight:600;color:#7c8599}.evidence-box{margin-top:16px;padding:16px 18px;border-left:3px solid var(--blue);background:#f6f8ff;border-radius:0 13px 13px 0}.evidence-box strong{font-size:12px}.evidence-box p{margin:4px 0 0!important;font-size:13px!important}.empty-family{margin-top:32px;max-width:820px}.empty-family h3{font-size:23px}.empty-family p{line-height:1.75}.services-hero h1{max-width:12ch}.category-hero h1{font-size:clamp(2.8rem,6vw,5.4rem)}@media(max-width:980px){.category-grid{grid-template-columns:repeat(2,1fr)}.category-title-row{grid-template-columns:1fr}.family-stat{max-width:220px}.service-facts{grid-template-columns:1fr}}@media(max-width:700px){.category-grid{grid-template-columns:1fr}.category-card{min-height:0}.service-detail-top{display:block}.service-detail-top .badge{margin-top:10px}}\n`;
  fs.writeFileSync(p, css);
}

fs.mkdirSync(path.join(PUBLIC, 'services'), {recursive:true});
for (const [i, category] of data.categories.entries()) fs.writeFileSync(path.join(PUBLIC, 'services', `${category.slug}.html`), categoryPage(category, i));
fs.writeFileSync(path.join(PUBLIC, 'services.html'), servicesHub());
updateCatalog();
updateVercel();
appendCss();
console.log(`Generated ${data.categories.length} category pages and services hub.`);
