'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handler = require('../api/internal/claims/mark-paid');

function makeRes() { return { statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } }; }
function makeReq(body, auth) { return { method: 'POST', headers: auth ? { authorization: auth } : {}, body }; }

function withEnv(fn) {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  return Promise.resolve(fn()).finally(() => { process.env.NODE_ENV = old; });
}

test('missing shared secret env returns 503', async () => withEnv(async () => {
  delete process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET;
  const res = makeRes();
  await handler(makeReq({}, null), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'INTERNAL_PAYMENT_CONFIRMATION_NOT_CONFIGURED');
}));

test('bad bearer rejected', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const res = makeRes();
  await handler(makeReq({}, 'Bearer nope'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, 'UNAUTHORIZED');
}));

test('missing claimId rejected', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const res = makeRes();
  await handler(makeReq({ provider: 'stripe', providerPaymentId: 'cs_1', amountCents: 1 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'CLAIM_ID_REQUIRED');
}));

test('unknown claim returns CLAIM_NOT_FOUND', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  db.query = async (q) => (q.includes('from claim_requests') ? { rows: [] } : { rows: [] });
  const res = makeRes();
  await handler(makeReq({ claimId: 'missing', provider: 'stripe', providerPaymentId: 'cs_x', amountCents: 99 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.status, 'CLAIM_NOT_FOUND');
  assert.equal(res.body.debug.code, 'CLAIM_NOT_FOUND');
}));

test('valid commercial payload marks payment_pending claim paid', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const queries = [];
  db.query = async (q, params) => {
    queries.push({ q, params });
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_1', status: 'payment_pending' }] };
    if (q.includes('update claim_payments')) return { rowCount: 1, rows: [] };
    if (q.includes('from claim_status_transitions')) return { rows: [] };
    return { rowCount: 1, rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_1', provider: 'stripe', providerPaymentId: 'cs_1', stripePaymentIntentId: 'pi_1', amountCents: 2000, currency: 'USD' }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CLAIM_MARKED_PAID');
  const claimUpdate = queries.find((entry) => entry.q.includes('update claim_requests'));
  assert.ok(claimUpdate);
  assert.equal(claimUpdate.params[1], 'cs_1');
}));

test('already paid claim returns ok true', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_2', status: 'paid' }] };
    if (q.includes('update claim_payments')) return { rowCount: 1, rows: [] };
    return { rowCount: 0, rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_2', provider: 'stripe', providerPaymentId: 'cs_2', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(queries.some((q) => q.includes('update claim_requests')), false);
}));

test('claim_payments update-then-insert works without ON CONFLICT', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  const ops = [];
  db.query = async (q) => {
    ops.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_3', status: 'payment_pending' }] };
    if (q.includes('update claim_payments')) return { rowCount: 0, rows: [] };
    if (q.includes('insert into claim_payments')) return { rowCount: 1, rows: [] };
    if (q.includes('from claim_status_transitions')) return { rows: [] };
    return { rowCount: 1, rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_3', provider: 'stripe', stripeCheckoutSessionId: 'cs_3', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.ok(ops.some((q) => q.includes('insert into claim_payments')));
  assert.equal(ops.some((q) => q.includes('on conflict')), false);
}));

test('missing optional event/transition table does not block paid update', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'top-secret';
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'clm_4', status: 'payment_pending' }] };
    if (q.includes('update claim_payments')) return { rowCount: 1, rows: [] };
    if (q.includes('insert into claim_events') || q.includes('claim_status_transitions')) {
      const err = new Error('relation does not exist');
      err.code = '42P01';
      throw err;
    }
    return { rowCount: 1, rows: [] };
  };
  const res = makeRes();
  await handler(makeReq({ claimId: 'clm_4', provider: 'stripe', providerPaymentId: 'cs_4', amountCents: 2000 }, 'Bearer top-secret'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CLAIM_MARKED_PAID');
}));

test('no secrets logged', async () => withEnv(async () => {
  process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET = 'super-secret';
  const logs = [];
  const oldLog = console.log;
  console.log = (line) => logs.push(String(line));
  db.query = async (q) => (q.includes('from claim_requests') ? { rows: [] } : { rows: [] });
  const res = makeRes();
  await handler(makeReq({ claimId: 'missing', provider: 'stripe', providerPaymentId: 'cs_9', amountCents: 1 }, 'Bearer super-secret'), res);
  console.log = oldLog;

  const serialized = logs.join('\n');
  assert.equal(serialized.includes('super-secret'), false);
  assert.equal(serialized.includes('Bearer super-secret'), false);
  assert.equal(serialized.includes('COMMERCIAL_WEBHOOK_SHARED_SECRET'), false);
}));
