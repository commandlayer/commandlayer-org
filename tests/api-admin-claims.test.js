'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

function load(modulePath, mockQuery) {
  const handlerPath = require.resolve(modulePath);
  const dbPath = require.resolve('../lib/db');
  delete require.cache[handlerPath];
  delete require.cache[dbPath];
  require.cache[dbPath] = { exports: { query: mockQuery, getDatabaseUrl: () => process.env.DATABASE_URL } };
  return require(modulePath);
}

test('admin claims returns ADMIN_NOT_CONFIGURED when key missing', async () => {
  delete process.env.ADMIN_API_KEY;
  const handler = load('../api/admin/claims', async () => ({ rows: [] }));
  const res = makeRes();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'ADMIN_NOT_CONFIGURED');
});

test('admin claims returns UNAUTHORIZED when auth missing', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/claims', async () => ({ rows: [] }));
  const res = makeRes();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, 'UNAUTHORIZED');
});

test('admin claims returns list when authorized', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const calls = [];
  const handler = load('../api/admin/claims', async (text, params) => {
    calls.push(String(text));
    if (String(text).includes('from claim_requests')) {
      return { rows: [{ claim_id: 'clm_1', tenant: 'commandlayer', authenticated_address: '0x1', activation_mode: 'cl', pack_id: 'trust', status: 'created', created_at: '2026-05-23T00:00:00.000Z' }] };
    }
    return { rows: [{ agent_count: 2 }] };
  });
  const res = makeRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.claims[0].agentCount, 2);
});

test('admin claim detail returns agents and events when authorized', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/claim', async (text) => {
    const q = String(text);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_1', tenant: 'commandlayer', request_json: {} }] };
    if (q.includes('from claim_agents')) return { rows: [{ ens: 'x.signagent.eth' }] };
    return { rows: [{ event_type: 'claim.created' }] };
  });
  const res = makeRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' }, query: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(Array.isArray(res.body.agents), true);
  assert.equal(Array.isArray(res.body.events), true);
});
