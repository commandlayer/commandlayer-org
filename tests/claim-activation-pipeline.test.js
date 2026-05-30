'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const db = require('../lib/db');
const submitClaim = require('../api/claim/commandlayer-namespace');
const verifyRecords = require('../api/claims/verify-signer-records');
const statusHandler = require('../api/claims/status');
const runPipeline = require('../api/admin/run-activation-pipeline');
const tenantProof = require('../api/claims/verify-tenant-proof');
const { signReceipt } = require('../lib/receiptSigning');

function makeRes() { return { statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, end() { return this; } }; }
function b64(bytes) { return Buffer.from(bytes).toString('base64'); }

const publicKey = `ed25519:${b64(Buffer.alloc(32, 7))}`;
const basePayload = {
  authenticatedAddress: '0x1111111111111111111111111111111111111111',
  tenant: 'acme',
  activationMode: 'managed_namespace',
  packId: 'trust',
  tenantSignerEns: 'acme.approveagent.eth',
  tenantSignerPublicKey: publicKey,
  tenantSignerKid: 'kid123',
  tenantSignerCanonicalization: 'json.sorted_keys.v1',
  agents: [{ ens: 'acme.approveagent.eth', capability: 'approve', canonicalParent: 'approveagent.eth', skill: 'trust-verification.approve', skillFamily: 'trust-verification', cardJson: { ens: 'acme.approveagent.eth' } }],
};

test('claim submission persists public signer fields and rejects private-key material', async () => {
  process.env.DATABASE_URL = 'postgres://example';
  const queries = [];
  db.query = async (q, params) => { queries.push({ q, params }); return { rows: [], rowCount: 1 }; };
  const res = makeRes();
  await submitClaim({ method: 'POST', body: basePayload }, res);
  assert.equal(res.statusCode, 202);
  const insert = queries.find((entry) => entry.q.includes('insert into claim_requests'));
  assert.ok(insert);
  assert.ok(insert.q.includes('tenant_signer_ens'));
  assert.ok(insert.q.includes('tenant_signer_public_key'));
  assert.ok(insert.q.includes('tenant_signer_kid'));
  assert.ok(insert.q.includes('tenant_signer_canonicalization'));
  assert.equal(insert.params.includes(publicKey), true);
  assert.equal(JSON.stringify(insert.params).includes('PRIVATE KEY'), false);

  const bad = makeRes();
  await submitClaim({ method: 'POST', body: { ...basePayload, privateKeyPem: '-----BEGIN PRIVATE KEY-----secret' } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'private_key_material_rejected');
});

test('ENS verification checks all four mainnet TXT records', async () => {
  const updates = [];
  db.query = async (q, params) => {
    if (q.includes('select claim_id')) return { rows: [{ claim_id: 'c1', tenant_signer_ens: 'acme.eth', tenant_signer_public_key: publicKey, tenant_signer_kid: 'kid123', tenant_signer_canonicalization: 'json.sorted_keys.v1' }] };
    updates.push({ q, params });
    return { rows: [], rowCount: 1 };
  };
  const calls = [];
  const req = { method: 'POST', body: { claim_id: 'c1' }, verifyOptions: {}, textResolver: null };
  req.verifyOptions = { textResolver: async () => null };
  // Endpoint reads req.verifyOptions through resolver options only when supplied to lib; monkey patch exported resolver via request is not used.
  const signerRecords = require('../lib/claims/signer-records');
  const old = signerRecords.resolveRequiredSignerRecords;
  signerRecords.resolveRequiredSignerRecords = async (name) => { calls.push(name); return { 'cl.sig.pub': publicKey, 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }; };
  delete require.cache[require.resolve('../api/claims/verify-signer-records')];
  const handler = require('../api/claims/verify-signer-records');
  const res = makeRes();
  await handler({ method: 'POST', body: { claim_id: 'c1' } }, res);
  signerRecords.resolveRequiredSignerRecords = old;
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'records_verified');
  assert.equal(res.body.network, 'ethereum-mainnet');
  assert.deepEqual(res.body.checks, { public_key_matches: true, kid_matches: true, canonicalization_matches: true, signer_matches: true });
  assert.ok(updates.some((u) => u.params.includes('records_verified')));
});

