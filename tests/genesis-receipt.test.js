'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createGenesisReceipt } = require('../lib/receipts/create-genesis-receipt');

const { privateKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('creates genesis receipt with deterministic hash and chain root', async () => {
  const base = {
    claimId: 'c1', label: 'verifyagent', namespace: 'eth', owner: '0x123', verbs: ['verify', 'attest'],
    agentCardHash: 'abc123', agentCardCid: 'ipfs://bafy', signerId: 'runtime.commandlayer.eth', kid: 'kid1', privateKeyPem,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
  const a = await createGenesisReceipt(base);
  const b = await createGenesisReceipt(base);
  assert.equal(a.receipt.receipt_type, 'genesis');
  assert.equal(a.receipt.chain_index, 0);
  assert.equal(a.receipt.previous_receipt_hash, null);
  assert.equal(a.receipt.parent_receipt_id, null);
  assert.equal(a.chainRoot, `sha256:${a.receiptHash}`);
  assert.equal(a.receiptHash, b.receiptHash);
});

test('missing signing env throws signing unavailable', async () => {
  await assert.rejects(
    createGenesisReceipt({ claimId: 'x', label: 'a', namespace: 'eth', owner: '0x1', verbs: ['verify'] }),
    (error) => error && error.code === 'SIGNING_UNAVAILABLE'
  );
});
