'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const db = require('../lib/db');
const handler = require('../api/admin/generate-genesis-receipt');

function makeRes() { return { statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } }; }

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('requires cards_pinned and complete pinned fields', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'kid';
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM = pem;
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c1', status: 'paid' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c1' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'GENESIS_REQUIRES_CARDS_PINNED');
});

test('rejects partial pinned cards and prevents duplicates', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.RECEIPT_SIGNER_ID = 'runtime.commandlayer.eth';
  process.env.RECEIPT_SIGNING_KID = 'kid';
  process.env.RECEIPT_SIGNING_PRIVATE_KEY_PEM = pem;
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c2', status: 'cards_pinned', authenticated_address: '0x1', genesis_receipt_id: 'cl_genesis_c2' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c2' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.status, 'GENESIS_RECEIPT_ALREADY_EXISTS');

  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c3', status: 'cards_pinned', authenticated_address: '0x1' }] };
    if (q.includes('from agent_cards')) return { rows: [{ ens: 'a.eth', card_cid: 'cid', card_ipfs_uri: null, card_gateway_url: 'g', card_sha256: 'h' }] };
    return { rows: [] };
  };
  const res2 = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c3', force: true } }, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.status, 'GENESIS_REQUIRES_PINNED_CARDS');
});
