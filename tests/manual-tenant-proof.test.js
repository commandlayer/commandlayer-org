'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifyReceipt } = require('../lib/verifyReceipt');
const {
  generateKeyPackage,
  signTenantReceipt,
  formatEnsRecords,
  ENS_RECORDS_FILE,
  SIGNED_RECEIPT_FILE,
} = require('../scripts/manual-tenant-proof.cjs');

const TENANT_SIGNER = 'proof.approveagent.eth';
const FIXED_NOW = new Date('2026-05-29T00:00:00.000Z');

function makeTempOutputRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'commandlayer-tenant-proof-'));
}

async function makeSignedProof() {
  const outputRoot = makeTempOutputRoot();
  const generated = generateKeyPackage({ signer: TENANT_SIGNER, outputRoot, env: {} });
  const signed = await signTenantReceipt({ signer: TENANT_SIGNER, outputRoot, now: FIXED_NOW });
  return { outputRoot, generated, signed };
}

function makeTextResolver(records) {
  return async (_name, key) => records[key] || null;
}

test('generated ENS record package includes all four exact required records', () => {
  const outputRoot = makeTempOutputRoot();
  const generated = generateKeyPackage({ signer: TENANT_SIGNER, outputRoot, env: {} });
  const ensRecordsPath = path.join(generated.outDir, ENS_RECORDS_FILE);
  const ensRecordsText = fs.readFileSync(ensRecordsPath, 'utf8');

  assert.equal(ensRecordsText, `${formatEnsRecords(generated.records)}\n`);
  assert.deepEqual(Object.keys(generated.records), [
    'cl.sig.pub',
    'cl.sig.kid',
    'cl.sig.canonical',
    'cl.receipt.signer',
  ]);
  assert.match(ensRecordsText, /^cl\.sig\.pub=ed25519:[A-Za-z0-9+/=]+$/m);
  assert.match(ensRecordsText, /^cl\.sig\.kid=.+$/m);
  assert.match(ensRecordsText, /^cl\.sig\.canonical=json\.sorted_keys\.v1$/m);
  assert.match(ensRecordsText, new RegExp(`^cl\\.receipt\\.signer=${TENANT_SIGNER}$`, 'm'));
});

test('signed receipt uses configured tenant ENS signer and tenant proof metadata', async () => {
  const { generated, signed } = await makeSignedProof();
  const receipt = signed.signedReceipt;

  assert.equal(receipt.signer, TENANT_SIGNER);
  assert.equal(receipt.metadata.proof.signer_id, TENANT_SIGNER);
  assert.equal(receipt.metadata.proof.signature.kid, generated.kid);
  assert.equal(receipt.metadata.proof.canonicalization, 'json.sorted_keys.v1');
  assert.equal(receipt.metadata.proof.signature.role, undefined);
  assert.equal(receipt.verb, 'approve');
});

test('signed receipt verifies through existing verifyReceipt with tenant ENS TXT fixture', async () => {
  const { generated, signed } = await makeSignedProof();
  const out = await verifyReceipt(signed.signedReceipt, {
    ens: { textResolver: makeTextResolver(generated.records), allowLocalFallback: false },
  });

  assert.equal(out.status, 'VERIFIED');
  assert.equal(out.signer, TENANT_SIGNER);
  assert.equal(out.public_key_source, 'ens_txt');
  assert.equal(out.ens_resolved, true);
  assert.equal(out.hash_matches, true);
  assert.equal(out.signature_valid, true);
  assert.equal(out.key_id, generated.kid);
});

test('mismatched signer returns INVALID', async () => {
  const { generated, signed } = await makeSignedProof();
  const tampered = structuredClone(signed.signedReceipt);
  tampered.signer = 'runtime.commandlayer.eth';

  const out = await verifyReceipt(tampered, {
    ens: { textResolver: makeTextResolver(generated.records), allowLocalFallback: false },
  });

  assert.equal(out.status, 'INVALID');
});

test('mismatched kid returns INVALID', async () => {
  const { generated, signed } = await makeSignedProof();
  const tampered = structuredClone(signed.signedReceipt);
  tampered.metadata.proof.signature.kid = 'wrong-kid';

  const out = await verifyReceipt(tampered, {
    ens: { textResolver: makeTextResolver(generated.records), allowLocalFallback: false },
  });

  assert.equal(out.status, 'INVALID');
  assert.equal(out.debug.key_id_matched, false);
});

test('generated signed receipt output never includes private key material', async () => {
  const { signed } = await makeSignedProof();
  const receiptJson = JSON.stringify(signed.signedReceipt, null, 2);
  const writtenReceipt = fs.readFileSync(signed.signedReceiptPath, 'utf8');

  assert.doesNotMatch(receiptJson, /BEGIN PRIVATE KEY|END PRIVATE KEY|PRIVATE KEY/i);
  assert.doesNotMatch(writtenReceipt, /BEGIN PRIVATE KEY|END PRIVATE KEY|PRIVATE KEY/i);
  assert.equal(path.basename(signed.signedReceiptPath), SIGNED_RECEIPT_FILE);
});
