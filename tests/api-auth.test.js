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
});

test('POST /api/auth/verify rejects malformed message/signature', async () => {
  const res = makeRes();
  await verifyHandler({ method: 'POST', body: { message: 'invalid', signature: '0xdeadbeef' }, headers: { host: 'localhost:3000' } }, res);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'AUTH_FAILED');
});


test('POST /api/auth/verify surfaces dependency unavailable when siwe is missing', async () => {
  const res = makeRes();
  await verifyHandler({ method: 'POST', body: { message: 'x', signature: '0xy' }, headers: { host: 'localhost:3000' } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /dependency unavailable/i);
});
