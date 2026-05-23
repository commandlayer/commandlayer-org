'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const handler = require('../api/examples/coinbase-webhook');
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

function signHook({ secret, timestamp, headers, rawBody, signedHeaderNames = ['content-type'] }) {
  const headerNamesString = signedHeaderNames.join(' ');
  const signedHeaderValues = signedHeaderNames.map((h) => String(headers[h] ?? headers[h.toLowerCase()] ?? '')).join('.');
  const payload = `${timestamp}.${headerNamesString}.${signedHeaderValues}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestamp},h=${headerNamesString},v1=${v1}`;
}

const originalEnv = { ...process.env };

test.beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.COINBASE_WEBHOOK_SECRET;
  delete process.env.CL_RECEIPT_SIGNER_ID;
  delete process.env.CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM;
  delete process.env.CL_RECEIPT_SIGNING_KID;
  delete process.env.COINBASE_WEBHOOK_MAX_AGE_SECONDS;
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

test('missing Coinbase secret returns 503', async () => {
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: '{}' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'configuration_unavailable');
});

test('missing signature returns 400', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'missing_signature');
});

test('invalid signature returns 400', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'onchain.activity.detected' });
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hook0-signature': `t=${Math.floor(Date.now()/1000)},h=content-type,v1=deadbeef` },
    body: rawBody,
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'invalid_signature');
  assert.equal(handler._internal.seenReceipts.size, 0);
});

test('stale timestamp returns 400', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  const timestamp = Math.floor(Date.now() / 1000) - 1000;
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'onchain.activity.detected' });
  const headers = { 'content-type': 'application/json' };
  const sig = signHook({ secret: process.env.COINBASE_WEBHOOK_SECRET, timestamp, headers, rawBody });
  const res = makeRes();
  await handler({ method: 'POST', headers: { ...headers, 'x-hook0-signature': sig }, body: rawBody }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'stale_signature');
});

test('malformed JSON after valid HMAC returns 400', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  const rawBody = '{bad json';
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = { 'content-type': 'application/json' };
  const sig = signHook({ secret: process.env.COINBASE_WEBHOOK_SECRET, timestamp, headers, rawBody });
  const res = makeRes();
  await handler({ method: 'POST', headers: { ...headers, 'x-hook0-signature': sig }, body: rawBody }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'malformed_payload');
});

test('missing signing env returns 503 after valid HMAC', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  const rawBody = JSON.stringify({ id: 'evt_2', type: 'onchain.activity.detected' });
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = { 'content-type': 'application/json' };
  const sig = signHook({ secret: process.env.COINBASE_WEBHOOK_SECRET, timestamp, headers, rawBody });
  const res = makeRes();
  await handler({ method: 'POST', headers: { ...headers, 'x-hook0-signature': sig }, body: rawBody }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'signing_unavailable');
});

test('valid payload returns signed receipt and duplicate returns same receipt', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  process.env.CL_RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.CL_RECEIPT_SIGNING_KID = 'test-kid-1';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  process.env.CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const rawBody = JSON.stringify({ id: 'evt_3', type: 'wallet.transaction', data: { transactionHash: '0xabc' } });
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = { 'content-type': 'application/json' };
  const sig = signHook({ secret: process.env.COINBASE_WEBHOOK_SECRET, timestamp, headers, rawBody });

  const res1 = makeRes();
  await handler({ method: 'POST', headers: { ...headers, 'x-hook0-signature': sig }, body: rawBody }, res1);

  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.status, 'WEBHOOK_VERIFIED_AND_SIGNED');
  assert.equal(res1.body.duplicate, false);
  assert.equal(res1.body.receipt.metadata.trace.tags.provider, 'coinbase_cdp');
  assert.equal(res1.body.receipt.metadata.proof.hash.alg, 'SHA-256');
  assert.equal(res1.body.receipt.metadata.proof.signature.alg, 'Ed25519');
  assert.equal(res1.body.receipt.metadata.proof.signature.role, 'runtime');

  const verification = await verifyReceipt(res1.body.receipt, {
    ens: {
      textResolver: async (name, key) => {
        if (name !== 'runtime.commandlayer.eth') return null;
        const records = {
          'cl.sig.pub': `ed25519:${pubRaw}`,
          'cl.sig.kid': 'test-kid-1',
          'cl.sig.canonical': 'json.sorted_keys.v1',
          'cl.receipt.signer': 'runtime.commandlayer.eth',
        };
        return records[key] || null;
      },
    },
  });
  assert.equal(verification.ok, true);

  const res2 = makeRes();
  await handler({ method: 'POST', headers: { ...headers, 'x-hook0-signature': sig }, body: rawBody }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.duplicate, true);
  assert.deepEqual(res2.body.receipt, res1.body.receipt);
});


test('runtime-compatible alias RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 signs successfully', async () => {
  process.env.COINBASE_WEBHOOK_SECRET = 'test_secret';
  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'test-kid-2';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 = Buffer
    .from(privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8')
    .toString('base64');

  const pubRaw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const rawBody = JSON.stringify({ id: 'evt_alias_1', type: 'wallet.transaction', data: { transactionHash: '0xdef' } });
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = { 'content-type': 'application/json' };
  const sig = signHook({ secret: process.env.COINBASE_WEBHOOK_SECRET, timestamp, headers, rawBody });

  const res = makeRes();
  await handler({ method: 'POST', headers: { ...headers, 'x-hook0-signature': sig }, body: rawBody }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'WEBHOOK_VERIFIED_AND_SIGNED');
  assert.equal(res.body.receipt.metadata.proof.signature.kid, 'test-kid-2');

  const verification = await verifyReceipt(res.body.receipt, {
    ens: {
      textResolver: async (name, key) => {
        if (name !== 'runtime.commandlayer.eth') return null;
        const records = {
          'cl.sig.pub': `ed25519:${pubRaw}`,
          'cl.sig.kid': 'test-kid-2',
          'cl.sig.canonical': 'json.sorted_keys.v1',
          'cl.receipt.signer': 'runtime.commandlayer.eth',
        };
        return records[key] || null;
      },
    },
  });
  assert.equal(verification.ok, true);
});
