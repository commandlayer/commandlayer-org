'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function readText(path) {
  return fs.readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

const primaryPages = [
  'public/index.html',
  'public/services.html',
  'public/discover.html',
  'public/status.html',
  'public/docs.html',
  'public/about.html',
  'public/protocol.html',
];

test('catalog-first primary pages use the new product navigation', () => {
  for (const path of primaryPages) {
    const html = readText(path);
    assert.match(html, /href="\/services"/);
    assert.match(html, /href="\/discover"/);
    assert.match(html, /href="\/verify\.html"/);
    assert.match(html, /href="\/docs"/);
    assert.match(html, /href="\/about"/);
  }
});

test('legacy protocol-first concepts are not primary navigation labels on redesigned pages', () => {
  for (const path of primaryPages) {
    const html = readText(path);
    assert.doesNotMatch(html, />Capabilities<\/a>/);
    assert.doesNotMatch(html, />Receipts<\/a>/);
    assert.doesNotMatch(html, />Live Proof<\/a>/);
    assert.doesNotMatch(html, />Claim<\/a>/);
  }
});

test('machine catalog cannot imply live paid services before evidence selection', () => {
  const catalog = readJson('public/catalog.json');
  assert.equal(catalog.status, 'evidence-gated');
  assert.deepEqual(catalog.live_services, []);
  assert.equal(catalog.selection.candidate_names_are_product_commitments, false);
});

test('clean product routes are backed by explicit Vercel rewrites', () => {
  const config = readJson('vercel.json');
  const routes = new Map((config.rewrites || []).map((rule) => [rule.source, rule.destination]));
  assert.equal(routes.get('/services'), '/services.html');
  assert.equal(routes.get('/discover'), '/discover.html');
  assert.equal(routes.get('/status'), '/status.html');
  assert.equal(routes.get('/docs'), '/docs.html');
  assert.equal(routes.get('/about'), '/about.html');
  assert.equal(routes.get('/about/protocol'), '/protocol.html');
});

test('retired marketing routes redirect into the catalog-first information architecture', () => {
  const config = readJson('vercel.json');
  const routes = new Map((config.redirects || []).map((rule) => [rule.source, rule.destination]));
  assert.equal(routes.get('/capabilities.html'), '/services');
  assert.equal(routes.get('/canonical-receipts.html'), '/protocol');
  assert.equal(routes.get('/ambient-verification.html'), '/verify.html');
});
