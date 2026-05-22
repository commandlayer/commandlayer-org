'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const nonceHandler = require('../api/auth/nonce');
const verifyHandler = require('../api/auth/verify');

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

test('GET /api/auth/nonce returns nonce and randomness', async () => {
  const r1 = makeRes(); const r2 = makeRes();
  await nonceHandler({ method: 'GET', headers: {} }, r1);
  await nonceHandler({ method: 'GET', headers: {} }, r2);
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.body.ok, true);
  assert.match(r1.body.nonce, /^[a-f0-9]{32,}$/);
  assert.notEqual(r1.body.nonce, r2.body.nonce);
});

test('POST /api/auth/verify rejects missing signature', async () => {
  const res = makeRes();
  await verifyHandler({ method: 'POST', body: { message: 'x' }, headers: { host: 'localhost:3000' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'missing_signature');
});

test('POST /api/auth/verify rejects malformed message/signature', async () => {
  const res = makeRes();
  await verifyHandler({ method: 'POST', body: { message: 'invalid', signature: '0xdeadbeef' }, headers: { host: 'localhost:3000' } }, res);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'AUTH_FAILED');
  assert.ok(['malformed_message', 'dependency_unavailable'].includes(res.body.error));
});

test('POST /api/auth/verify rejects statement mismatch', async () => {
  const res = makeRes();
  const message = `www.commandlayer.org wants you to sign in with your Ethereum account:
0x0000000000000000000000000000000000000001

Different statement.

URI: https://www.commandlayer.org
Version: 1
Chain ID: 1
Nonce: abcdefgh
Issued At: 2026-01-01T00:00:00.000Z`;
  await verifyHandler({ method: 'POST', body: { message, signature: '0xdeadbeef' }, headers: { host: 'www.commandlayer.org' } }, res);
  if (res.statusCode === 503) {
    assert.equal(res.body.error, 'dependency_unavailable');
    return;
  }
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'statement_mismatch');
});


test('POST /api/auth/verify rejects malformed SIWE payload or surfaces missing dependency', async () => {
  const res = makeRes();
  await verifyHandler({ method: 'POST', body: { message: 'x', signature: '0xy' }, headers: { host: 'localhost:3000' } }, res);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'AUTH_FAILED');
  assert.ok(
    (res.statusCode === 400 && res.body.error === 'malformed_message') ||
    (res.statusCode === 503 && res.body.error === 'dependency_unavailable')
  );
});
