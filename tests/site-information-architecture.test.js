'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function readText(path) { return fs.readFileSync(path, 'utf8'); }
function readJson(path) { return JSON.parse(readText(path)); }

const categoryData = readJson('public/data/service-categories.json');
const categories = categoryData.categories;
const expectedAssignments = {
  researchagent: 'research-intelligence',
  leadagent: 'research-intelligence',
  crawlagent: 'search-crawl-retrieval',
  documentagent: 'documents-data',
  parseagent: 'documents-data',
  compareagent: 'analysis-comparison-decisioning',
  monitoragent: 'monitoring-tracking-state',
  trackagent: 'monitoring-tracking-state',
  verifyagent: 'verification-trust-provenance',
  transcribeagent: 'media-transformation-utility',
};

test('service architecture has exactly twelve durable human categories', () => {
  assert.equal(categories.length, 12);
  assert.equal(new Set(categories.map(c => c.slug)).size, 12);
  for (const c of categories) {
    assert.ok(c.name.length > 5);
    assert.ok(c.thesis.length > 80);
    assert.ok(c.contract_pattern.length > 80);
    assert.ok(c.examples.length >= 3);
    assert.ok(c.boundaries.length >= 4);
  }
});

test('each First Ten service is assigned exactly once to the correct primary family', () => {
  const seen = new Map();
  for (const category of categories) {
    for (const service of category.services) {
      assert.equal(seen.has(service.id), false, `${service.id} assigned more than once`);
      seen.set(service.id, category.slug);
    }
  }
  assert.equal(seen.size, 10);
  assert.deepEqual(Object.fromEntries([...seen.entries()].sort()), Object.fromEntries(Object.entries(expectedAssignments).sort()));
});

test('generated category pages and services hub contain substantive content', () => {
  const hub = readText('public/services.html');
  assert.match(hub, /Twelve service families/i);
  assert.match(hub, /125/);
  for (const category of categories) {
    const html = readText(`public/services/${category.slug}.html`);
    assert.ok(html.includes(category.name));
    assert.match(html, /Outcome contracts, not a list of endpoints/);
    assert.match(html, /What the contract refuses matters too/);
    assert.ok(html.length > 7000, `${category.slug} is unexpectedly thin`);
  }
});

test('catalog tells current pre-production truth and does not claim public paid activation', () => {
  const catalog = readJson('public/catalog.json');
  assert.equal(catalog.category_count, 12);
  assert.equal(catalog.first_ten.length, 10);
  assert.deepEqual(catalog.public_live_services, []);
  assert.deepEqual(catalog.evidence_qualified_activation_candidates.sort(), ['compareagent','documentagent','parseagent']);
  assert.match(catalog.status, /activation-gated/);
});

test('all twelve clean category routes are explicit Vercel rewrites', () => {
  const config = readJson('vercel.json');
  const routes = new Map((config.rewrites || []).map(r => [r.source, r.destination]));
  for (const category of categories) assert.equal(routes.get(`/services/${category.slug}`), `/services/${category.slug}.html`);
});

test('primary product navigation remains consistent', () => {
  for (const path of ['public/index.html','public/services.html','public/discover.html','public/status.html','public/docs.html','public/about.html','public/protocol.html']) {
    const html = readText(path);
    assert.match(html, /href="\/services"/);
    assert.match(html, /href="\/discover"/);
    assert.match(html, /href="\/verify\.html"/);
    assert.match(html, /href="\/docs"/);
    assert.match(html, /href="\/about"/);
  }
});
