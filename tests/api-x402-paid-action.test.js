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

test.beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.CL_RECEIPT_SIGNER_ID;
  delete process.env.CL_RECEIPT_SIGNING_KID;
  delete process.env.CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM;
  delete process.env.RECEIPT_SIGNER_ID;
  delete process.env.RECEIPT_SIGNING_KID;
  delete process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64;
  handler._internal.clearSeen();
});

test.after(() => {
  process.env = originalEnv;
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

test('valid paid action returns signed receipt; duplicate returns same receipt; verifies locally', async () => {
  process.env.CL_RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.CL_RECEIPT_SIGNING_KID = 'x402-kid-1';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  process.env.CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

  const res1 = makeRes();
  await handler({ method: 'POST', headers: {}, body: validPayload() }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.status, 'PAID_ACTION_EXECUTED_AND_SIGNED');
  assert.equal(res1.body.duplicate, false);
  assert.equal(res1.body.receipt.metadata.trace.trace_id, 'x402:req_1');
  assert.equal(res1.body.receipt.metadata.proof.hash.alg, 'SHA-256');
  assert.equal(res1.body.receipt.metadata.proof.signature.alg, 'Ed25519');

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
