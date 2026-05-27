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
  process.env.NODE_ENV = 'test';
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

test('malformed site URL rejected', async () => {
  process.env.COMMANDLAYER_SITE_URL = 'http://localhost:3000';
  const res = makeRes();
  await handler(makeReq({ claimId: 'c1' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'SITE_URL_INVALID');
});

test('cards_published creates checkout and moves to payment_pending', async () => {
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests where')) return { rows: [{ claim_id: 'c1', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c1' }, { 'x-admin-api-key': 'admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.stripeCheckoutSessionId, 'cs_1');
  assert.ok(queries.some((q) => q.includes('update claim_requests set')));
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
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c3', forceNew: true }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stripeCheckoutSessionId, 'cs_new');
});

test('stripe API error returns STRIPE_CHECKOUT_CREATE_FAILED', async () => {
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c6', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: false, json: async () => ({ error: { message: 'bad', code: 'resource_missing', type: 'invalid_request_error' } }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c6' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.status, 'STRIPE_CHECKOUT_CREATE_FAILED');
  assert.equal(res.body.debug.code, 'resource_missing');
});



test('existing claim_payments row updates without insert', async () => {
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c9', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    if (q.includes('update claim_payments')) return { rowCount: 1, rows: [] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_9', url: 'https://checkout.stripe.com/c/pay/cs_9' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c9' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(queries.some((q) => q.includes('insert into claim_payments')), false);
});

test('missing claim_payments row inserts', async () => {
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c10', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    if (q.includes('update claim_payments')) return { rowCount: 0, rows: [] };
    if (q.includes('insert into claim_payments')) return { rowCount: 1, rows: [] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_10', url: 'https://checkout.stripe.com/c/pay/cs_10' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c10' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(queries.some((q) => q.includes('insert into claim_payments')), true);
});

test('duplicate insert race retries update once', async () => {
  let updateCalls = 0;
  let insertCalls = 0;
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c11', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    if (q.includes('update claim_payments')) {
      updateCalls += 1;
      return { rowCount: 0, rows: [] };
    }
    if (q.includes('insert into claim_payments')) {
      insertCalls += 1;
      const err = new Error('duplicate key');
      err.code = '23505';
      throw err;
    }
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_11', url: 'https://checkout.stripe.com/c/pay/cs_11' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c11' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(insertCalls, 1);
  assert.equal(updateCalls, 2);
});

test('no ON CONFLICT required for claim_payments write', async () => {
  const queries = [];
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c12', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    if (q.includes('update claim_payments')) return { rowCount: 1, rows: [] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_12', url: 'https://checkout.stripe.com/c/pay/cs_12' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c12' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 200);
  const serialized = queries.join('\n').toLowerCase();
  assert.equal(serialized.includes('on conflict'), false);
});

test('DB write failure returns CHECKOUT_SESSION_DB_WRITE_FAILED', async () => {
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c7', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    if (q.includes('information_schema.tables')) return { rows: [{ '?column?': 1 }] };
    if (q.includes('update claim_payments')) throw new Error('db update failed');
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_7', url: 'https://checkout.stripe.com/c/pay/cs_7' }) });

  const res = makeRes();
  await handler(makeReq({ claimId: 'c7' }, { authorization: 'Bearer admin-secret' }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'CHECKOUT_SESSION_DB_WRITE_FAILED');
  assert.equal(res.body.error, 'Checkout was created but payment state could not be saved.');
  assert.equal(typeof res.body.debug.message, 'string');
});

test('no secrets logged', async () => {
  const logs = [];
  const orig = console.error;
  console.error = (...args) => logs.push(args);
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c8', tenant: 'tenant1', pack_id: 'starter', status: 'cards_published', payment_status: 'unpaid' }] };
    if (q.includes('from claim_payments')) return { rows: [] };
    return { rows: [] };
  };
  global.fetch = async () => ({ ok: false, json: async () => ({ error: { message: 'bad', code: 'x' } }) });
  const res = makeRes();
  await handler(makeReq({ claimId: 'c8' }, { authorization: 'Bearer admin-secret' }), res);
  console.error = orig;
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('sk_test_123'), false);
  assert.equal(serialized.includes('admin-secret'), false);
});
