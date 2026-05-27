'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handler = require('../api/internal/claims/mark-paid');

function makeRes() { return { statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } }; }

function makeReq(body, auth) { return { method: 'POST', headers: auth ? { authorization: auth } : {}, body }; }

test('missing shared secret env returns 503', async () => {
  delete process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET;
  const res = makeRes();
  await handler(makeReq({}, null), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'INTERNAL_PAYMENT_CONFIRMATION_NOT_CONFIGURED');
});

test('invalid auth returns 401', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const res = makeRes();
  await handler(makeReq({}, 'Bearer nope'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, 'UNAUTHORIZED');
});

test('missing claimId rejected', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const res = makeRes();
  await handler(makeReq({ provider: 'stripe', providerPaymentId: 'cs_1', amountCents: 1 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'CLAIM_ID_REQUIRED');
});

test('payment_pending claim becomes paid', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_1', status: 'payment_pending' }] };
    if (q.includes('from claim_status_transitions')) return { rows: [] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_1', provider: 'stripe', providerPaymentId: 'cs_1', paymentIntentId: 'pi_1', amountCents: 2000, currency: 'usd' }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CLAIM_MARKED_PAID');
  assert.ok(queries.some((q) => q.includes('update claim_requests')));
});

test('already paid claim is idempotent', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_2', status: 'paid' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_2', provider: 'stripe', providerPaymentId: 'cs_2', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CLAIM_MARKED_PAID');
  assert.equal(queries.some((q) => q.includes('insert into claim_status_transitions')), false);
});

test('non-payment_pending claim rejected', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  db.query = async (q) => (q.includes('from claim_requests') ? { rows: [{ claim_id: 'clm_3', status: 'created' }] } : { rows: [] });
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_3', provider: 'stripe', providerPaymentId: 'cs_3', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'CLAIM_NOT_READY_FOR_PAYMENT');
});

test('payment.completed event written', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_4', status: 'payment_pending' }] };
    if (q.includes('from claim_status_transitions')) return { rows: [] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_4', provider: 'stripe', providerPaymentId: 'cs_4', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.ok(queries.some((q) => q.includes("insert into claim_events")));
});

test('payment_pending -> paid transition written', async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_5', status: 'payment_pending' }] };
    if (q.includes('from claim_status_transitions')) return { rows: [] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_5', provider: 'stripe', providerPaymentId: 'cs_5', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.ok(queries.some((q) => q.includes('insert into claim_status_transitions')));
});
