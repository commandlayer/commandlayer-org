'use strict';

const { defaultTextResolver } = require('../verifyReceipt');

const RECORD_NETWORK = 'ethereum-mainnet';
const RECORD_STATUSES = new Set(['records_generated', 'records_pending', 'records_verified', 'records_mismatch', 'records_unavailable']);
const REQUIRED_RECORD_KEYS = ['cl.sig.pub', 'cl.sig.kid', 'cl.sig.canonical', 'cl.receipt.signer'];
const CANONICALIZATION = 'json.sorted_keys.v1';

function normalizeActivationMode(mode) {
  if (mode === 'managed_namespace' || mode === 'cl') return 'managed_namespace';
  if (mode === 'bring_your_own_ens' || mode === 'own' || mode === 'single') return 'bring_your_own_ens';
  return '';
}

function buildSignerRecords({ publicKey, kid, canonicalization = CANONICALIZATION, signerEns }) {
  return {
    'cl.sig.pub': publicKey,
    'cl.sig.kid': kid,
    'cl.sig.canonical': canonicalization,
    'cl.receipt.signer': signerEns,
  };
}

function toTxtPackage(records) {
  return REQUIRED_RECORD_KEYS.map((key) => `${key}=${records[key] || ''}`).join('\n');
}

function safeVerificationResponse({ status, signer, checks }) {
  return { ok: true, status, signer, network: RECORD_NETWORK, checks };
}

async function resolveRequiredSignerRecords(signerEns, options = {}) {
  const resolver = options.textResolver || defaultTextResolver;
  const records = {};
  for (const key of REQUIRED_RECORD_KEYS) {
    records[key] = await resolver(signerEns, key, { ...options, allowLocalFallback: false });
  }
  return records;
}

function compareSignerRecords(claim, resolved) {
  const checks = {
    public_key_matches: resolved['cl.sig.pub'] === claim.tenant_signer_public_key,
    kid_matches: resolved['cl.sig.kid'] === claim.tenant_signer_kid,
    canonicalization_matches: resolved['cl.sig.canonical'] === claim.tenant_signer_canonicalization,
    signer_matches: resolved['cl.receipt.signer'] === claim.tenant_signer_ens,
  };
  return { checks, verified: Object.values(checks).every(Boolean) };
}

module.exports = {
  RECORD_NETWORK,
  RECORD_STATUSES,
  REQUIRED_RECORD_KEYS,
  CANONICALIZATION,
  normalizeActivationMode,
  buildSignerRecords,
  toTxtPackage,
  safeVerificationResponse,
  resolveRequiredSignerRecords,
  compareSignerRecords,
};
