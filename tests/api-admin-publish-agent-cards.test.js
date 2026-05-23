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

test('publish cards missing ADMIN_API_KEY', async () => {
  delete process.env.ADMIN_API_KEY;
  const handler = load('../api/admin/publish-agent-cards', async () => []);
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 503);
});

test('publish cards unauthorized', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/publish-agent-cards', async () => []);
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('non-approved claim cannot publish cards', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/publish-agent-cards', async (text) => String(text).includes('from claim_requests') ? [{ claim_id: 'clm_1', status: 'created' }] : []);
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 409);
});

test('approved claim publishes cards and updates status/event/transition', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const calls = [];
  const handler = load('../api/admin/publish-agent-cards', async (text, params) => {
    calls.push({ text: String(text), params });
    if (String(text).includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'approved' }];
    if (String(text).includes('from claim_agents')) return [{ id: 'a1', claim_id: 'clm_1', ens: 'a.signagent.eth', capability: 'trust-verification', tenant: 'commandlayer', canonical_parent: 'x', skill: 's', skill_family: 'sf', kid: 'k', public_key: 'pk' }];
    if (String(text).includes('from agent_cards')) return [];
    return [];
  });
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CARDS_PUBLISHED');
  assert.ok(calls.some((c) => c.text.includes('insert into agent_cards')));
  assert.ok(calls.some((c) => c.text.includes('update claim_agents')));
  assert.ok(calls.some((c) => c.text.includes("update claim_requests set status = 'cards_published'")));
  assert.ok(calls.some((c) => c.text.includes("insert into claim_events") && c.text.includes('agent_cards.published')));
  assert.ok(calls.some((c) => c.text.includes('insert into claim_status_transitions')));
});

test('idempotent publish returns existing cards', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const calls = [];
  const handler = load('../api/admin/publish-agent-cards', async (text) => {
    calls.push(String(text));
    if (String(text).includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'approved' }];
    if (String(text).includes('from claim_agents')) return [{ id: 'a1', ens: 'a.signagent.eth' }];
    if (String(text).includes('from agent_cards')) return [{ ens: 'a.signagent.eth', card_url: 'https://www.commandlayer.org/agent-cards/agents/v1.1.0/trust/a.signagent.eth.json' }];
    return [];
  });
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CARDS_ALREADY_PUBLISHED');
  assert.equal(calls.some((q) => q.includes('insert into agent_cards')), false);
});

test('public card route returns JSON', async () => {
  const handler = load('../api/agent-cards/card', async () => [{ card_json: { ok: true } }]);
  const res = makeRes();
  await handler({ method: 'GET', query: { ens: 'a.signagent.eth', path: '/agent-cards/agents/v1.1.0/trust/a.signagent.eth.json' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('public card route missing card returns 404', async () => {
  const handler = load('../api/agent-cards/card', async () => []);
  const res = makeRes();
  await handler({ method: 'GET', query: { ens: 'missing.signagent.eth' } }, res);
  assert.equal(res.statusCode, 404);
});
