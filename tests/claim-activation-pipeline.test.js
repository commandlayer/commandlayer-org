'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../lib/db');
const submitClaim = require('../api/claim/commandlayer-namespace');
const statusHandler = require('../api/claims/status');
const runPipeline = require('../api/admin/run-activation-pipeline');
const tenantProof = require('../api/claims/verify-tenant-proof');
const adminClaim = require('../api/admin/claim');
const { hashClaimAccessToken } = require('../lib/claims/access-token');
const { resetRateLimitForTests } = require('../lib/rateLimit');
const { signReceipt } = require('../lib/receiptSigning');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
}
function b64(bytes) { return Buffer.from(bytes).toString('base64'); }

const publicKey = `ed25519:${b64(Buffer.alloc(32, 7))}`;
const claimToken = 'claim-token-secret';
const claimTokenHash = hashClaimAccessToken(claimToken);
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

function signerClaim(overrides = {}) {
  return {
    claim_id: 'c1',
    claim_access_token_hash: claimTokenHash,
    tenant_signer_ens: 'acme.eth',
    tenant_signer_public_key: publicKey,
    tenant_signer_kid: 'kid123',
    tenant_signer_canonicalization: 'json.sorted_keys.v1',
    tenant_signer_record_status: 'records_pending',
    ...overrides,
  };
}

function loadVerifyRecordsWithResolver(resolver) {
  const signerRecords = require('../lib/claims/signer-records');
  const old = signerRecords.resolveRequiredSignerRecords;
  signerRecords.resolveRequiredSignerRecords = resolver;
  delete require.cache[require.resolve('../api/claims/verify-signer-records')];
  const handler = require('../api/claims/verify-signer-records');
  return { handler, restore: () => { signerRecords.resolveRequiredSignerRecords = old; delete require.cache[require.resolve('../api/claims/verify-signer-records')]; } };
}


test('claim page provides private recovery-key download/import without adding token to copied response', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'claim.html'), 'utf8');
  assert.ok(html.includes('Download Claim Recovery Key'));
  assert.ok(html.includes('Import Claim Recovery Key'));
  assert.ok(html.includes("type: 'commandlayer_claim_recovery_key'"));
  assert.ok(html.includes('claim_id: result.claimId'));
  assert.ok(html.includes('claim_access_token: result.claimAccessToken'));
  assert.ok(html.includes('tenant_signer_ens: result.tenantSignerEns'));
  assert.ok(html.includes("warning: 'Keep this file private. Anyone with this key can access and continue this claim activation.'"));
  assert.ok(html.includes('sessionStorage.setItem(claimAccessTokenStorageKey(claimId), token)'));
  assert.ok(html.includes('delete copy.claimAccessToken'));
  assert.ok(html.includes('delete copy.claim_access_token'));
});

