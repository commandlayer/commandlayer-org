'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const lookupHandler = require('../api/ens/lookup');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('GET /api/ens/lookup rejects missing address', async () => {
  const res = makeRes();
  await lookupHandler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID_REQUEST');
});

test('GET /api/ens/lookup rejects invalid address', async () => {
  const res = makeRes();
  await lookupHandler({ method: 'GET', query: { address: 'not-an-address' }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID_ADDRESS');
});

test('GET /api/ens/lookup returns provider unavailable when ETH_RPC_URL is missing', async () => {
  const prevEth = process.env.ETH_RPC_URL;
  const prevBase = process.env.BASE_RPC_URL;
  delete process.env.ETH_RPC_URL;
  delete process.env.BASE_RPC_URL;

  const res = makeRes();
  await lookupHandler({ method: 'GET', query: { address: '0x0000000000000000000000000000000000000001' }, headers: {} }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'PROVIDER_UNAVAILABLE');
  assert.equal(res.body.error, 'ETH_RPC_URL is not configured');

  if (typeof prevEth === 'undefined') delete process.env.ETH_RPC_URL; else process.env.ETH_RPC_URL = prevEth;
  if (typeof prevBase === 'undefined') delete process.env.BASE_RPC_URL; else process.env.BASE_RPC_URL = prevBase;
});
