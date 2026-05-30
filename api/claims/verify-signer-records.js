'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('../admin/_auth');
const { RECORD_NETWORK, resolveRequiredSignerRecords, compareSignerRecords, safeVerificationResponse } = require('../../lib/claims/signer-records');

function unavailableResponse(res, claim, status, checks) {
  return res.status(200).json(safeVerificationResponse({ status, signer: claim.tenant_signer_ens, checks }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  const isAdminAttempt = Boolean(req.headers && (req.headers.authorization || req.headers.Authorization || req.headers['x-admin-api-key']));
  if (isAdminAttempt && !requireAdminAuth(req, res)) return;

  const claimId = req.body && (req.body.claim_id || req.body.claimId);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  try {
    const result = await db.query(
      `select claim_id, tenant_signer_ens, tenant_signer_public_key, tenant_signer_kid, tenant_signer_canonicalization
       from claim_requests where claim_id = $1 limit 1`,
      [claimId]
    );
    const claim = result.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    if (!claim.tenant_signer_ens || !claim.tenant_signer_public_key || !claim.tenant_signer_kid || !claim.tenant_signer_canonicalization) {
      await db.query(
        `update claim_requests set tenant_signer_record_status = 'records_pending', tenant_signer_records_network = $2,
         tenant_signer_verification_error = 'signer_identity_missing', updated_at = now() where claim_id = $1`,
        [claimId, RECORD_NETWORK]
      );
      return unavailableResponse(res, { tenant_signer_ens: claim.tenant_signer_ens || null }, 'records_pending', {
        public_key_matches: false, kid_matches: false, canonicalization_matches: false, signer_matches: false,
      });
    }

    let resolved;
    try {
      resolved = await resolveRequiredSignerRecords(claim.tenant_signer_ens, { allowLocalFallback: false });
    } catch (_error) {
      await db.query(
        `update claim_requests set tenant_signer_record_status = 'records_unavailable', tenant_signer_records_network = $2,
         tenant_signer_verification_error = 'ens_resolution_unavailable', updated_at = now() where claim_id = $1`,
        [claimId, RECORD_NETWORK]
      );
      return unavailableResponse(res, claim, 'records_unavailable', {
        public_key_matches: false, kid_matches: false, canonicalization_matches: false, signer_matches: false,
      });
    }

    const missing = Object.values(resolved).some((value) => !value);
    if (missing) {
      await db.query(
        `update claim_requests set tenant_signer_record_status = 'records_unavailable', tenant_signer_records_network = $2,
         tenant_signer_records_verified_at = null, tenant_signer_verification_error = 'required_txt_record_missing', updated_at = now() where claim_id = $1`,
        [claimId, RECORD_NETWORK]
      );
      return unavailableResponse(res, claim, 'records_unavailable', {
        public_key_matches: resolved['cl.sig.pub'] === claim.tenant_signer_public_key,
        kid_matches: resolved['cl.sig.kid'] === claim.tenant_signer_kid,
        canonicalization_matches: resolved['cl.sig.canonical'] === claim.tenant_signer_canonicalization,
        signer_matches: resolved['cl.receipt.signer'] === claim.tenant_signer_ens,
      });
    }

    const { checks, verified } = compareSignerRecords(claim, resolved);
    const status = verified ? 'records_verified' : 'records_mismatch';
    await db.query(
      `update claim_requests
       set tenant_signer_record_status = $2, tenant_signer_records_network = $3,
           tenant_signer_records_verified_at = case when $2 = 'records_verified' then now() else null end,
           tenant_signer_verification_error = case when $2 = 'records_verified' then null else 'required_txt_record_mismatch' end,
           managed_ens_publication_status = case when activation_mode = 'managed_namespace' and $2 = 'records_verified' then 'verified' else managed_ens_publication_status end,
           updated_at = now()
       where claim_id = $1`,
      [claimId, status, RECORD_NETWORK]
    );

    return res.status(200).json(safeVerificationResponse({ status, signer: claim.tenant_signer_ens, checks }));
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'SIGNER_RECORD_VERIFICATION_FAILED' });
  }
};