test('claim submission returns raw access token once and persists only hash/public signer fields', async () => {
  resetRateLimitForTests();
  process.env.DATABASE_URL = 'postgres://example';
  const queries = [];
  db.query = async (q, params) => { queries.push({ q, params }); return { rows: [], rowCount: 1 }; };
  const res = makeRes();
  await submitClaim({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.10' }, body: basePayload }, res);
  assert.equal(res.statusCode, 202);
  assert.ok(res.body.claimAccessToken);
  const tokenHash = hashClaimAccessToken(res.body.claimAccessToken);
  const insert = queries.find((entry) => entry.q.includes('insert into claim_requests'));
  assert.ok(insert);
  assert.ok(insert.q.includes('claim_access_token_hash'));
  assert.equal(insert.params.includes(tokenHash), true);
  assert.equal(JSON.stringify(insert.params).includes(res.body.claimAccessToken), false);
  assert.equal(JSON.stringify(insert.params).includes('PRIVATE KEY'), false);
  assert.ok(insert.q.includes('tenant_signer_ens'));
  assert.ok(insert.q.includes('tenant_signer_public_key'));
  assert.equal(insert.params.includes(publicKey), true);

  const bad = makeRes();
  await submitClaim({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.11' }, body: { ...basePayload, privateKeyPem: '-----BEGIN PRIVATE KEY-----secret' } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'private_key_material_rejected');
});

test('raw claim access token is not exposed in status or admin responses', async () => {
  process.env.ADMIN_API_KEY = 'admin';
  db.query = async (q) => {
    if (q.includes('select * from claim_requests')) return { rows: [{ claim_id: 'csecret', claim_access_token_hash: claimTokenHash, tenant: 'acme' }] };
    if (q.includes('select claim_id, claim_access_token_hash')) return { rows: [{ claim_id: 'csecret', claim_access_token_hash: claimTokenHash, tenant: 'acme', activation_mode: 'managed_namespace', status: 'created', payment_status: 'unpaid', tenant_signer_ens: 'acme.eth', tenant_signer_record_status: 'records_pending', tenant_proof_status: 'not_submitted' }] };
    if (q.includes('from claim_agents') || q.includes('from claim_events') || q.includes('to_regclass') || q.includes('from agent_cards') || q.includes('from claim_payments')) return { rows: [] };
    return { rows: [] };
  };
  const statusRes = makeRes();
  await statusHandler({ method: 'GET', headers: { 'x-claim-access-token': claimToken }, query: { claim_id: 'csecret' } }, statusRes);
  assert.equal(statusRes.statusCode, 200);
  assert.equal(JSON.stringify(statusRes.body).includes(claimToken), false);
  assert.equal(JSON.stringify(statusRes.body).includes(claimTokenHash), false);

  const adminRes = makeRes();
  await adminClaim({ method: 'GET', headers: { 'x-admin-api-key': 'admin' }, query: { claimId: 'csecret' } }, adminRes);
  assert.equal(adminRes.statusCode, 200);
  assert.equal(JSON.stringify(adminRes.body).includes(claimToken), false);
  assert.equal(JSON.stringify(adminRes.body).includes(claimTokenHash), false);
});

test('verify-signer-records rejects missing or incorrect public claim tokens', async () => {
  resetRateLimitForTests();
  db.query = async (q) => q.includes('select claim_id') ? { rows: [signerClaim()] } : { rows: [], rowCount: 1 };
  const { handler, restore } = loadVerifyRecordsWithResolver(async () => ({ 'cl.sig.pub': publicKey, 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }));
  const missing = makeRes();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.1' }, body: { claim_id: 'c1' } }, missing);
  assert.equal(missing.statusCode, 401);
  const wrong = makeRes();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.2', 'x-claim-access-token': 'wrong' }, body: { claim_id: 'c1' } }, wrong);
  restore();
  assert.equal(wrong.statusCode, 401);
});

test('admin-authenticated signer-record verification still works', async () => {
  resetRateLimitForTests();
  process.env.ADMIN_API_KEY = 'admin';
  const updates = [];
  db.query = async (q, params) => {
    if (q.includes('select claim_id')) return { rows: [signerClaim()] };
    updates.push({ q, params });
    return { rows: [], rowCount: 1 };
  };
  const { handler, restore } = loadVerifyRecordsWithResolver(async () => ({ 'cl.sig.pub': publicKey, 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }));
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'admin', 'x-forwarded-for': '203.0.113.3' }, body: { claim_id: 'c1' } }, res);
  restore();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'records_verified');
  assert.equal(res.body.network, 'ethereum-mainnet');
  assert.deepEqual(res.body.checks, { public_key_matches: true, kid_matches: true, canonicalization_matches: true, signer_matches: true });
  assert.ok(updates.some((u) => u.params.includes('records_verified')));
});

test('public signer-record verification checks mismatch/missing but cannot downgrade records_verified', async () => {
  resetRateLimitForTests();
  const updates = [];
  db.query = async (q, params) => {
    if (q.includes('select claim_id')) return { rows: [signerClaim({ tenant_signer_record_status: 'records_verified' })] };
    updates.push({ q, params });
    return { rows: [], rowCount: 1 };
  };
  let loaded = loadVerifyRecordsWithResolver(async () => ({ 'cl.sig.pub': 'ed25519:wrong', 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }));
  let res = makeRes();
  await loaded.handler({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '203.0.113.4' }, body: { claim_id: 'c1' } }, res);
  loaded.restore();
  assert.equal(res.body.status, 'records_verified');
  assert.equal(res.body.attempt_status, 'records_mismatch');
  assert.equal(updates.length, 0);

  loaded = loadVerifyRecordsWithResolver(async () => ({ 'cl.sig.pub': publicKey, 'cl.sig.kid': null, 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }));
  res = makeRes();
  await loaded.handler({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '203.0.113.5' }, body: { claim_id: 'c1' } }, res);
  loaded.restore();
  assert.equal(res.body.status, 'records_verified');
  assert.equal(res.body.attempt_status, 'records_unavailable');
  assert.equal(updates.length, 0);
});

