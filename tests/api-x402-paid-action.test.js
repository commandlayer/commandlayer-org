'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const handler = require('../api/examples/x402-paid-action');
const { verifyReceipt } = require('../lib/verifyReceipt');

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

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function validPayload(overrides = {}) {
  return {
    request_id: 'req_1',
    action: 'summarize.text',
    input: { text: 'This is a deterministic test summary body for x402.' },
    payment: {
      payment_id: 'pay_1',
      protocol: 'x402',
      status: 'accepted',
      asset: 'USDC',
      amount: '0.01',
      network: 'base',
    },
    ...overrides,
  };
}

function setSigningEnv() {
  process.env.CL_RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.CL_RECEIPT_SIGNING_KID = 'x402-kid-1';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  process.env.CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
}

test.beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.CL_RECEIPT_SIGNER_ID;
  delete process.env.CL_RECEIPT_SIGNING_KID;
  delete process.env.CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM;
  delete process.env.RECEIPT_SIGNER_ID;
  delete process.env.RECEIPT_SIGNING_KID;
  delete process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64;
  delete process.env.X402_PROVIDER_VERIFICATION_URL;
  delete process.env.X402_PROVIDER_API_KEY;
  global.fetch = originalFetch;
  handler._internal.clearSeen();
});

test.after(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

test('GET returns 405', async () => {
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('missing body returns 400', async () => {
  const res = makeRes();
  await handler({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'malformed_payload');
});

test('missing payment returns 402', async () => {
  const payload = validPayload();
  delete payload.payment;
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: payload }, res);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.status, 'payment_required');
});

test('invalid payment protocol/status returns 400', async () => {
  const resProtocol = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload({ payment: { ...validPayload().payment, protocol: 'not-x402' } }) }, resProtocol);
  assert.equal(resProtocol.statusCode, 400);
  assert.equal(resProtocol.body.status, 'payment_invalid');

  const resStatus = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload({ payment: { ...validPayload().payment, status: 'pending' } }) }, resStatus);
  assert.equal(resStatus.statusCode, 400);
  assert.equal(resStatus.body.status, 'payment_invalid');
});

test('unsupported action returns 400', async () => {
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload({ action: 'parse.text' }) }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'unsupported_action');
});

test('missing signing env returns 503 after valid request', async () => {
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'signing_unavailable');
});

test('demo mode returns signed receipt, includes verification mode, duplicate returns same receipt; verifies locally', async () => {
  const pubRaw = setSigningEnv();

  const res1 = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.status, 'PAID_ACTION_EXECUTED_AND_SIGNED');
  assert.equal(res1.body.duplicate, false);
  assert.equal(res1.body.receipt.output.payment_verification_mode, 'demo_accepted_envelope');
  assert.equal(res1.body.receipt.metadata.trace.tags.payment_verification_mode, 'demo_accepted_envelope');

  const verification = await verifyReceipt(res1.body.receipt, {
    ens: {
      textResolver: async (name, key) => {
        if (name !== 'runtime.commandlayer.eth') return null;
        const records = {
          'cl.sig.pub': `ed25519:${pubRaw}`,
          'cl.sig.kid': 'x402-kid-1',
          'cl.sig.canonical': 'json.sorted_keys.v1',
          'cl.receipt.signer': 'runtime.commandlayer.eth',
        };
        return records[key] || null;
      },
    },
  });
  assert.equal(verification.ok, true);

  const res2 = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.duplicate, true);
  assert.deepEqual(res2.body.receipt, res1.body.receipt);
});

test('provider mode success returns provider_verified and safe provider metadata', async () => {
  const pubRaw = setSigningEnv();
  process.env.X402_PROVIDER_VERIFICATION_URL = 'https://provider.example/verify';
  process.env.X402_PROVIDER_API_KEY = 'super-secret-token';

  global.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer super-secret-token');
    return {
      ok: true,
      status: 200,
      async json() {
        return { accepted: true, status: 'settled', reference: 'prov_ref_123', provider: 'demo-provider' };
      },
    };
  };

  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.receipt.output.payment_verification_mode, 'provider_verified');
  assert.equal(res.body.receipt.metadata.trace.tags.payment_verification_mode, 'provider_verified');
  assert.equal(res.body.receipt.metadata.trace.provider_verification.reference, 'prov_ref_123');
  assert.equal(JSON.stringify(res.body).includes('super-secret-token'), false);

  const verification = await verifyReceipt(res.body.receipt, {
    ens: {
      textResolver: async (name, key) => {
        if (name !== 'runtime.commandlayer.eth') return null;
        const records = {
          'cl.sig.pub': `ed25519:${pubRaw}`,
          'cl.sig.kid': 'x402-kid-1',
          'cl.sig.canonical': 'json.sorted_keys.v1',
          'cl.receipt.signer': 'runtime.commandlayer.eth',
        };
        return records[key] || null;
      },
    },
  });
  assert.equal(verification.ok, true);
});

test('provider mode rejection returns payment_invalid/payment_required', async () => {
  setSigningEnv();
  process.env.X402_PROVIDER_VERIFICATION_URL = 'https://provider.example/verify';

  global.fetch = async () => ({ ok: false, status: 400, async json() { return { status: 'invalid' }; } });
  const invalidRes = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.status, 'payment_invalid');

  global.fetch = async () => ({ ok: false, status: 402, async json() { return { status: 'required' }; } });
  const requiredRes = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload({ request_id: 'req_2', payment: { ...validPayload().payment, payment_id: 'pay_2' } }) }, requiredRes);
  assert.equal(requiredRes.statusCode, 402);
  assert.equal(requiredRes.body.status, 'payment_required');
});

test('provider unavailable/malformed response returns 503 payment_provider_unavailable', async () => {
  setSigningEnv();
  process.env.X402_PROVIDER_VERIFICATION_URL = 'https://provider.example/verify';

  global.fetch = async () => { throw new Error('network'); };
  const networkRes = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, networkRes);
  assert.equal(networkRes.statusCode, 503);
  assert.equal(networkRes.body.status, 'payment_provider_unavailable');

  global.fetch = async () => ({ ok: true, status: 200, async json() { return 'bad'; } });
  const malformedRes = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload({ request_id: 'req_3', payment: { ...validPayload().payment, payment_id: 'pay_3' } }) }, malformedRes);
  assert.equal(malformedRes.statusCode, 503);
  assert.equal(malformedRes.body.status, 'payment_provider_unavailable');
});
