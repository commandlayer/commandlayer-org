'use strict';

const EXPECTED_ENS_SIGNER = 'runtime.commandlayer.eth';
const ENS_RECORDS = {
  'cl.receipt.signer': 'runtime.commandlayer.eth',
  'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
  'cl.sig.pub': 'ed25519:hhyCuPNoMk4JtEvGEV8F6nMZ4uDO1EcyizPufmnJTOY=',
  'cl.sig.canonical': 'json.sorted_keys.v1',
};

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
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

function b64ToBytes(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyEd25519HashSignature(hashHex, sigB64, pubkeyB64) {
  const publicKey = await crypto.subtle.importKey('raw', b64ToBytes(pubkeyB64), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, b64ToBytes(sigB64), new TextEncoder().encode(hashHex));
}

async function verifyReceipt(receipt) {
  const schemaValid = receipt && typeof receipt === 'object' && typeof receipt.signer === 'string' && typeof receipt.verb === 'string' && typeof receipt.ts === 'string' && receipt.metadata?.proof?.canonicalization && receipt.metadata?.proof?.hash_sha256 && receipt.signature?.kid && receipt.signature?.sig;
  const signerMatched = receipt?.signer === EXPECTED_ENS_SIGNER;
  const ensKeyResolved = signerMatched && !!ENS_RECORDS['cl.sig.pub'];

  let hashMatched = false;
  let signatureValid = false;
  let recomputedHash = null;

  if (schemaValid) {
    const canonicalizationOk = receipt.metadata.proof.canonicalization === ENS_RECORDS['cl.sig.canonical'];
    const keyIdOk = receipt.signature.kid === ENS_RECORDS['cl.sig.kid'];
    const canonicalPayload = canonicalize(canonicalReceiptPayload(receipt));
    recomputedHash = await sha256Hex(canonicalPayload);
    hashMatched = canonicalizationOk && receipt.metadata.proof.hash_sha256 === recomputedHash;

    if (hashMatched && keyIdOk && ensKeyResolved) {
      const pubkeyB64 = ENS_RECORDS['cl.sig.pub'].replace(/^ed25519:/, '');
      signatureValid = await verifyEd25519HashSignature(recomputedHash, receipt.signature.sig, pubkeyB64);
    }
  }

  const ok = Boolean(schemaValid && hashMatched && signatureValid && ensKeyResolved && signerMatched);
  return {
    ok,
    status: ok ? 'VERIFIED' : 'INVALID',
    reason: ok ? 'Receipt verification passed.' : 'Receipt is invalid, tampered, or does not match the ENS signer key.',
    signer: receipt?.signer || null,
    verb: receipt?.verb || null,
    hash: recomputedHash,
    hash_matches: Boolean(hashMatched),
    signature_valid: Boolean(signatureValid),
    ens_resolved: Boolean(ensKeyResolved),
    key_id: receipt?.signature?.kid || null,
  };
}

module.exports = { verifyReceipt };
