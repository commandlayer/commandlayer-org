'use strict';

const db = require('../../lib/db');
const { getClaimAuth, unauthorizedClaimResponse } = require('../../lib/claims/access-token');
const { requireRateLimit } = require('../../lib/rateLimit');
const { RECORD_NETWORK, resolveRequiredSignerRecords, compareSignerRecords, safeVerificationResponse } = require('../../lib/claims/signer-records');

function responseForAttempt(res, claim, attemptStatus, checks) {
  const storedStatus = claim.tenant_signer_record_status || 'records_pending';
  const protectedVerified = storedStatus === 'records_verified' && attemptStatus !== 'records_verified';
  const payload = safeVerificationResponse({
    status: protectedVerified ? 'records_verified' : attemptStatus,
    signer: claim.tenant_signer_ens,
    checks,
  });
  if (protectedVerified) payload.attempt_status = attemptStatus;
  return res.status(200).json(payload);
}

async function persistAttempt(claim, attemptStatus, errorCode) {
  if (claim.tenant_signer_record_status === 'records_verified' && attemptStatus !== 'records_verified') return;
  await db.query(
    `update claim_requests
     set tenant_signer_record_status = $2, tenant_signer_records_network = $3,
         tenant_signer_records_verified_at = case when $2 = 'records_verified' then coalesce(tenant_signer_records_verified_at, now()) else null end,
         tenant_signer_verification_error = case when $2 = 'records_verified' then null else $4 end,
         managed_ens_publication_status = case when activation_mode = 'managed_namespace' and $2 = 'records_verified' then 'verified' else managed_ens_publication_status end,
         updated_at = now()
     where claim_id = $1`,
    [claim.claim_id, attemptStatus, RECORD_NETWORK, errorCode || null]
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireRateLimit(req, res, { bucket: 'claim-signer-records', max: 60, windowMs: 60_000 })) return;

  const claimId = req.body && (req.body.claim_id || req.body.claimId);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  try {
    const result = await db.query(
      `select claim_id, claim_access_token_hash, tenant_signer_ens, tenant_signer_public_key, tenant_signer_kid,
              tenant_signer_canonicalization, tenant_signer_record_status
       from claim_requests where claim_id = $1 limit 1`,
      [claimId]
    );
    const claim = result.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    const auth = getClaimAuth(req, claim);
    if (!auth.ok) return unauthorizedClaimResponse(res);

    if (!claim.tenant_signer_ens || !claim.tenant_signer_public_key || !claim.tenant_signer_kid || !claim.tenant_signer_canonicalization) {
      const checks = { public_key_matches: false, kid_matches: false, canonicalization_matches: false, signer_matches: false };
      await persistAttempt(claim, 'records_pending', 'signer_identity_missing');
      return responseForAttempt(res, claim, 'records_pending', checks);
    }

    let resolved;
    try {
      resolved = await resolveRequiredSignerRecords(claim.tenant_signer_ens, { allowLocalFallback: false });
    } catch (_error) {
      const checks = { public_key_matches: false, kid_matches: false, canonicalization_matches: false, signer_matches: false };
      await persistAttempt(claim, 'records_unavailable', 'ens_resolution_unavailable');
      return responseForAttempt(res, claim, 'records_unavailable', checks);
    }

    const checks = {
      public_key_matches: resolved['cl.sig.pub'] === claim.tenant_signer_public_key,
      kid_matches: resolved['cl.sig.kid'] === claim.tenant_signer_kid,
      canonicalization_matches: resolved['cl.sig.canonical'] === claim.tenant_signer_canonicalization,
      signer_matches: resolved['cl.receipt.signer'] === claim.tenant_signer_ens,
    };

    const missing = Object.values(resolved).some((value) => !value);
    if (missing) {
      await persistAttempt(claim, 'records_unavailable', 'required_txt_record_missing');
      return responseForAttempt(res, claim, 'records_unavailable', checks);
    }

    const { verified } = compareSignerRecords(claim, resolved);
    const attemptStatus = verified ? 'records_verified' : 'records_mismatch';
    await persistAttempt(claim, attemptStatus, verified ? null : 'required_txt_record_mismatch');
    return responseForAttempt(res, claim, attemptStatus, checks);
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'SIGNER_RECORD_VERIFICATION_FAILED' });
  }
};
