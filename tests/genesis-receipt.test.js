'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createGenesisReceipt } = require('../lib/receipts/create-genesis-receipt');
const { verifyReceipt } = require('../lib/verifyReceipt');
const { canonicalize, canonicalReceiptPayload, sha256Hex } = require('../lib/receiptSigning');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

function baseInput(overrides = {}) {
  return {
    claimId: 'c1',
    label: 'verifyagent',
    namespace: 'eth',
    owner: '0x123',
    verbs: ['verify', 'attest'],
    agentCardHash: 'abc123',
    agentCardCid: 'ipfs://bafy',
    signerId: 'runtime.commandlayer.eth',
    kid: 'kid1',
    privateKeyPem,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function verifyOptions() {
  return {
    ens: {
      textResolver: async (_ens, key) => ({
        'cl.sig.pub': `ed25519:${rawPub}`,
        'cl.sig.kid': 'kid1',
        'cl.sig.canonical': 'json.sorted_keys.v1',
        'cl.receipt.signer': 'runtime.commandlayer.eth',
      })[key] || null,
    },
  };
}

test('creates genesis receipt with deterministic hash and non-circular chain root', async () => {
  const a = await createGenesisReceipt(baseInput());
  const b = await createGenesisReceipt(baseInput());
  assert.equal(a.receipt.receipt_type, 'genesis');
  assert.equal(a.receipt.chain_index, 0);
  assert.equal(a.receipt.previous_receipt_hash, null);
  assert.equal(a.receipt.parent_receipt_id, null);
  assert.equal(a.receipt.chain_root, a.receiptChainRoot);
  assert.equal(a.receiptHash, b.receiptHash);
  assert.equal(a.chainRoot, b.chainRoot);
  assert.notEqual(a.chainRoot, `sha256:${a.receiptHash}`);

  const anchorHash = await sha256Hex(canonicalize(canonicalReceiptPayload(a.receipt, { excludeChainRoot: true })));
  assert.equal(a.chainRoot, `sha256:${anchorHash}`);
  assert.equal(a.receipt.metadata.proof.hash.value, a.receiptHash);
});

test('generated genesis receipt verifies through verifyReceipt as VERIFIED', async () => {
  const { receipt } = await createGenesisReceipt(baseInput({ receiptId: 'cl_genesis_verify_now' }));
  const out = await verifyReceipt(receipt, verifyOptions());
  assert.equal(out.status, 'VERIFIED');
  assert.equal(out.ok, true);
  assert.equal(out.hash_matches, true);
  assert.equal(out.signature_valid, true);
  assert.equal(out.debug.chain_root_matched, true);
});

test('tampering with pinned card CID/hash returns INVALID', async () => {
  const cidCase = await createGenesisReceipt(baseInput({ receiptId: 'cl_genesis_tamper_card_cid' }));
  cidCase.receipt.agent_card_cid = 'ipfs://tampered';
  const cidOut = await verifyReceipt(cidCase.receipt, verifyOptions());
  assert.equal(cidOut.status, 'INVALID');
  assert.equal(cidOut.ok, false);
  assert.equal(cidOut.hash_matches, false);

  const hashCase = await createGenesisReceipt(baseInput({ receiptId: 'cl_genesis_tamper_card_hash' }));
  hashCase.receipt.agent_card_hash = 'sha256:tampered';
  const hashOut = await verifyReceipt(hashCase.receipt, verifyOptions());
  assert.equal(hashOut.status, 'INVALID');
  assert.equal(hashOut.ok, false);
  assert.equal(hashOut.hash_matches, false);
});

test('tampering with signed chain fields returns INVALID', async () => {
  const { receipt } = await createGenesisReceipt(baseInput({ receiptId: 'cl_genesis_tamper_chain' }));
  receipt.chain_index = 1;
  const out = await verifyReceipt(receipt, verifyOptions());
  assert.equal(out.status, 'INVALID');
  assert.equal(out.ok, false);
  assert.equal(out.debug.receipt_shape_matched, false);
});

test('missing signing env throws signing unavailable', async () => {
  await assert.rejects(
    createGenesisReceipt({ claimId: 'x', label: 'a', namespace: 'eth', owner: '0x1', verbs: ['verify'] }),
    (error) => error && error.code === 'SIGNING_UNAVAILABLE'
  );
});
