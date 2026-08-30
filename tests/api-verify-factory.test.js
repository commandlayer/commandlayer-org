'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/verify-factory');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function receipt() {
  return {
    receipt_id: 'receipt_factory_deployed_1',
    profile: 'commandlayer.execution-evidence.v1',
    issued_at: '2026-08-30T05:00:00.000Z',
    execution: { execution_id: 'exec_1' },
    proof: { kid: 'commandlayer-kms-ed25519-1', signer_id: 'commandlayer.org', canonical: 'json.sorted_keys.v1' },
  };
}

test('factory verifier returns VerifyAgent result from the installed verifier seam', async () => {
  const req = {
    method: 'POST',
    body: { receipt: receipt() },
    factoryVerify: async (value, options) => {
      assert.equal(value.profile, 'commandlayer.execution-evidence.v1');
      assert.deepEqual(options, { keyDocument: { url: 'https://keys.example/.well-known/commandlayer-receipt-keys' } });
      return {
        valid: true,
        ok: true,
        status: 'VERIFIED',
        truth_certified: false,
        proof_scope: 'execution_integrity_and_provenance',
        checks: { signature: true, signer: true },
        errors: [],
      };
    },
    factoryVerifyOptions: { keyDocument: { url: 'https://keys.example/.well-known/commandlayer-receipt-keys' } },
  };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agent, 'verifyagent.eth');
  assert.equal(res.body.action, 'verify_factory_execution_receipt');
  assert.equal(res.body.status, 'VERIFIED');
  assert.equal(res.body.truth_certified, false);
});

test('deployed route fails closed when the server trust root is not configured', async () => {
  const prior = process.env.COMMANDLAYER_RECEIPT_KEY_URL;
  delete process.env.COMMANDLAYER_RECEIPT_KEY_URL;
  try {
    const res = makeRes();
    await handler({ method: 'POST', body: { receipt: receipt() } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.status, 'INDETERMINATE');
    assert.equal(res.body.reason, 'FACTORY_TRUST_ROOT_NOT_CONFIGURED');
  } finally {
    if (prior === undefined) delete process.env.COMMANDLAYER_RECEIPT_KEY_URL;
    else process.env.COMMANDLAYER_RECEIPT_KEY_URL = prior;
  }
});

test('factory verifier rejects invalid method, body and oversized payload', async () => {
  let res = makeRes();
  await handler({ method: 'GET', body: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST,OPTIONS');

  res = makeRes();
  await handler({ method: 'POST', body: null }, res);
  assert.equal(res.statusCode, 400);

  res = makeRes();
  await handler({ method: 'POST', body: { receipt: receipt() }, headers: { 'content-length': String(2 * 1024 * 1024) } }, res);
  assert.equal(res.statusCode, 413);
});
