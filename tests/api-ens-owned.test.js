'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/ens/owned');

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

test('GET /api/ens/owned rejects missing address', async () => {
  const res = makeRes();
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'missing_address');
});

test('GET /api/ens/owned rejects invalid address', async () => {
  const res = makeRes();
  await handler({ method: 'GET', query: { address: 'nope' }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_address');
});

test('GET /api/ens/owned returns provider unavailable when config missing', async () => {
  const prev = { ...process.env };
  delete process.env.ALCHEMY_ETH_API_KEY;
  delete process.env.ALCHEMY_ETH_RPC_URL;
  delete process.env.ETH_RPC_URL;
  delete process.env.SIMPLEHASH_API_KEY;
  const res = makeRes();
  await handler({ method: 'GET', query: { address: '0x0000000000000000000000000000000000000001' }, headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'PROVIDER_UNAVAILABLE');
  process.env = prev;
});

test('GET /api/ens/owned stable unavailable response shape', async () => {
  const prev = { ...process.env };
  delete process.env.ALCHEMY_ETH_API_KEY;
  delete process.env.ALCHEMY_ETH_RPC_URL;
  delete process.env.ETH_RPC_URL;
  delete process.env.SIMPLEHASH_API_KEY;
  const res = makeRes();
  await handler({ method: 'GET', query: { address: '0x0000000000000000000000000000000000000001' }, headers: {} }, res);
  assert.deepEqual(res.body, {
    ok: false,
    status: 'PROVIDER_UNAVAILABLE',
    error: 'ENS owned-name lookup provider is not configured'
  });
  process.env = prev;
});
