'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const handler = require('../api/verify');

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

const subtle = webcrypto.subtle;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

async function makeRuntimeReceipt() {
  const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = Buffer.from(await subtle.exportKey('raw', keyPair.publicKey)).toString('base64');
  const receipt = {
    signer: 'runtime.commandlayer.eth',
    verb: 'agent.execute',
    ts: '2026-05-20T00:00:00.000Z',
    input: { task: 'verify', content: 'canonical' },
    output: { ok: true },
    execution: { runtime: 'prod', run_id: 'run_1' },
  };
  const payload = { signer: receipt.signer, verb: receipt.verb, input: receipt.input, output: receipt.output, execution: receipt.execution, ts: receipt.ts };
  const canonical = canonicalize(payload);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hashHex = Buffer.from(digest).toString('hex');
  const sigBytes = await subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, new TextEncoder().encode(hashHex));
  receipt.metadata = { proof: { canonicalization: 'json.sorted_keys.v1', hash: { alg: 'SHA-256', value: hashHex }, signature: { alg: 'Ed25519', kid: 'vC4WbcNoq2znSCiQ', value: Buffer.from(sigBytes).toString('base64') }, signer_id: 'runtime.commandlayer.eth' } };
  return { receipt, rawPub };
}

const sampleReceipt = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'canonical-receipt.sample.json'), 'utf8')
);

test('POST /api/verify with canonical sample fixture => INVALID', async () => {
  const req = { method: 'POST', body: sampleReceipt };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
  assert.equal(typeof res.body.public_key_source, 'string');
  assert.equal(res.body.public_key_source, 'ens_txt');
});



test('POST /api/verify with wrapped canonical sample payload => INVALID', async () => {
  const req = { method: 'POST', body: { receipt: sampleReceipt } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
});
test('POST /api/verify with tampered receipt => INVALID', async () => {
  const tampered = structuredClone(sampleReceipt);
  tampered.output.summary = `${tampered.output.summary}!!!`;

  const req = { method: 'POST', body: tampered };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
  assert.equal(res.body.hash_matches, false);
  assert.equal(res.body.signature_valid, false);
});

test('POST /api/verify missing body => 400', async () => {
  const req = { method: 'POST' };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('GET /api/verify => 405', async () => {
  const req = { method: 'GET', body: sampleReceipt };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.body.ok, false);
});

test('POST /api/verify oversized body => 413', async () => {
  const req = { method: 'POST', body: sampleReceipt, headers: { 'content-length': String(2 * 1024 * 1024) } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
});


test('POST /api/verify can verify with injected ENS resolver', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  const req = {
    method: 'POST',
    body: receipt,
    verifyOptions: {
      ens: {
        textResolver: async (_ens, key) => ({
          'cl.sig.pub': `ed25519:${rawPub}`,
          'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
          'cl.sig.canonical': 'json.sorted_keys.v1',
          'cl.receipt.signer': 'runtime.commandlayer.eth',
        })[key] || null,
      },
    },
  };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'VERIFIED');
  assert.equal(res.body.public_key_source, 'ens_txt');
  assert.equal(res.body.ens_resolved, true);
});
