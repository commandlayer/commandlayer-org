'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const db = require('../lib/db');
const { verifyReceipt } = require('../lib/verifyReceipt');
const { canonicalize, canonicalReceiptPayload, sha256Hex } = require('../lib/receiptSigning');
const {
  buildTenantSignerRecordPackage,
  checkTenantSignerEnsRecords,
} = require('../lib/tenantSignerIdentity');
const tenantSignerHandler = require('../api/admin/tenant-signer-identity');

const subtle = webcrypto.subtle;

async function makeSignedReceipt(signer, kid, keyPair, receiptOverrides = {}) {
  const receipt = {
    receipt_type: 'action',
    signer,
    issuer_role: 'tenant_agent',
    verb: 'approve',
    input: { request_id: 'demo_request_001' },
    output: { decision: 'approved' },
    execution: { status: 'ok' },
    ts: '2026-05-29T00:00:00.000Z',
    ...receiptOverrides,
  };
  const hashHex = await sha256Hex(canonicalize(canonicalReceiptPayload(receipt)));
  const sigBytes = await subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, new TextEncoder().encode(hashHex));
  receipt.metadata = {
    proof: {
      canonicalization: 'json.sorted_keys.v1',
      hash: { alg: 'SHA-256', value: hashHex },
      signature: { alg: 'Ed25519', kid, value: Buffer.from(sigBytes).toString('base64'), role: 'tenant_agent' },
      signer_id: signer,
    },
  };
  return receipt;
}

async function makeKeyFixture(signer, kid) {
  const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = Buffer.from(await subtle.exportKey('raw', keyPair.publicKey)).toString('base64');
  const receipt = await makeSignedReceipt(signer, kid, keyPair);
  const records = buildTenantSignerRecordPackage({ agent_ens_name: signer, tenant_signer_kid: kid, tenant_signer_public_key: publicKey }).txt_records;
  return { signer, kid, keyPair, publicKey, receipt, records };
}

function resolverFor(recordsByName) {
  return async (name, key) => recordsByName[name]?.[key] || null;
}

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

test('runtime and tenant receipts verify against their own ENS TXT identities', async () => {
  const runtime = await makeKeyFixture('runtime.commandlayer.eth', 'runtime-kid');
  runtime.receipt.issuer_role = undefined;
  runtime.receipt.receipt_type = undefined;
  runtime.receipt.metadata.proof.signature.role = 'runtime';
  runtime.receipt.metadata.proof.hash.value = await sha256Hex(canonicalize(canonicalReceiptPayload(runtime.receipt)));
  runtime.receipt.metadata.proof.signature.value = Buffer.from(await subtle.sign({ name: 'Ed25519' }, runtime.keyPair.privateKey, new TextEncoder().encode(runtime.receipt.metadata.proof.hash.value))).toString('base64');

  const tenant = await makeKeyFixture('acme.approveagent.eth', 'tenant-kid');
  const textResolver = resolverFor({
    'runtime.commandlayer.eth': runtime.records,
    'acme.approveagent.eth': tenant.records,
  });

  const runtimeOut = await verifyReceipt(runtime.receipt, { ens: { textResolver, allowLocalFallback: false } });
  assert.equal(runtimeOut.status, 'VERIFIED');
  assert.equal(runtimeOut.signer, 'runtime.commandlayer.eth');
  assert.equal(runtimeOut.public_key_source, 'ens_txt');
  assert.equal(runtimeOut.ens_resolved, true);
  assert.equal(runtimeOut.hash_matches, true);
  assert.equal(runtimeOut.signature_valid, true);
  assert.equal(runtimeOut.key_id, 'runtime-kid');

  const tenantOut = await verifyReceipt(tenant.receipt, { ens: { textResolver, allowLocalFallback: false } });
  assert.equal(tenantOut.status, 'VERIFIED');
  assert.equal(tenantOut.signer, 'acme.approveagent.eth');
  assert.equal(tenantOut.public_key_source, 'ens_txt');
  assert.equal(tenantOut.ens_resolved, true);
  assert.equal(tenantOut.hash_matches, true);
  assert.equal(tenantOut.signature_valid, true);
  assert.equal(tenantOut.key_id, 'tenant-kid');
});

