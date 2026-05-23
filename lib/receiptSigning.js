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

module.exports = { signReceipt, canonicalize, sha256Hex };
