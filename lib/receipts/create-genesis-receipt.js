'use strict';

const crypto = require('node:crypto');
const { canonicalize, sha256Hex } = require('../receiptSigning');

function normalizeHash(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.startsWith('sha256:') ? raw : `sha256:${raw}`;
}

function buildReceiptId(claimId) {
  return `cl_genesis_${String(claimId || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function assertRequired(input) {
  if (!input.claimId) return 'CLAIM_ID_REQUIRED';
  if (!input.label) return 'GENESIS_LABEL_REQUIRED';
  if (!input.namespace) return 'GENESIS_NAMESPACE_REQUIRED';
  if (!input.owner) return 'GENESIS_OWNER_REQUIRED';
  if (!Array.isArray(input.verbs) || !input.verbs.length) return 'GENESIS_VERBS_REQUIRED';
  if (!input.signerId || !input.kid || !input.privateKeyPem) return 'SIGNING_UNAVAILABLE';
  return null;
}

function signHash(hashHex, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(hashHex, 'utf8'), privateKey).toString('base64');
}

async function createGenesisReceipt(input) {
  const missing = assertRequired(input);
  if (missing) {
    const error = new Error(missing);
    error.code = missing;
    throw error;
  }

  const createdAt = input.createdAt || new Date().toISOString();
  const receiptId = input.receiptId || buildReceiptId(input.claimId);

  const receipt = {
    receipt_type: 'genesis',
    receipt_id: receiptId,
    agent: `${input.label}.${input.namespace}`,
    namespace: input.namespace,
    label: input.label,
    owner: input.owner,
    verbs: input.verbs,
    agent_card_hash: normalizeHash(input.agentCardHash),
    agent_card_cid: input.agentCardCid || null,
    created_at: createdAt,
    created_block: null,
    created_tx: null,
    chain_root: null,
    previous_receipt_hash: null,
    chain_index: 0,
    parent_receipt_id: null,
    verification: {
      canonicalization: 'json.sorted_keys.v1',
      hash_alg: 'sha256',
      signature_alg: 'ed25519',
      schema: 'commandlayer.genesis-receipt.v1'
    },
    signer: 'runtime.commandlayer.eth',
    metadata: {}
  };

  const hashHex = await sha256Hex(canonicalize(receipt));
  const signature = signHash(hashHex, input.privateKeyPem);
  receipt.metadata = {
    proof: {
      canonicalization: 'json.sorted_keys.v1',
      hash: { alg: 'SHA-256', value: hashHex },
      signature: { alg: 'Ed25519', kid: input.kid, value: signature, role: 'runtime' },
      signer_id: input.signerId
    }
  };

  const finalHash = await sha256Hex(canonicalize(receipt));
  receipt.chain_root = `sha256:${finalHash}`;

  return { receipt, receiptHash: finalHash, chainRoot: receipt.chain_root, receiptChainRoot: receipt.chain_root, generatedAt: createdAt };
}

module.exports = { createGenesisReceipt };