test('tenant receipt fails against runtime records and mismatched tenant ENS metadata', async () => {
  const runtime = await makeKeyFixture('runtime.commandlayer.eth', 'runtime-kid');
  const tenant = await makeKeyFixture('acme.approveagent.eth', 'tenant-kid');

  const runtimeRecordsAtTenantName = { ...runtime.records, 'cl.receipt.signer': 'acme.approveagent.eth' };
  const wrongRuntimeOut = await verifyReceipt(tenant.receipt, {
    ens: { textResolver: resolverFor({ 'acme.approveagent.eth': runtimeRecordsAtTenantName }), allowLocalFallback: false },
  });
  assert.equal(wrongRuntimeOut.status, 'INVALID');
  assert.equal(wrongRuntimeOut.signature_valid, false);

  const kidMismatch = { ...tenant.records, 'cl.sig.kid': 'other-kid' };
  const kidOut = await verifyReceipt(tenant.receipt, {
    ens: { textResolver: resolverFor({ 'acme.approveagent.eth': kidMismatch }), allowLocalFallback: false },
  });
  assert.equal(kidOut.status, 'INVALID');
  assert.equal(kidOut.debug.key_id_matched, false);

  const otherKey = await makeKeyFixture('acme.approveagent.eth', 'tenant-kid');
  const pubMismatch = { ...tenant.records, 'cl.sig.pub': `ed25519:${otherKey.publicKey}` };
  const pubOut = await verifyReceipt(tenant.receipt, {
    ens: { textResolver: resolverFor({ 'acme.approveagent.eth': pubMismatch }), allowLocalFallback: false },
  });
  assert.equal(pubOut.status, 'INVALID');
  assert.equal(pubOut.signature_valid, false);
});

test('tenant signer record package has four TXT records and stays pending until ENS matches', async () => {
  const tenant = await makeKeyFixture('acme.approveagent.eth', 'tenant-kid');
  const recordPackage = buildTenantSignerRecordPackage({ agent_ens_name: tenant.signer, tenant_signer_kid: tenant.kid, tenant_signer_public_key: tenant.publicKey });
  assert.deepEqual(Object.keys(recordPackage.txt_records).sort(), ['cl.receipt.signer', 'cl.sig.canonical', 'cl.sig.kid', 'cl.sig.pub']);
  assert.equal(recordPackage.txt_record_lines.includes(`cl.receipt.signer=${tenant.signer}`), true);

  const pending = await checkTenantSignerEnsRecords(recordPackage, { textResolver: async () => null, allowLocalFallback: false });
  assert.equal(pending.status, 'records_pending');
  assert.equal(pending.ok, false);

  const verified = await checkTenantSignerEnsRecords(recordPackage, { textResolver: resolverFor({ [tenant.signer]: tenant.records }), allowLocalFallback: false });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.ok, true);
});

test('admin tenant signer API never exposes tenant private key fields', async () => {
  process.env.ADMIN_API_KEY = 'k';
  const tenant = await makeKeyFixture('acme.approveagent.eth', 'tenant-kid');
  const queries = [];
  db.query = async (query, params) => {
    queries.push({ query, params });
    if (query.includes('from claim_agents')) return { rows: [{ claim_id: 'c1', ens: tenant.signer, status: 'published' }] };
    if (query.includes('update claim_agents')) return { rows: [{ claim_id: 'c1', ens: tenant.signer, agent_ens_name: tenant.signer, tenant_signer_kid: tenant.kid, tenant_signer_public_key: tenant.publicKey, tenant_signer_canonicalization: 'json.sorted_keys.v1', tenant_signer_status: 'records_pending', tenant_signer_created_at: '2026-05-29T00:00:00.000Z' }] };
    return { rows: [] };
  };

  const res = makeRes();
  await tenantSignerHandler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c1', action: 'upsert', agentEnsName: tenant.signer, tenantSignerPublicKey: tenant.publicKey, tenantPrivateKey: 'must-not-return' } }, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.stringify(res.body);
  assert.equal(body.includes('tenantPrivateKey'), false);
  assert.equal(body.includes('private'), false);
  assert.equal(body.includes('must-not-return'), false);
  assert.equal(queries.some((entry) => JSON.stringify(entry.params).includes('must-not-return')), false);
});
