'use strict';

const { buildSignerRecords, CANONICALIZATION, resolveRequiredSignerRecords, compareSignerRecords } = require('./signer-records');

const APPROVED_MANAGED_PARENTS = ['attestagent.eth', 'approveagent.eth', 'verifyagent.eth', 'authorizeagent.eth'];
const PUBLICATION_STATUSES = ['not_started', 'ready_to_publish', 'published_pending_verification', 'verified', 'failed'];

function normalizeEns(value) { return String(value || '').trim().toLowerCase(); }
function tenantRootEns(claim) { return normalizeEns(claim.tenant_root_ens || claim.root_ens || (claim.tenant ? `${claim.tenant}.eth` : '')); }
function parentNamespace(signerEns) { const parts = normalizeEns(signerEns).split('.'); return parts.length > 2 ? parts.slice(1).join('.') : ''; }
function isApprovedParent(parent) { return APPROVED_MANAGED_PARENTS.includes(normalizeEns(parent)); }
function readReceiptSigner(claim) {
  const pkg = claim.claim_package || claim.request_json || claim.receipt_json || {};
  return normalizeEns(pkg?.cl?.receipt?.signer || pkg?.['cl.receipt.signer'] || pkg?.receipt?.signer || claim.receipt_signer || '');
}
function validationError(status, error) { const e = new Error(error); e.status = status; return e; }

function validateManagedEnsPublicationClaim(claim) {
  if (!claim || claim.activation_mode !== 'managed_namespace') throw validationError('MANAGED_NAMESPACE_REQUIRED', 'Managed ENS publication is only available for managed namespace claims.');
  const signerEns = normalizeEns(claim.tenant_signer_ens);
  if (!signerEns) throw validationError('TENANT_SIGNER_ENS_REQUIRED', 'tenant_signer_ens is required.');
  const root = tenantRootEns(claim);
  if (root && signerEns === root) throw validationError('TENANT_ROOT_ENS_NOT_ALLOWED', 'Managed signer ENS must not equal the tenant root ENS.');
  const parent = parentNamespace(signerEns);
  if (!parent || !isApprovedParent(parent)) throw validationError('MANAGED_PARENT_NOT_APPROVED', 'tenant_signer_ens must end in an approved managed parent namespace.');
  if (!claim.tenant_signer_public_key || !claim.tenant_signer_kid || !claim.tenant_signer_canonicalization) throw validationError('SIGNER_RECORD_FIELDS_REQUIRED', 'public key, kid, and canonicalization are required.');
  const receiptSigner = readReceiptSigner(claim);
  if (receiptSigner && receiptSigner !== signerEns) throw validationError('RECEIPT_SIGNER_MISMATCH', 'claim package cl.receipt.signer must match tenant_signer_ens.');
  return { signerEns, parent, tenant: claim.tenant || signerEns.split('.')[0] };
}

function buildManagedEnsPublicationPackage(claim) {
  const { signerEns, parent, tenant } = validateManagedEnsPublicationClaim(claim);
  const required = buildSignerRecords({ publicKey: claim.tenant_signer_public_key, kid: claim.tenant_signer_kid, canonicalization: claim.tenant_signer_canonicalization || CANONICALIZATION, signerEns });
  return {
    signer_ens: signerEns,
    parent_namespace: parent,
    tenant,
    required_txt_records: required,
    agent_records: {
      'cl.capability': 'attest',
      'cl.runtime': 'https://runtime.commandlayer.org',
      'cl.verifier': 'https://runtime.commandlayer.org/verify',
      'cl.trust_verification_entry': 'https://runtime.commandlayer.org/trust-verification/attest/v1.0.0',
      'cl.agent.card': 'pending_provisioning',
    },
    instructions: ['Open ENS Manager', 'Select the managed signer name', 'Add the required TXT records', 'Save changes', 'Return to CommandLayer and run verification'],
  };
}

async function verifyManagedEnsPublication(claim, options = {}) {
  const pkg = buildManagedEnsPublicationPackage(claim);
  const resolved = await resolveRequiredSignerRecords(pkg.signer_ens, options);
  const { checks, verified } = compareSignerRecords({ ...claim, tenant_signer_ens: pkg.signer_ens }, resolved);
  const missing = Object.values(resolved).some((value) => !value);
  return { ok: verified && !missing, status: verified && !missing ? 'verified' : (missing ? 'published_pending_verification' : 'failed'), signer_ens: pkg.signer_ens, parent_namespace: pkg.parent_namespace, required_txt_records: pkg.required_txt_records, resolved_txt_records: resolved, checks, error: verified && !missing ? null : (missing ? 'required_txt_record_missing' : 'required_txt_record_mismatch') };
}

module.exports = { APPROVED_MANAGED_PARENTS, PUBLICATION_STATUSES, validateManagedEnsPublicationClaim, buildManagedEnsPublicationPackage, verifyManagedEnsPublication };
