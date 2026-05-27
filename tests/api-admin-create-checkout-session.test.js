'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handler = require('../api/admin/create-checkout-session');

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

function makeReq(body, headers = {}) {
  return { method: 'POST', headers, body };
}

test.beforeEach(() => {
  process.env.ADMIN_API_KEY = 'admin-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_FOUNDING_PRICE_CENTS = '2000';
  process.env.COMMANDLAYER_SITE_URL = 'https://www.commandlayer.org';
});

test('missing auth rejected', async () => {
  const res = makeRes();
  await handler(makeReq({ claimId: 'c1' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, 'UNAUTHORIZED');
});

test('missing Stripe key returns STRIPE_NOT_CONFIGURED', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const res = makeRes();
  await handler(makeReq({ claimId: 'c1' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'STRIPE_NOT_CONFIGURED');
});

test('pk_ key rejected', async () => {
  process.env.STRIPE_SECRET_KEY = 'pk_test_123';
  const res = makeRes();
  await handler(makeReq({ claimId: 'c1' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'STRIPE_SECRET_KEY_INVALID');
});

test('cards_published creates checkout and moves to payment_pending', async () => {
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c1', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.columns')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c1' }, { 'x-admin-api-key': 'admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.stripeCheckoutSessionId, 'cs_1');
  assert.ok(queries.some((q) => q.includes('update claim_requests set status =')));
});

test('payment_pending without forceNew reuses existing checkout if available', async () => {
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c2', tenant: 'tenant1', pack_id: 'starter', status: 'payment_pending', payment_status: 'pending' }] };
    if (q.includes('from claim_payments')) return { rows: [{ checkout_url: 'https://checkout.stripe.com/c/pay/cs_existing', stripe_checkout_session_id: 'cs_existing' }] };
    throw new Error(`unexpected query ${q}`);
  };

  const res = makeRes();
  await handler(makeReq({ claimId: 'c2' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_existing');
});

test('payment_pending with forceNew creates new checkout', async () => {
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c3', tenant: 'tenant1', pack_id: 'starter', status: 'payment_pending', payment_status: 'pending' }] };
    if (q.includes('from claim_payments')) return { rows: [{ checkout_url: 'https://checkout.stripe.com/c/pay/cs_old', stripe_checkout_session_id: 'cs_old' }] };
    if (q.includes('information_schema.columns')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c3', forceNew: true }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stripeCheckoutSessionId, 'cs_new');
});

test('paid claim rejected', async () => {
  db.query = async (q) => (q.includes('from claim_requests')
    ? { rows: [{ claim_id: 'c4', status: 'payment_pending', payment_status: 'paid' }] }
    : { rows: [] });
  const res = makeRes();
  await handler(makeReq({ claimId: 'c4' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.status, 'PAYMENT_ALREADY_COMPLETED');
});

test('non-ready claim rejected', async () => {
  db.query = async (q) => (q.includes('from claim_requests')
    ? { rows: [{ claim_id: 'c5', status: 'created', payment_status: 'unpaid' }] }
    : { rows: [] });
  const res = makeRes();
  await handler(makeReq({ claimId: 'c5' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.status, 'CLAIM_NOT_READY_FOR_PAYMENT');
});

test('no DB mutation if Stripe session creation fails', async () => {
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c6', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: false, json: async () => ({ error: { message: 'bad' } }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c6' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.status, 'CHECKOUT_SESSION_CREATE_FAILED');
  assert.equal(queries.some((q) => q.includes('insert into claim_payments')), false);
  assert.equal(queries.some((q) => q.includes('update claim_requests')), false);
});
