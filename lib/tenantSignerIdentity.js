'use strict';

const crypto = require('node:crypto');
const { resolveSignerFromEns } = require('./verifyReceipt');

const CANONICALIZATION = 'json.sorted_keys.v1';
const STATUSES = new Set(['generated', 'records_pending', 'records_published', 'verified']);

function normalizeAgentEnsName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(name)) {
    const error = new Error('AGENT_ENS_NAME_INVALID');
    error.code = 'AGENT_ENS_NAME_INVALID';
    throw error;
  }
  return name;
}

function normalizePublicKey(value) {
  const raw = String(value || '').trim().replace(/^ed25519:/i, '');
  if (!raw) {
    const error = new Error('TENANT_SIGNER_PUBLIC_KEY_REQUIRED');
    error.code = 'TENANT_SIGNER_PUBLIC_KEY_REQUIRED';
    throw error;
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== raw) {
    const error = new Error('TENANT_SIGNER_PUBLIC_KEY_INVALID');
    error.code = 'TENANT_SIGNER_PUBLIC_KEY_INVALID';
    throw error;
  }
  return raw;
}

function normalizeKid(value, ensName, publicKey) {
  const raw = String(value || '').trim();
  if (raw) {
    if (!/^[a-zA-Z0-9._:-]{4,128}$/.test(raw)) {
      const error = new Error('TENANT_SIGNER_KID_INVALID');
      error.code = 'TENANT_SIGNER_KID_INVALID';
      throw error;
    }
    return raw;
  }
  return crypto.createHash('sha256').update(`${ensName}\n${publicKey}`).digest('base64url').slice(0, 16);
}

function normalizeStatus(value) {
  const status = String(value || 'records_pending').trim();
  return STATUSES.has(status) ? status : 'records_pending';
}

function buildTenantSignerIdentity(input = {}) {
  const agentEnsName = normalizeAgentEnsName(input.agentEnsName || input.agent_ens_name || input.ens);
  const publicKey = normalizePublicKey(input.tenantSignerPublicKey || input.tenant_signer_public_key || input.publicKey);
  const kid = normalizeKid(input.tenantSignerKid || input.tenant_signer_kid || input.kid, agentEnsName, publicKey);
  const canonicalization = input.tenantSignerCanonicalization || input.tenant_signer_canonicalization || CANONICALIZATION;
  if (canonicalization !== CANONICALIZATION) {
    const error = new Error('TENANT_SIGNER_CANONICALIZATION_UNSUPPORTED');
    error.code = 'TENANT_SIGNER_CANONICALIZATION_UNSUPPORTED';
    throw error;
  }
  return {
    agent_ens_name: agentEnsName,
    tenant_signer_kid: kid,
    tenant_signer_public_key: publicKey,
    tenant_signer_canonicalization: canonicalization,
    tenant_signer_status: normalizeStatus(input.tenantSignerStatus || input.tenant_signer_status),
  };
}

function buildTenantSignerTxtRecords(identity = {}) {
  const agentEnsName = normalizeAgentEnsName(identity.agent_ens_name || identity.agentEnsName || identity.ens);
  const publicKey = normalizePublicKey(identity.tenant_signer_public_key || identity.tenantSignerPublicKey || identity.publicKey);
  const kid = normalizeKid(identity.tenant_signer_kid || identity.tenantSignerKid || identity.kid, agentEnsName, publicKey);
  const canonicalization = identity.tenant_signer_canonicalization || identity.tenantSignerCanonicalization || CANONICALIZATION;
  if (canonicalization !== CANONICALIZATION) {
    const error = new Error('TENANT_SIGNER_CANONICALIZATION_UNSUPPORTED');
    error.code = 'TENANT_SIGNER_CANONICALIZATION_UNSUPPORTED';
    throw error;
  }
  return {
    'cl.sig.pub': `ed25519:${publicKey}`,
    'cl.sig.kid': kid,
    'cl.sig.canonical': canonicalization,
    'cl.receipt.signer': agentEnsName,
  };
}

function buildTenantSignerRecordPackage(identity = {}) {
  const normalized = buildTenantSignerIdentity(identity);
  const txt = buildTenantSignerTxtRecords(normalized);
  return {
    agent_ens_name: normalized.agent_ens_name,
    tenant_signer_kid: normalized.tenant_signer_kid,
    tenant_signer_public_key: normalized.tenant_signer_public_key,
    tenant_signer_canonicalization: normalized.tenant_signer_canonicalization,
    txt_records: txt,
    txt_record_lines: Object.entries(txt).map(([key, value]) => `${key}=${value}`),
  };
}

async function checkTenantSignerEnsRecords(identity, options = {}) {
  const recordPackage = buildTenantSignerRecordPackage(identity);
  const expected = recordPackage.txt_records;
  const resolved = await resolveSignerFromEns(recordPackage.agent_ens_name, options);
  const matches = Boolean(
    resolved.ensResolved &&
      resolved.records['cl.sig.pub'] === expected['cl.sig.pub'] &&
      resolved.records['cl.sig.kid'] === expected['cl.sig.kid'] &&
      resolved.records['cl.sig.canonical'] === expected['cl.sig.canonical'] &&
      resolved.records['cl.receipt.signer'] === expected['cl.receipt.signer']
  );
  return {
    ok: matches,
    status: matches ? 'verified' : 'records_pending',
    ens_resolved: Boolean(resolved.ensResolved),
    public_key_source: resolved.keySource,
    key_resolution_error: resolved.errorCode,
    expected_records: expected,
    resolved_records: resolved.records,
  };
}

module.exports = {
  CANONICALIZATION,
  buildTenantSignerIdentity,
  buildTenantSignerTxtRecords,
  buildTenantSignerRecordPackage,
  checkTenantSignerEnsRecords,
  normalizePublicKey,
};
