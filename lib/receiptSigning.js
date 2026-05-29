'use strict';

const crypto = require('node:crypto');
const { webcrypto } = crypto;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}


function isGenesisReceipt(receipt) {
  return receipt?.receipt_type === 'genesis';
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function canonicalGenesisReceiptPayload(receipt, options = {}) {
  const payload = {
    receipt_type: receipt?.receipt_type,
    receipt_id: receipt?.receipt_id,
    agent: receipt?.agent,
    subject_agent: receipt?.subject_agent,
    issuer_role: receipt?.issuer_role,
    namespace: receipt?.namespace,
    label: receipt?.label,
    owner: receipt?.owner,
    verbs: receipt?.verbs,
    agent_card_hash: receipt?.agent_card_hash,
    agent_card_cid: receipt?.agent_card_cid,
    created_at: receipt?.created_at,
    created_block: receipt?.created_block,
    created_tx: receipt?.created_tx,
    chain_root: receipt?.chain_root,
    previous_receipt_hash: receipt?.previous_receipt_hash,
    chain_index: receipt?.chain_index,
    parent_receipt_id: receipt?.parent_receipt_id,
    verification: receipt?.verification,
    signer: receipt?.signer,
  };

  if (options.excludeChainRoot) delete payload.chain_root;
  return omitUndefined(payload);
}

function canonicalRuntimeReceiptPayload(receipt) {
  return omitUndefined({
    receipt_type: receipt?.receipt_type === 'action' ? receipt.receipt_type : undefined,
    signer: receipt?.signer,
    issuer_role: receipt?.receipt_type === 'action' ? receipt?.issuer_role : undefined,
    verb: receipt?.verb,
    input: receipt?.input,
    output: receipt?.output,
    execution: receipt?.execution,
    ts: receipt?.ts,
  });
}

function canonicalReceiptPayload(receipt, options = {}) {
  if (isGenesisReceipt(receipt)) return canonicalGenesisReceiptPayload(receipt, options);
  return canonicalRuntimeReceiptPayload(receipt);
}

async function sha256Hex(text) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex');
}

function normalizePemValue(value) {
  return String(value).replace(/\\n/g, '\n');
}

function wrapPemBody(body) {
  const normalizedBody = String(body).replace(/\s+/g, '');
  if (!normalizedBody) return null;
  const lines = normalizedBody.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

function toPossibleUtf8Base64(value) {
  try {
    const decoded = Buffer.from(String(value), 'base64').toString('utf8');
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

function normalizePrivateKeyPem(raw) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (candidate && typeof candidate === 'string') {
      const normalized = normalizePemValue(candidate).trim();
      if (normalized) candidates.push(normalized);
    }
  };

  pushCandidate(raw);
  pushCandidate(toPossibleUtf8Base64(raw));

  for (const candidate of candidates) {
    if (candidate.includes('BEGIN PRIVATE KEY') && candidate.includes('END PRIVATE KEY')) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const wrapped = wrapPemBody(candidate);
    if (wrapped) return wrapped;
  }

  return null;
}

function resolveFirstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function resolveReceiptSigningConfigFromEnv() {
  const signerId = resolveFirstEnv([
    'CL_RECEIPT_SIGNER_ID',
    'RECEIPT_SIGNER_ID',
    'CL_RECEIPT_SIGNER',
  ]);

  const kid = resolveFirstEnv([
    'CL_RECEIPT_SIGNING_KID',
    'RECEIPT_SIGNING_KID',
    'CL_RECEIPT_SIGNING_KEY_ID',
    'CL_KEY_ID',
  ]);

  const pemValue = resolveFirstEnv([
    'CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM',
    'RECEIPT_SIGNING_PRIVATE_KEY_PEM',
    'CL_PRIVATE_KEY_PEM',
  ]);

  const b64Value = resolveFirstEnv([
    'CL_RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64',
    'RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64',
    'RECEIPT_SIGNING_PRIVATE_KEY_B64',
    'CL_PRIVATE_KEY_PEM_B64',
  ]);

  let privateKeyPem = null;
  if (pemValue) {
    privateKeyPem = normalizePrivateKeyPem(pemValue);
  } else if (b64Value) {
    privateKeyPem = normalizePrivateKeyPem(b64Value);
  }

  return {
    signerId,
    kid,
    privateKeyPem,
  };
}

function hasValidSigningConfig(cfg) {
  return Boolean(cfg?.signerId && cfg?.kid && cfg?.privateKeyPem);
}

async function signReceipt(receipt, cfg) {
  const canonicalStr = canonicalize(canonicalReceiptPayload(receipt));
  const hashHex = await sha256Hex(canonicalStr);

  const privateKey = crypto.createPrivateKey(cfg.privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(hashHex, 'utf8'), privateKey).toString('base64');

  return {
    ...receipt,
    metadata: {
      ...(receipt.metadata || {}),
      proof: {
        canonicalization: 'json.sorted_keys.v1',
        hash: { alg: 'SHA-256', value: hashHex },
        signature: {
          alg: 'Ed25519',
          kid: cfg.kid,
          value: signature,
          role: cfg.role || 'runtime',
        },
        signer_id: cfg.signerId,
      },
    },
  };
}

module.exports = {
  signReceipt,
  canonicalize,
  sha256Hex,
  canonicalReceiptPayload,
  canonicalGenesisReceiptPayload,
  canonicalRuntimeReceiptPayload,
  isGenesisReceipt,
  resolveReceiptSigningConfigFromEnv,
  hasValidSigningConfig,
};
