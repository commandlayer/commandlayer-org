'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const handler = require('../api/agents/verifyagent');

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

test('POST /api/agents/verifyagent with valid sample => VERIFIED', async () => {
  const req = { method: 'POST', body: { task: 'verify this receipt', receipt: sampleReceipt } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agent, 'verifyagent.eth');
  assert.equal(res.body.action, 'verify_receipt');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'VERIFIED');
  assert.equal(res.body.result.reason, 'Receipt verification passed.');
  assert.equal(res.body.result.hash_matches, true);
  assert.equal(res.body.result.signature_valid, true);
  assert.equal(res.body.result.ens_resolved, true);
});

test('POST /api/agents/verifyagent with tampered receipt => INVALID', async () => {
  const tampered = structuredClone(sampleReceipt);
  tampered.output.summary = `${tampered.output.summary}!!!`;

  const req = { method: 'POST', body: { receipt: tampered } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
  assert.equal(res.body.result.hash_matches, false);
  assert.equal(res.body.result.signature_valid, false);
});

test('POST /api/agents/verifyagent missing receipt => 400', async () => {
  const req = { method: 'POST', body: {} };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
});

test('GET /api/agents/verifyagent => 405', async () => {
  const req = { method: 'GET', body: { receipt: sampleReceipt } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.body.ok, false);
});

test('POST /api/agents/verifyagent oversized body => 413', async () => {
  const req = {
    method: 'POST',
    body: { receipt: sampleReceipt },
    headers: { 'content-length': String(2 * 1024 * 1024) },
  };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
});
