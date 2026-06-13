'use strict';

const crypto = require('node:crypto');
const { canonicalize, sha256Hex } = require('../receiptSigning');

const EXECUTION_SCHEMA = 'clas.execution.receipt.v1';
const EXECUTION_COVERS = ['receipt_id', 'verb', 'agent', 'action'];

function safeIdPart(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'claim';
}

function firstClaimVerb(claim, agents = []) {
  const row = agents.find((a) => a.capability || a.ens) || {};
  if (row.capability) return safeIdPart(row.capability);
  const ensLabel = String(row.ens || claim.tenant_signer_ens || 'verify').split('.')[0];
  return safeIdPart(ensLabel.replace(String(claim.tenant || ''), '') || ensLabel || 'verify');
}

async function hashObject(value) {
  return `sha256:${await sha256Hex(canonicalize(value))}`;
}

function executionPayload(receipt) {
  return {
    clas: receipt?.clas,
    schema: receipt?.schema,
    receipt_id: receipt?.receipt_id,
    verb: receipt?.verb,
    agent: receipt?.agent,
    action: receipt?.action,
  };
}

async function buildFirstActionReceiptChallenge({ claim, agents = [], now = new Date() }) {
  const verb = firstClaimVerb(claim, agents);
  const iso = now.toISOString();
  const receipt = {
    clas: '1.0',
    schema: EXECUTION_SCHEMA,
    receipt_id: `clas_exec_${safeIdPart(claim.claim_id)}_${verb}_activation_001`,
    verb,
    agent: {
      ens: claim.tenant_signer_ens,
      kid: claim.tenant_signer_kid,
      public_key_source: 'ens_txt',
    },
    action: {
      input_hash: await hashObject({ claim_id: claim.claim_id, verb, checkpoint: 'activation_first_action' }),
      output_hash: await hashObject({ ok: true, checkpoint: 'activation_first_action', schema: EXECUTION_SCHEMA }),
      started_at: iso,
      completed_at: iso,
    },
  };
  return {
    ...receipt,
    proofs: [{
      type: 'execution',
      covers: EXECUTION_COVERS,
      signer: claim.tenant_signer_ens,
      canonicalization: 'json.sorted_keys.v1',
      signature: { alg: 'Ed25519', kid: claim.tenant_signer_kid, value: '' },
    }],
  };
}

function parseEd25519PublicKey(value) {
  const raw = String(value || '').replace(/^ed25519:/, '');
  if (!raw) return null;
  return Buffer.from(raw, 'base64');
}

async function verifyFirstActionReceipt(receipt, claim) {
  const proof = Array.isArray(receipt?.proofs) ? receipt.proofs[0] : null;
  const coversOk = JSON.stringify(proof?.covers || []) === JSON.stringify(EXECUTION_COVERS);
  if (receipt?.schema !== EXECUTION_SCHEMA) return { ok: false, status: 'INVALID_SCHEMA', error: 'schema must be clas.execution.receipt.v1' };
  if (proof?.type !== 'execution') return { ok: false, status: 'INVALID_PROOF_TYPE', error: 'proof type must be execution' };
  if (!coversOk) return { ok: false, status: 'INVALID_PROOF_COVERS', error: 'execution proof covers must exactly receipt_id, verb, agent, action' };
  if (proof.signer !== claim.tenant_signer_ens || receipt?.agent?.ens !== claim.tenant_signer_ens) return { ok: false, status: 'SIGNER_MISMATCH', error: 'receipt signer must match claim tenant signer ENS' };
  if (receipt?.agent?.kid !== claim.tenant_signer_kid || proof?.signature?.kid !== claim.tenant_signer_kid) return { ok: false, status: 'KID_MISMATCH', error: 'receipt kid must match claim tenant signer kid' };
  if (proof?.signature?.alg !== 'Ed25519' || !proof?.signature?.value) return { ok: false, status: 'INVALID_SIGNATURE', error: 'Ed25519 signature is required' };
  const pub = parseEd25519PublicKey(claim.tenant_signer_public_key);
  if (!pub) return { ok: false, status: 'PUBLIC_KEY_UNAVAILABLE', error: 'claim tenant public key unavailable' };
  const hash = await sha256Hex(canonicalize(executionPayload(receipt)));
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(hash, 'utf8'), { key: pub, format: 'der', type: 'spki' }, Buffer.from(proof.signature.value, 'base64'));
  } catch {
    try {
      const key = await crypto.webcrypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
      valid = await crypto.webcrypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(proof.signature.value, 'base64'), new TextEncoder().encode(hash));
    } catch { valid = false; }
  }
  if (!valid) return { ok: false, status: 'SIGNATURE_INVALID', error: 'action receipt signature invalid or payload tampered' };
  return { ok: true, status: 'VERIFIED', hash: `sha256:${await sha256Hex(canonicalize(receipt))}`, receipt_id: receipt.receipt_id };
}

module.exports = { EXECUTION_SCHEMA, EXECUTION_COVERS, buildFirstActionReceiptChallenge, verifyFirstActionReceipt, executionPayload };
