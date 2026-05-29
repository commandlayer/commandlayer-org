'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { webcrypto } = crypto;

const db = require('../lib/db');
const verifyIdHandler = require('../api/verify-id');
const verifyHandler = require('../api/verify');
const getReceiptHandler = require('../api/receipts/[id]');
const { createGenesisReceipt } = require('../lib/receipts/create-genesis-receipt');

const subtle = webcrypto.subtle;

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end(payload) { this.ended = true; this.body = payload; return this; },
  };
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

async function makeStoredReceipt({ receiptId = 'clrcpt_known_valid', receiptType = 'execution' } = {}) {
  const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = Buffer.from(await subtle.exportKey('raw', keyPair.publicKey)).toString('base64');
  const receipt = {
    receipt_id: receiptId,
    receipt_type: receiptType,
    agent: 'verifyagent.eth',
    signer: 'runtime.commandlayer.eth',
    verb: 'agent.execute',
    ts: '2026-05-20T00:00:00.000Z',
    input: { task: 'verify', content: 'by id' },
    output: { ok: true },
    execution: { runtime: 'prod', run_id: 'run_verify_id_1' },
  };
  const payload = { signer: receipt.signer, verb: receipt.verb, input: receipt.input, output: receipt.output, execution: receipt.execution, ts: receipt.ts };
  const hashBytes = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(payload)));
  const hashHex = Buffer.from(hashBytes).toString('hex');
  const sigBytes = await subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, new TextEncoder().encode(hashHex));
  receipt.metadata = {
    proof: {
      canonicalization: 'json.sorted_keys.v1',
      hash: { alg: 'SHA-256', value: hashHex },
      signature: { alg: 'Ed25519', kid: 'vC4WbcNoq2znSCiQ', value: Buffer.from(sigBytes).toString('base64') },
      signer_id: 'runtime.commandlayer.eth',
    },
  };
  const verifyOptions = {
    ens: {
      textResolver: async (_ens, key) => ({
        'cl.sig.pub': `ed25519:${rawPub}`,
        'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
        'cl.sig.canonical': 'json.sorted_keys.v1',
        'cl.receipt.signer': 'runtime.commandlayer.eth',
      })[key] || null,
    },
  };
  return { receipt, rawPub, verifyOptions };
}


async function makeStoredGenesisReceipt({ receiptId = 'cl_genesis_known_valid' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const { receipt } = await createGenesisReceipt({
    claimId: 'claim_known_valid',
    receiptId,
    label: 'verifyagent',
    namespace: 'eth',
    owner: '0x123',
    verbs: ['verify'],
    agentCardHash: 'abc123',
    agentCardCid: 'ipfs://bafy',
    signerId: 'runtime.commandlayer.eth',
    kid: 'kid-genesis',
    privateKeyPem,
    createdAt: '2026-05-20T00:00:00.000Z',
  });
  const verifyOptions = {
    ens: {
      textResolver: async (_ens, key) => ({
        'cl.sig.pub': `ed25519:${rawPub}`,
        'cl.sig.kid': 'kid-genesis',
        'cl.sig.canonical': 'json.sorted_keys.v1',
        'cl.receipt.signer': 'runtime.commandlayer.eth',
      })[key] || null,
    },
  };
  return { receipt, rawPub, verifyOptions };
}

function mockClaimReceipt(receipt) {
  db.query = async (queryText, params) => {
    if (queryText.includes('from claim_requests') && params[0] === receipt.receipt_id) {
      return { rows: [{ genesis_receipt_json: receipt }] };
    }
    if (queryText.includes('from receipts')) return { rows: [] };
    return { rows: [] };
  };
}

test('POST /api/verify-id missing receipt_id returns 400 BAD_REQUEST', async () => {
  const res = makeRes();
  await verifyIdHandler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, status: 'BAD_REQUEST' });
});