test('ENS record mismatch and missing record do not verify', async () => {
  const signerRecords = require('../lib/claims/signer-records');
  const old = signerRecords.resolveRequiredSignerRecords;
  delete require.cache[require.resolve('../api/claims/verify-signer-records')];
  db.query = async (q) => q.includes('select claim_id') ? { rows: [{ claim_id: 'c2', tenant_signer_ens: 'acme.eth', tenant_signer_public_key: publicKey, tenant_signer_kid: 'kid123', tenant_signer_canonicalization: 'json.sorted_keys.v1' }] } : { rows: [], rowCount: 1 };
  signerRecords.resolveRequiredSignerRecords = async () => ({ 'cl.sig.pub': 'ed25519:wrong', 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' });
  let handler = require('../api/claims/verify-signer-records');
  let res = makeRes();
  await handler({ method: 'POST', body: { claim_id: 'c2' } }, res);
  assert.equal(res.body.status, 'records_mismatch');

  delete require.cache[require.resolve('../api/claims/verify-signer-records')];
  signerRecords.resolveRequiredSignerRecords = async () => ({ 'cl.sig.pub': publicKey, 'cl.sig.kid': null, 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' });
  handler = require('../api/claims/verify-signer-records');
  res = makeRes();
  await handler({ method: 'POST', body: { claim_id: 'c2' } }, res);
  signerRecords.resolveRequiredSignerRecords = old;
  assert.equal(res.body.status, 'records_unavailable');
});

test('idempotent orchestration advances paid cards to pinned then genesis', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'jwt';
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'runtime-kid';
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
  global.fetch = async () => ({ ok: true, json: async () => ({ IpfsHash: 'bafycard' }) });
  let pinned = false;
  let genesis = false;
  db.query = async (q) => {
    if (q.includes('select * from claim_requests')) return { rows: [{ claim_id: 'c3', status: pinned ? 'cards_pinned' : 'paid', payment_status: 'paid', authenticated_address: '0x1', tenant_signer_record_status: 'records_verified', tenant_proof_status: 'not_submitted', genesis_receipt_id: genesis ? 'r1' : null }] };
    if (q.includes('select ens, card_cid') && q.includes('card_gateway_url') && q.includes('from agent_cards')) return { rows: [{ ens: 'a.eth', card_cid: 'bafycard', card_ipfs_uri: 'ipfs://bafycard', card_gateway_url: 'https://g/bafycard', card_sha256: 'h' }] };
    if (q.includes('select ens, card_cid') && q.includes('from agent_cards')) return { rows: pinned ? [{ ens: 'a.eth', card_cid: 'bafycard', card_ipfs_uri: 'ipfs://bafycard', card_sha256: 'h' }] : [{ ens: 'a.eth', card_cid: null, card_ipfs_uri: null, card_sha256: null }] };
    if (q.includes('select id, claim_id, ens, card_json')) return { rows: pinned ? [{ id: 'a1', ens: 'a.eth', card_json: { a: 1 }, card_cid: 'bafycard', card_ipfs_uri: 'ipfs://bafycard', card_sha256: 'h', status: 'published' }] : [{ id: 'a1', ens: 'a.eth', card_json: { a: 1 }, status: 'published' }] };
    if (q.includes('update claim_requests set status')) { pinned = true; return { rows: [], rowCount: 1 }; }
    if (q.includes('from agent_cards where claim_id') && q.includes('card_gateway_url')) return { rows: [{ ens: 'a.eth', card_cid: 'bafycard', card_ipfs_uri: 'ipfs://bafycard', card_gateway_url: 'https://g/bafycard', card_sha256: 'h' }] };
    if (q.includes('select ens, card_cid, card_ipfs_uri, card_gateway_url, card_sha256')) return { rows: [{ ens: 'a.eth', card_cid: 'bafycard', card_ipfs_uri: 'ipfs://bafycard', card_gateway_url: 'https://g/bafycard', card_sha256: 'h' }] };
    if (q.includes('set genesis_receipt_json')) { genesis = true; return { rows: [], rowCount: 1 }; }
    if (q.includes('from claim_requests where claim_id')) return { rows: [{ claim_id: 'c3', status: pinned ? 'cards_pinned' : 'paid' }] };
    return { rows: [], rowCount: 1 };
  };
  const res = makeRes();
  await runPipeline({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c3' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.steps.payment, 'already_paid');
  assert.equal(res.body.steps.agent_cards, 'cards_pinned');
  assert.equal(res.body.steps.genesis_receipt, 'generated');
});

test('claim status UI model displays paid pinned genesis accurately', async () => {
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c4', tenant: 'acme', activation_mode: 'bring_your_own_ens', status: 'cards_pinned', payment_status: 'paid', paid_at: new Date().toISOString(), tenant_signer_ens: 'acme.eth', tenant_signer_record_status: 'records_verified', genesis_receipt_id: 'gen1', tenant_proof_status: 'verified' }] };
    if (q.includes('from agent_cards')) return { rows: [{ ens: 'acme.eth', card_cid: 'cid', card_ipfs_uri: 'ipfs://cid', card_sha256: 'h' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await statusHandler({ method: 'GET', query: { claim_id: 'c4' } }, res);
  assert.equal(res.body.pipeline.payment, 'paid');
  assert.equal(res.body.pipeline.agent_cards, 'cards_pinned');
  assert.equal(res.body.pipeline.genesis_receipt, 'generated');
  assert.equal(res.body.pipeline.agent_live, 'live');
});

test('tenant proof only activates matching stored signer', async () => {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pubRaw = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const receipt = await signReceipt({ signer: 'proof.acme.eth', verb: 'approve', ts: new Date().toISOString(), subject: { ok: true } }, { signerId: 'proof.acme.eth', kid: 'kidp', privateKeyPem: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  db.query = async (q) => q.includes('select claim_id') ? { rows: [{ claim_id: 'c5', tenant_signer_ens: 'other.acme.eth' }] } : { rows: [], rowCount: 1 };
  const res = makeRes();
  await tenantProof({ method: 'POST', body: { claim_id: 'c5', receipt }, verifyOptions: { allowLocalFallback: false, textResolver: async (_name, key) => ({ 'cl.sig.pub': `ed25519:${pubRaw}`, 'cl.sig.kid': 'kidp', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'proof.acme.eth' }[key]) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'invalid');
});
