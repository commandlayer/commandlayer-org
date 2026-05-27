'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const claimsHandler = require('../api/admin/claims');
const claimHandler = require('../api/admin/claim');

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

test('GET /api/admin/claims missing ADMIN_API_KEY returns auth error, not 404', async () => {
  process.env.ADMIN_API_KEY = 'admin-secret';
  const res = makeRes();
  await claimsHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, 'UNAUTHORIZED');
});

test('GET /api/admin/claims valid auth returns claims array', async () => {
  process.env.ADMIN_API_KEY = 'admin-secret';
  db.query = async () => ({ rows: [{ claim_id: 'c1', tenant: 't1', authenticated_address: '0xabc', pack_id: 'p1', status: 'created', payment_status: 'unpaid', created_at: '2026-05-27T00:00:00.000Z', paid_at: null, stripe_checkout_session_id: null, agent_count: 2 }] });
  const res = makeRes();
  await claimsHandler({ method: 'GET', headers: { authorization: 'Bearer admin-secret' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(Array.isArray(res.body.claims), true);
  assert.deepEqual(res.body.claims[0], {
    claimId: 'c1', tenant: 't1', wallet: '0xabc', packId: 'p1', status: 'created', paymentStatus: 'unpaid', agentCount: 2, createdAt: '2026-05-27T00:00:00.000Z', paidAt: null, stripeCheckoutSessionId: null,
  });
});

test('GET /api/admin/claim missing claimId returns validation error', async () => {
  process.env.ADMIN_API_KEY = 'admin-secret';
  const res = makeRes();
  await claimHandler({ method: 'GET', headers: { authorization: 'Bearer admin-secret' }, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'CLAIM_ID_REQUIRED');
});

test('GET /api/admin/claim unknown claim returns CLAIM_NOT_FOUND', async () => {
  process.env.ADMIN_API_KEY = 'admin-secret';
  db.query = async (q) => (q.includes('from claim_requests') ? { rows: [] } : { rows: [] });
  const res = makeRes();
  await claimHandler({ method: 'GET', headers: { authorization: 'Bearer admin-secret' }, query: { claimId: 'missing' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.status, 'CLAIM_NOT_FOUND');
});

test('GET /api/admin/claim returns detail shape compatible with admin UI', async () => {
  process.env.ADMIN_API_KEY = 'admin-secret';
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c2', status: 'approved', tenant: 'tenant-a', authenticated_address: '0x123', pack_id: 'pack' }] };
    if (q.includes('from claim_agents')) return { rows: [{ claim_id: 'c2', ens: 'alpha.eth', card_url: 'https://example/card.json' }] };
    if (q.includes('from claim_events')) return { rows: [{ claim_id: 'c2', event_type: 'approved', created_at: '2026-05-27T01:00:00.000Z' }] };
    if (q.includes('to_regclass')) return { rows: [{ table_name: 'exists' }] };
    if (q.includes('from claim_status_transitions')) return { rows: [{ claim_id: 'c2', from_status: 'created', to_status: 'approved' }] };
    if (q.includes('from agent_cards')) return { rows: [{ claim_id: 'c2', card_url: 'https://example/card.json' }] };
    if (q.includes('from claim_payments')) return { rows: [{ claim_id: 'c2', stripe_checkout_session_id: 'cs_123' }] };
    return { rows: [] };
  };

  const res = makeRes();
  await claimHandler({ method: 'GET', headers: { authorization: 'Bearer admin-secret' }, query: { claimId: 'c2' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.claim.claim_id, 'c2');
  assert.equal(Array.isArray(res.body.agents), true);
  assert.equal(Array.isArray(res.body.events), true);
  assert.equal(Array.isArray(res.body.transitions), true);
  assert.equal(Array.isArray(res.body.cards), true);
  assert.equal(res.body.latestPayment.stripe_checkout_session_id, 'cs_123');
});
