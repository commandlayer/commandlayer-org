'use strict';

const crypto = require('node:crypto');
const { webcrypto } = crypto;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

async function sha256Hex(text) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex');
}

function normalizePemValue(value) {
  return String(value).replace(/\\n/g, '\n');
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
    privateKeyPem = normalizePemValue(pemValue);
  } else if (b64Value) {
    try {
      privateKeyPem = normalizePemValue(Buffer.from(b64Value, 'base64').toString('utf8'));
    } catch {
      privateKeyPem = null;
    }
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
  const canonicalPayload = {
    signer: receipt?.signer,
    verb: receipt?.verb,
    input: receipt?.input,
    output: receipt?.output,
    execution: receipt?.execution,
    ts: receipt?.ts,
  };
  const canonicalStr = canonicalize(canonicalPayload);
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
          role: 'runtime',
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
  resolveReceiptSigningConfigFromEnv,
  hasValidSigningConfig,
};
