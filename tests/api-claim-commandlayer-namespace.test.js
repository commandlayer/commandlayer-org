'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/claim/commandlayer-namespace');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function validBody() {
  return {
    authenticatedAddress: '0x0000000000000000000000000000000000000001',
    tenant: 'acme',
    activationMode: 'cl',
    packId: 'trust',
    capabilities: ['sign', 'attest', 'authorize', 'approve', 'reject', 'permit', 'grant', 'authenticate', 'endorse', 'verify'],
    agents: [
      { ens: 'acme.signagent.eth', capability: 'sign', canonicalParent: 'signagent.eth', skill: 'trust-verification.sign', skillFamily: 'trust-verification' }
    ],
    publicKey: 'ed25519:abc123',
    kid: 'kid123',
    verifier: 'https://runtime.commandlayer.org/verify',
    runtime: 'https://runtime.commandlayer.org',
    schemaVersion: '1.1.0'
  };
}

test('rejects non-POST', async () => {
  const res = makeRes();
  await handler({ method: 'GET', body: validBody() }, res);
  assert.equal(res.statusCode, 405);
});

test('rejects missing authenticatedAddress', async () => {
  const body = validBody();
  delete body.authenticatedAddress;
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_authenticated_address');
});

test('rejects invalid tenant', async () => {
  const body = validBody();
  body.tenant = 'Acme';
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_tenant');
});

test('rejects .eth tenant', async () => {
  const body = validBody();
  body.tenant = 'acme.eth';
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_tenant');
});

test('rejects too many capabilities', async () => {
  const body = validBody();
  body.capabilities = ['sign', 'attest', 'authorize', 'approve', 'reject', 'permit', 'grant', 'authenticate', 'endorse', 'verify', 'extra'];
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_capabilities');
});

test('rejects malformed publicKey', async () => {
  const body = validBody();
  body.publicKey = 'nope';
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_public_key');
});

test('rejects non-trust pack', async () => {
  const body = validBody();
  body.packId = 'commerce';
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'unsupported_pack');
});

test('accepts valid Trust Verification request', async () => {
  const res = makeRes();
  await handler({ method: 'POST', body: validBody() }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'CLAIM_REQUEST_VALIDATED');
  assert.match(res.body.claimId, /^clm_[a-f0-9]{24}$/);
});