test('valid public signer-record verification with token reaches records_verified', async () => {
  resetRateLimitForTests();
  const updates = [];
  db.query = async (q, params) => {
    if (q.includes('select claim_id')) return { rows: [signerClaim()] };
    updates.push({ q, params });
    return { rows: [], rowCount: 1 };
  };
  const { handler, restore } = loadVerifyRecordsWithResolver(async () => ({ 'cl.sig.pub': publicKey, 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }));
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '203.0.113.6' }, body: { claim_id: 'c1' } }, res);
  restore();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'records_verified');
  assert.ok(updates.some((u) => u.params.includes('records_verified')));
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

test('claim status UI model displays paid pinned genesis accurately with claim token', async () => {
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c4', claim_access_token_hash: claimTokenHash, tenant: 'acme', activation_mode: 'bring_your_own_ens', status: 'cards_pinned', payment_status: 'paid', paid_at: new Date().toISOString(), tenant_signer_ens: 'acme.eth', tenant_signer_record_status: 'records_verified', genesis_receipt_id: 'gen1', tenant_proof_status: 'verified' }] };
    if (q.includes('from agent_cards')) return { rows: [{ ens: 'acme.eth', card_cid: 'cid', card_ipfs_uri: 'ipfs://cid', card_sha256: 'h' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await statusHandler({ method: 'GET', headers: { 'x-claim-access-token': claimToken }, query: { claim_id: 'c4' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pipeline.payment, 'paid');
  assert.equal(res.body.pipeline.agent_cards, 'cards_pinned');
  assert.equal(res.body.pipeline.genesis_receipt, 'generated');
  assert.equal(res.body.pipeline.agent_live, 'live');
  assert.equal(JSON.stringify(res.body).includes(claimTokenHash), false);
});

async function makeTenantReceipt(signer = 'proof.acme.eth') {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pubRaw = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const receipt = await signReceipt({ signer, verb: 'approve', ts: new Date().toISOString(), subject: { ok: true } }, { signerId: signer, kid: 'kidp', privateKeyPem: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const textResolver = async (_name, key) => ({ 'cl.sig.pub': `ed25519:${pubRaw}`, 'cl.sig.kid': 'kidp', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': signer }[key]);
  return { receipt, textResolver };
}

test('verify-tenant-proof rejects missing or incorrect public claim tokens', async () => {
  resetRateLimitForTests();
  const { receipt, textResolver } = await makeTenantReceipt();
  db.query = async (q) => q.includes('select claim_id') ? { rows: [{ claim_id: 'c5', claim_access_token_hash: claimTokenHash, tenant_signer_ens: 'proof.acme.eth', tenant_proof_status: 'not_submitted' }] } : { rows: [], rowCount: 1 };
  let res = makeRes();
  await tenantProof({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7' }, body: { claim_id: 'c5', receipt }, verifyOptions: { ens: { allowLocalFallback: false, textResolver } } }, res);
  assert.equal(res.statusCode, 401);
  res = makeRes();
  await tenantProof({ method: 'POST', headers: { 'x-claim-access-token': 'wrong', 'x-forwarded-for': '203.0.113.8' }, body: { claim_id: 'c5', receipt }, verifyOptions: { ens: { allowLocalFallback: false, textResolver } } }, res);
  assert.equal(res.statusCode, 401);
});

test('admin-authenticated tenant-proof verification still works', async () => {
  resetRateLimitForTests();
  process.env.ADMIN_API_KEY = 'admin';
  const { receipt, textResolver } = await makeTenantReceipt();
  let updated = false;
  db.query = async (q) => {
    if (q.includes('select claim_id')) return { rows: [{ claim_id: 'c6', claim_access_token_hash: claimTokenHash, tenant_signer_ens: 'proof.acme.eth', tenant_proof_status: 'not_submitted' }] };
    if (q.includes('update claim_requests')) updated = true;
    return { rows: [], rowCount: 1 };
  };
  const res = makeRes();
  await tenantProof({ method: 'POST', headers: { 'x-admin-api-key': 'admin', 'x-forwarded-for': '203.0.113.9' }, body: { claim_id: 'c6', receipt }, verifyOptions: { ens: { allowLocalFallback: false, textResolver } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'verified');
  assert.equal(updated, true);
});

test('valid same-signer tenant proof with valid token reaches verified', async () => {
  resetRateLimitForTests();
  const { receipt, textResolver } = await makeTenantReceipt();
  let updatedParams = null;
  db.query = async (q, params) => {
    if (q.includes('select claim_id')) return { rows: [{ claim_id: 'c7', claim_access_token_hash: claimTokenHash, tenant_signer_ens: 'proof.acme.eth', tenant_proof_status: 'not_submitted' }] };
    if (q.includes('update claim_requests')) updatedParams = params;
    return { rows: [], rowCount: 1 };
  };
  const res = makeRes();
  await tenantProof({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '203.0.113.10' }, body: { claim_id: 'c7', receipt }, verifyOptions: { ens: { allowLocalFallback: false, textResolver } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'verified');
  assert.ok(updatedParams.includes('verified'));
});

test('later invalid tenant proof cannot downgrade tenant_proof_status verified', async () => {
  resetRateLimitForTests();
  const { receipt, textResolver } = await makeTenantReceipt('other.acme.eth');
  let updateCount = 0;
  db.query = async (q) => {
    if (q.includes('select claim_id')) return { rows: [{ claim_id: 'c8', claim_access_token_hash: claimTokenHash, tenant_signer_ens: 'proof.acme.eth', tenant_proof_status: 'verified' }] };
    if (q.includes('update claim_requests')) updateCount += 1;
    return { rows: [], rowCount: 1 };
  };
  const res = makeRes();
  await tenantProof({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '203.0.113.11' }, body: { claim_id: 'c8', receipt }, verifyOptions: { ens: { allowLocalFallback: false, textResolver } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'verified');
  assert.equal(res.body.attempt_status, 'invalid');
  assert.equal(updateCount, 0);
});

test('public mutation endpoints have rate-limiting protection', async () => {
  resetRateLimitForTests();
  db.query = async (q) => q.includes('select claim_id') ? { rows: [signerClaim()] } : { rows: [], rowCount: 1 };

  let intake = null;
  for (let i = 0; i < 21; i += 1) {
    intake = makeRes();
    await submitClaim({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.199' }, body: basePayload }, intake);
  }
  assert.equal(intake.statusCode, 429);
  assert.equal(intake.body.status, 'RATE_LIMITED');

  const { handler, restore } = loadVerifyRecordsWithResolver(async () => ({ 'cl.sig.pub': publicKey, 'cl.sig.kid': 'kid123', 'cl.sig.canonical': 'json.sorted_keys.v1', 'cl.receipt.signer': 'acme.eth' }));
  let signer = null;
  for (let i = 0; i < 61; i += 1) {
    signer = makeRes();
    await handler({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '198.51.100.200' }, body: { claim_id: 'c1' } }, signer);
  }
  restore();
  assert.equal(signer.statusCode, 429);
  assert.equal(signer.body.status, 'RATE_LIMITED');

  const { receipt, textResolver } = await makeTenantReceipt();
  let proof = null;
  for (let i = 0; i < 31; i += 1) {
    proof = makeRes();
    await tenantProof({ method: 'POST', headers: { 'x-claim-access-token': claimToken, 'x-forwarded-for': '198.51.100.201' }, body: { claim_id: 'c9', receipt }, verifyOptions: { ens: { allowLocalFallback: false, textResolver } } }, proof);
  }
  assert.equal(proof.statusCode, 429);
  assert.equal(proof.body.status, 'RATE_LIMITED');
});
