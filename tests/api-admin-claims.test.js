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

test('admin claims returns ADMIN_NOT_CONFIGURED when key missing', async () => {
  delete process.env.ADMIN_API_KEY;
  const handler = load('../api/admin/claims', async () => ({ rows: [] }));
  const res = makeRes(); await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.status, 'ADMIN_NOT_CONFIGURED');
});

test('admin claims returns UNAUTHORIZED when auth missing', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/claims', async () => ({ rows: [] }));
  const res = makeRes(); await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401); assert.equal(res.body.status, 'UNAUTHORIZED');
});

test('admin claim detail includes transitions', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/claim', async (text) => {
    const q = String(text);
    if (q.includes('from claim_requests')) return [{ claim_id: 'clm_1', tenant: 'commandlayer', request_json: {} }];
    if (q.includes('from claim_agents')) return [{ ens: 'x.signagent.eth' }];
    if (q.includes('from claim_events')) return [{ event_type: 'claim.created' }];
    return [{ to_status: 'approved' }];
  });
  const res = makeRes(); await handler({ method: 'GET', headers: { authorization: 'Bearer secret' }, query: { claimId: 'clm_1' } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body.transitions, [{ to_status: 'approved' }]);
});

test('claim action auth and config checks', async () => {
  delete process.env.ADMIN_API_KEY;
  let handler = load('../api/admin/claim-action', async () => []);
  let res = makeRes(); await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.status, 'ADMIN_NOT_CONFIGURED');

  process.env.ADMIN_API_KEY = 'secret';
  handler = load('../api/admin/claim-action', async () => []);
  res = makeRes(); await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401); assert.equal(res.body.status, 'UNAUTHORIZED');
});

test('approve created claim succeeds and writes event/transition', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const calls = [];
  const handler = load('../api/admin/claim-action', async (text, params) => { calls.push({ text: String(text), params }); if (String(text).includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'created', admin_notes: '' }]; return { rows: [] }; });
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1', action: 'approve', actor: 'admin', notes: 'ok' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.claimStatus, 'approved');
  assert.ok(calls.some((c) => c.text.includes('update claim_requests')));
  assert.ok(calls.some((c) => c.text.includes('insert into claim_events')));
  assert.ok(calls.some((c) => c.text.includes('insert into claim_status_transitions')));
});

test('reject created claim with reason succeeds; reject without reason fails', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  let handler = load('../api/admin/claim-action', async (text) => String(text).includes('from claim_requests') ? [{ claim_id: 'clm_1', status: 'created' }] : []);
  let res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1', action: 'reject', actor: 'admin', reason: 'bad docs' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.claimStatus, 'rejected');

  handler = load('../api/admin/claim-action', async () => []);
  res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1', action: 'reject', actor: 'admin' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.status, 'REASON_REQUIRED');
});

test('invalid transition fails', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  const handler = load('../api/admin/claim-action', async (text) => String(text).includes('from claim_requests') ? [{ claim_id: 'clm_1', status: 'cards_published' }] : []);
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1', action: 'approve', actor: 'admin' } }, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.status, 'INVALID_STATUS_TRANSITION');
});

test('mark_failed requires reason and add_note does not change status while inserting event', async () => {
  process.env.ADMIN_API_KEY = 'secret';
  let handler = load('../api/admin/claim-action', async () => []);
  let res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1', action: 'mark_failed', actor: 'admin' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.status, 'REASON_REQUIRED');

  const calls = [];
  handler = load('../api/admin/claim-action', async (text, params) => { calls.push(String(text)); if (String(text).includes('from claim_requests')) return [{ claim_id: 'clm_1', status: 'approved', admin_notes: 'n1' }]; return []; });
  res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { claimId: 'clm_1', action: 'add_note', actor: 'admin', notes: 'n2' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.claimStatus, 'approved');
  assert.ok(calls.some((q) => q.includes('insert into claim_events')));
  assert.equal(calls.some((q) => q.includes('insert into claim_status_transitions')), false);
});