test('POST /api/verify-id unknown receipt_id returns 404 RECEIPT_NOT_FOUND', async () => {
  db.query = async () => ({ rows: [] });
  const res = makeRes();
  await verifyIdHandler({ method: 'POST', headers: {}, body: { receipt_id: 'clrcpt_missing' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { ok: false, status: 'RECEIPT_NOT_FOUND', receipt_id: 'clrcpt_missing' });
});

test('POST /api/verify-id known valid claim genesis receipt returns VERIFIED', async () => {
  const { receipt, verifyOptions } = await makeStoredGenesisReceipt();
  mockClaimReceipt(receipt);
  const res = makeRes();
  await verifyIdHandler({ method: 'POST', headers: {}, body: { receipt_id: receipt.receipt_id }, verifyOptions }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'VERIFIED');
  assert.equal(res.body.receipt_id, receipt.receipt_id);
  assert.equal(res.body.receipt_type, 'genesis');
  assert.equal(res.body.agent, 'verifyagent.eth');
  assert.equal(res.body.verb, null);
  assert.equal(res.body.signer, 'runtime.commandlayer.eth');
  assert.equal(res.body.verification.hash_matches, true);
  assert.equal(res.body.verification.signature_valid, true);
  assert.equal(res.body.verification.ens_resolved, true);
  assert.equal(res.body.verification.public_key_source, 'ens_txt');
  assert.equal(res.body.verification.key_id, 'kid-genesis');
});

test('POST /api/verify-id known tampered receipt returns INVALID', async () => {
  const { receipt, verifyOptions } = await makeStoredReceipt({ receiptId: 'clrcpt_tampered' });
  const tampered = structuredClone(receipt);
  tampered.output.ok = false;
  mockClaimReceipt(tampered);
  const res = makeRes();
  await verifyIdHandler({ method: 'POST', headers: {}, body: { receipt_id: tampered.receipt_id }, verifyOptions }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'INVALID');
  assert.equal(res.body.receipt_id, tampered.receipt_id);
  assert.equal(typeof res.body.reason, 'string');
});

test('POST /api/verify-id uses same verification path as /api/verify', async () => {
  const { receipt, verifyOptions } = await makeStoredReceipt({ receiptId: 'clrcpt_same_path' });
  mockClaimReceipt(receipt);

  const byIdRes = makeRes();
  await verifyIdHandler({ method: 'POST', headers: {}, body: { receipt_id: receipt.receipt_id }, verifyOptions }, byIdRes);

  const directRes = makeRes();
  await verifyHandler({ method: 'POST', headers: {}, body: receipt, verifyOptions }, directRes);

  assert.equal(byIdRes.statusCode, 200);
  assert.equal(directRes.statusCode, 200);
  assert.equal(byIdRes.body.status, directRes.body.status);
  assert.equal(byIdRes.body.verification.hash_matches, directRes.body.hash_matches);
  assert.equal(byIdRes.body.verification.signature_valid, directRes.body.signature_valid);
  assert.equal(byIdRes.body.verification.ens_resolved, directRes.body.ens_resolved);
  assert.equal(byIdRes.body.verification.public_key_source, directRes.body.public_key_source);
});

test('POST /api/verify-id does not use local fallback unless explicitly enabled or test mode', async () => {
  const previousFallback = process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK;
  process.env.NODE_ENV = 'production';
  try {
    const { receipt } = await makeStoredReceipt({ receiptId: 'clrcpt_no_fallback' });
    mockClaimReceipt(receipt);
    const res = makeRes();
    await verifyIdHandler({
      method: 'POST',
      headers: {},
      body: { receipt_id: receipt.receipt_id },
      verifyOptions: { ens: { textResolver: async () => null } },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.status, 'INVALID');
    assert.equal(res.body.reason, 'ens_key_unavailable');
  } finally {
    if (previousFallback === undefined) delete process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK;
    else process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK = previousFallback;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('POST /api/verify-id does not leak DB errors or secrets', async () => {
  db.query = async () => {
    const error = new Error('connection failed with password=super-secret');
    error.code = 'XX000';
    throw error;
  };
  const res = makeRes();
  await verifyIdHandler({ method: 'POST', headers: {}, body: { receipt_id: 'clrcpt_secret_error' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.status, 'RECEIPT_NOT_FOUND');
  assert.equal(JSON.stringify(res.body).includes('super-secret'), false);
});

test('GET /api/receipts/:id returns stored raw receipt JSON', async () => {
  const { receipt } = await makeStoredReceipt({ receiptId: 'clrcpt_raw' });
  mockClaimReceipt(receipt);
  const res = makeRes();
  await getReceiptHandler({ method: 'GET', query: { id: receipt.receipt_id } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, receipt);
});
