'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const handler = require('../api/verify');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const sampleReceipt = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'examples', 'sample-receipt.json'), 'utf8')
);

test('POST /api/verify with valid sample => VERIFIED', async () => {
  const req = { method: 'POST', body: sampleReceipt };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'VERIFIED');
  assert.equal(res.body.reason, 'Receipt verification passed.');
  assert.equal(res.body.hash_matches, true);
  assert.equal(res.body.signature_valid, true);
  assert.equal(res.body.ens_resolved, true);
});



test('POST /api/verify with wrapped receipt payload => VERIFIED', async () => {
  const req = { method: 'POST', body: { receipt: sampleReceipt } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'VERIFIED');
});
test('POST /api/verify with tampered receipt => INVALID', async () => {
  const tampered = structuredClone(sampleReceipt);
  tampered.output.summary = `${tampered.output.summary}!!!`;

  const req = { method: 'POST', body: tampered };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
  assert.equal(res.body.hash_matches, false);
  assert.equal(res.body.signature_valid, false);
});

test('POST /api/verify missing body => 400', async () => {
  const req = { method: 'POST' };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('GET /api/verify => 405', async () => {
  const req = { method: 'GET', body: sampleReceipt };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.body.ok, false);
});

test('POST /api/verify oversized body => 413', async () => {
  const req = { method: 'POST', body: sampleReceipt, headers: { 'content-length': String(2 * 1024 * 1024) } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
});
