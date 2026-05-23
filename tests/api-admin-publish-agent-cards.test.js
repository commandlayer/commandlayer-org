'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function makeRes() { return { statusCode: 200, headers: {}, body: null, setHeader(n,v){this.headers[n.toLowerCase()]=v;}, status(c){this.statusCode=c;return this;}, json(p){this.body=p;return this;} }; }
function normalizeRows(result) { if (Array.isArray(result)) return result; if (result && Array.isArray(result.rows)) return result.rows; return []; }

function load(modulePath, mockQuery) {
  const handlerPath = require.resolve(modulePath);
  const dbPath = require.resolve('../lib/db');
  delete require.cache[handlerPath]; delete require.cache[dbPath];
  require.cache[dbPath] = { exports: { query: mockQuery, normalizeRows, getDatabaseUrl: () => process.env.DATABASE_URL } };
  return require(modulePath);
}

test('non-approved claim cannot publish cards', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/publish-agent-cards', async (text) => String(text).includes('from claim_requests') ? [{ claim_id: 'clm_1', status: 'created' }] : []);
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.status, 'CLAIM_NOT_APPROVED');
});

test('approved claim publishes cards with status update last', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const calls = [];
  const handler = load('../api/admin/publish-agent-cards', async (text) => {
    const q = String(text); calls.push(q);
    if (q.includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'approved' }];
    if (q.includes('from claim_agents')) return [{ id: 'a1', claim_id: 'clm_1', ens: 'a.signagent.eth', capability: 'trust-verification', tenant: 'commandlayer' }];
    if (q.includes('from agent_cards')) return [];
    return [];
  });
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200);
  const idxStatus = calls.findIndex((q) => q.includes("update claim_requests set status = 'cards_published'"));
  const idxEvent = calls.findIndex((q) => q.includes('insert into claim_events'));
  const idxTrans = calls.findIndex((q) => q.includes('insert into claim_status_transitions'));
  assert.ok(idxStatus > idxEvent);
  assert.ok(idxStatus > idxTrans);
});

test('cards_published with existing complete cards returns existing', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/publish-agent-cards', async (text) => {
    const q = String(text);
    if (q.includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'cards_published' }];
    if (q.includes('from claim_agents')) return [{ id: 'a1', ens: 'a.signagent.eth', card_url: 'u', card_status: 'published' }];
    if (q.includes('from agent_cards')) return [{ ens: 'a.signagent.eth', card_url: 'u' }];
    return [];
  });
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CARDS_ALREADY_PUBLISHED');
});

test('cards_published with missing cards repairs successfully', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/publish-agent-cards', async (text) => {
    const q = String(text);
    if (q.includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'cards_published' }];
    if (q.includes('from claim_agents')) return [{ id: 'a1', ens: 'a.signagent.eth', capability: 'trust-verification', tenant: 'commandlayer' }];
    if (q.includes('from agent_cards')) return [];
    if (q.includes('select id from claim_events')) return [];
    if (q.includes('select id from claim_status_transitions')) return [];
    return [];
  });
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'AGENT_CARDS_REPAIRED');
});

test('public card route supports ens and pretty path lookup with .json stripping', async () => {
  const queries = [];
  const handlerOk = load('../api/agent-cards/card', async (text, params) => {
    queries.push(params);
    return [{ card_json: { ok: true } }];
  });

  const ensRes = makeRes();
  await handlerOk({ method: 'GET', query: { ens: 'tenant.approveagent.eth' } }, ensRes);
  assert.equal(ensRes.statusCode, 200);
  assert.equal(queries[0][0], 'tenant.approveagent.eth');

  const pathRes = makeRes();
  await handlerOk({ method: 'GET', query: { path: '/agent-cards/agents/v1.1.0/trust/tenant.approveagent.eth.json' } }, pathRes);
  assert.equal(pathRes.statusCode, 200);
  assert.equal(queries[1][0], 'tenant.approveagent.eth');

  const missRes = makeRes();
  const handlerMissing = load('../api/agent-cards/card', async () => []);
  await handlerMissing({ method: 'GET', query: { path: '/agent-cards/agents/v1.1.0/trust/missing.approveagent.eth.json' } }, missRes);
  assert.equal(missRes.statusCode, 404);
});
