'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyReceipt } = require('../lib/verifyReceipt');

function readJson(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }
function readText(path) { return fs.readFileSync(path, 'utf8'); }

test('valid verifier sample is VERIFIED with real verifier logic', async () => {
  const receipt = readJson('public/receipts/demo-valid-receipt.json');
  const result = await verifyReceipt(receipt, { ens: { allowLocalFallback: true } });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.hash_matches, true);
  assert.equal(result.signature_valid, true);
});

test('tampered verifier sample is INVALID with real verifier logic', async () => {
  const receipt = readJson('public/receipts/demo-tampered-receipt.json');
  const result = await verifyReceipt(receipt, { ens: { allowLocalFallback: true } });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.hash_matches || result.signature_valid, false);
});

test('verify page uses current valid sample fixture path', () => {
  const verifyJs = readText('public/js/verify.js');
  assert.match(verifyJs, /\/receipts\/demo-valid-receipt\.json/);
});

test('public pages link playground and webhook demo and avoid markdown docs links in nav dropdown', () => {
  for (const path of ['public/verify.html', 'public/proof.html', 'public/docs.html']) {
    const html = readText(path);
    assert.match(html, /href="\/playground\.html"/);
    assert.match(html, /href="\/webhook-auto-verify\.html"/);
    assert.doesNotMatch(html, /href="\/docs\/extension\/chrome-receipt-inspector\.md"/);
  }
});
