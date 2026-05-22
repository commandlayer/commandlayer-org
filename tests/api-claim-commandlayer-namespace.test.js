'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

function loadHandlerWithMockQuery(mockQuery) {
  const handlerPath = require.resolve('../api/claim/commandlayer-namespace');
  const dbPath = require.resolve('../lib/db');
  delete require.cache[handlerPath];
  delete require.cache[dbPath];
  require.cache[dbPath] = { exports: { query: mockQuery, getDatabaseUrl: () => process.env.DATABASE_URL } };
  return require('../api/claim/commandlayer-namespace');
}

test('rejects non-POST', async () => {
  const handler = loadHandlerWithMockQuery(async () => ({ rows: [] }));
  const res = makeRes();
  await handler({ method: 'GET', body: validBody() }, res);
  assert.equal(res.statusCode, 405);
});

test('missing DATABASE_URL returns STORAGE_UNAVAILABLE for valid payload', async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const handler = loadHandlerWithMockQuery(async () => ({ rows: [] }));
  const res = makeRes();
  await handler({ method: 'POST', body: validBody() }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'STORAGE_UNAVAILABLE');
  process.env.DATABASE_URL = original;
});

test('invalid tenant fails before DB', async () => {
  process.env.DATABASE_URL = 'postgres://example.com/db';
  let dbCalled = false;
  const handler = loadHandlerWithMockQuery(async () => { dbCalled = true; return { rows: [] }; });
  const body = validBody();
  body.tenant = 'Acme';
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_tenant');
  assert.equal(dbCalled, false);
});

test('unsupported pack fails before DB', async () => {
  process.env.DATABASE_URL = 'postgres://example.com/db';
  let dbCalled = false;
  const handler = loadHandlerWithMockQuery(async () => { dbCalled = true; return { rows: [] }; });
  const body = validBody();
  body.packId = 'commerce';
  const res = makeRes();
  await handler({ method: 'POST', body }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'unsupported_pack');
  assert.equal(dbCalled, false);
});

test('valid payload with mocked DB returns CLAIM_REQUEST_CREATED', async () => {
  process.env.DATABASE_URL = 'postgres://example.com/db';
  const calls = [];
  const handler = loadHandlerWithMockQuery(async (text, params) => {
    calls.push({ text, params });
    return { rows: [] };
  });

  const res = makeRes();
  await handler({ method: 'POST', body: validBody() }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'CLAIM_REQUEST_CREATED');
  assert.match(res.body.claimId, /^clm_[a-f0-9]{32}$/);
  assert.equal(Array.isArray(res.body.agents), true);
  assert.equal(calls.length >= 5, true);
});

test('claim.created event insertion is attempted', async () => {
  process.env.DATABASE_URL = 'postgres://example.com/db';
  const calls = [];
  const handler = loadHandlerWithMockQuery(async (text, params) => {
    calls.push({ text, params });
    return { rows: [] };
  });

  const res = makeRes();
  await handler({ method: 'POST', body: validBody() }, res);

  const eventInsert = calls.find((entry) => String(entry.text).includes('insert into claim_events'));
  assert.ok(eventInsert);
  assert.equal(eventInsert.params[1], 'claim.created');
  assert.equal(eventInsert.params[2], 'CommandLayer namespace claim request created.');
});
