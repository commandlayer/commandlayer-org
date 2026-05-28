'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  resolveReceiptSigningConfigFromEnv,
  hasValidSigningConfig,
  signReceipt,
} = require('../lib/receiptSigning');

const originalEnv = { ...process.env };

function stripPemHeaders(pem) {
  return String(pem)
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
}

test.beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.RECEIPT_SIGNER_ID;
  delete process.env.RECEIPT_SIGNING_KID;
  delete process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64;
});

test.after(() => {
  process.env = originalEnv;
});

test('supports existing RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 style (base64 PEM with literal \\n)', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pemWithEscapedNewlines = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');

  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'kid-existing-style';
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 = Buffer.from(pemWithEscapedNewlines, 'utf8').toString('base64');

  const cfg = resolveReceiptSigningConfigFromEnv();
  assert.equal(hasValidSigningConfig(cfg), true);
  assert.match(cfg.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.match(cfg.privateKeyPem, /END PRIVATE KEY/);
});

test('supports base64(full PEM) and raw PEM body in RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const fullPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pemBody = stripPemHeaders(fullPem);

  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'kid-normalization';

  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 = Buffer.from(fullPem, 'utf8').toString('base64');
  let cfg = resolveReceiptSigningConfigFromEnv();
  assert.equal(hasValidSigningConfig(cfg), true);
  let signed = await signReceipt({ signer: cfg.signerId, verb: 'observe', input: {}, output: {}, execution: {}, ts: new Date().toISOString() }, cfg);
  assert.equal(signed.metadata.proof.signature.alg, 'Ed25519');

  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 = pemBody;
  cfg = resolveReceiptSigningConfigFromEnv();
  assert.equal(hasValidSigningConfig(cfg), true);
  signed = await signReceipt({ signer: cfg.signerId, verb: 'observe', input: {}, output: {}, execution: {}, ts: new Date().toISOString() }, cfg);
  assert.equal(signed.metadata.proof.signature.alg, 'Ed25519');
});


test('invalid key returns signing_unavailable-safe path (sign fails without crash)', async () => {
  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'kid-invalid';
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 = Buffer.from('not a valid private key', 'utf8').toString('base64');

  const cfg = resolveReceiptSigningConfigFromEnv();
  assert.equal(hasValidSigningConfig(cfg), true);

  await assert.rejects(
    signReceipt({ signer: cfg.signerId, verb: 'observe', input: {}, output: {}, execution: {}, ts: new Date().toISOString() }, cfg),
  );
});

test('signReceipt preserves optional receipt chain fields without requiring continuity', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'kid-chain-fields';
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8').toString('base64');

  const cfg = resolveReceiptSigningConfigFromEnv();
  const signed = await signReceipt({
    signer: cfg.signerId,
    verb: 'observe',
    input: {},
    output: {},
    execution: {},
    ts: '2026-05-28T00:00:00.000Z',
    chain_root: null,
    previous_receipt_hash: null,
    chain_index: null,
    parent_receipt_id: 'cl_genesis_c1',
  }, cfg);

  assert.equal(signed.chain_root, null);
  assert.equal(signed.previous_receipt_hash, null);
  assert.equal(signed.chain_index, null);
  assert.equal(signed.parent_receipt_id, 'cl_genesis_c1');
  assert.equal(signed.metadata.proof.signature.alg, 'Ed25519');
});
