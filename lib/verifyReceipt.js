'use strict';

const { webcrypto } = require('node:crypto');

const subtle = webcrypto.subtle;

const FALLBACK_SIGNER = 'runtime.commandlayer.eth';
const FALLBACK_RECORDS = {
  'cl.receipt.signer': 'runtime.commandlayer.eth',
  'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
  'cl.sig.pub': 'ed25519:hhyCuPNoMk4JtEvGEV8F6nMZ4uDO1EcyizPufmnJTOY=',
  'cl.sig.canonical': 'json.sorted_keys.v1',
};

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
}

function canonicalReceiptPayload(receipt) {
  return {
    signer: receipt?.signer,
    verb: receipt?.verb,
    input: receipt?.input,
    output: receipt?.output,
    execution: receipt?.execution,
    ts: receipt?.ts,
  };
}

function base64ToBytes(value) {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

async function sha256Hex(text) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex');
}

async function importEd25519PublicKey(pubkeyBase64) {
  return subtle.importKey(
    'raw',
    base64ToBytes(pubkeyBase64),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

async function verifyHashHexSignature(hashHex, signatureBase64, publicKey) {
  return subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    base64ToBytes(signatureBase64),
    new TextEncoder().encode(hashHex),
  );
}

async function defaultTextResolver() {
  return null;
}

async function resolveSignerFromEns(signerEnsName, options = {}) {
  const resolver = options.textResolver || defaultTextResolver;
  const requiredKeys = ['cl.sig.pub', 'cl.sig.kid', 'cl.sig.canonical', 'cl.receipt.signer'];
  const records = {};

  let liveOk = true;
  for (const key of requiredKeys) {
    try {
      const value = await resolver(signerEnsName, key);
      if (!value) {
        liveOk = false;
        break;
      }
      records[key] = value;
    } catch {
      liveOk = false;
      break;
    }
  }

  if (liveOk) {
    return {
      signer: signerEnsName,
      records,
      ensResolved: true,
      keySource: 'live ENS text record',
    };
  }

  if (signerEnsName === FALLBACK_SIGNER) {
    return {
      signer: signerEnsName,
      records: { ...FALLBACK_RECORDS },
      ensResolved: true,
      keySource: 'local demo fallback (runtime.commandlayer.eth only)',
    };
  }

  return {
    signer: signerEnsName || 'unknown',
    records: {},
    ensResolved: false,
    keySource: 'not resolved',
  };
}

function normalizeReceipt(receiptInput) {
  if (typeof receiptInput === 'string') return JSON.parse(receiptInput);
  return receiptInput;
}

async function verifyReceipt(receiptInput, options = {}) {
  let receipt;
  try {
    receipt = normalizeReceipt(receiptInput);
  } catch {
    return {
      ok: false,
      status: 'INVALID',
      reason: 'Receipt is not valid JSON.',
      signer: null,
      verb: null,
      hash: null,
      hash_matches: false,
      signature_valid: false,
      ens_resolved: false,
      key_id: null,
      public_key_source: 'not resolved',
    };
  }

  const schemaValid = Boolean(
    receipt &&
      typeof receipt === 'object' &&
      typeof receipt.signer === 'string' &&
      typeof receipt.verb === 'string' &&
      typeof receipt.ts === 'string' &&
      receipt.metadata?.proof?.canonicalization &&
      receipt.metadata?.proof?.hash_sha256 &&
      receipt.signature?.kid &&
      receipt.signature?.sig,
  );

  const ens = await resolveSignerFromEns(receipt?.signer, options.ens || {});
  const expectedHash = receipt?.metadata?.proof?.hash_sha256 || null;
  const canonicalization = receipt?.metadata?.proof?.canonicalization || null;
  const canonicalPayload = canonicalReceiptPayload(receipt);
  const recomputedHash = await sha256Hex(canonicalize(canonicalPayload));

  const expectedCanonical = ens.records['cl.sig.canonical'];
  const canonicalizationOk = canonicalization === expectedCanonical;
  const hashMatched = Boolean(
    schemaValid &&
      canonicalizationOk &&
      typeof expectedHash === 'string' &&
      expectedHash === recomputedHash,
  );

  const keyIdMatched = receipt?.signature?.kid === ens.records['cl.sig.kid'];
  const prefixedPubkey = ens.records['cl.sig.pub'];
  const pubkeyBase64 = typeof prefixedPubkey === 'string'
    ? prefixedPubkey.replace(/^ed25519:/, '')
    : null;

  let signatureValid = false;
  if (hashMatched && keyIdMatched && pubkeyBase64 && receipt?.signature?.sig) {
    try {
      const publicKey = await importEd25519PublicKey(pubkeyBase64);
      signatureValid = await verifyHashHexSignature(recomputedHash, receipt.signature.sig, publicKey);
    } catch {
      signatureValid = false;
    }
  }

  const signerMatched = Boolean(
    ens.records['cl.receipt.signer'] && receipt?.signer === ens.records['cl.receipt.signer'],
  );

  const ok = Boolean(schemaValid && hashMatched && signatureValid && signerMatched && ens.ensResolved);

  return {
    ok,
    status: ok ? 'VERIFIED' : 'INVALID',
    reason: ok ? 'Receipt verification passed.' : 'Receipt is invalid, tampered, or does not match the signer key metadata.',
    signer: receipt?.signer || null,
    verb: receipt?.verb || null,
    hash: recomputedHash,
    hash_matches: hashMatched,
    signature_valid: signatureValid,
    ens_resolved: Boolean(ens.ensResolved),
    key_id: receipt?.signature?.kid || null,
    public_key_source: ens.keySource,
    debug: {
      expected_hash_sha256: expectedHash,
      key_id_matched: keyIdMatched,
      canonicalization_matched: canonicalizationOk,
      signer_matched: signerMatched,
    },
  };
}

function computeReceiptHash(receipt) {
  return sha256Hex(canonicalize(canonicalReceiptPayload(receipt)));
}

module.exports = { verifyReceipt, computeReceiptHash };
