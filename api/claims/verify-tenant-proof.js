'use strict';

const db = require('../../lib/db');
const { getClaimAuth, unauthorizedClaimResponse } = require('../../lib/claims/access-token');
const { requireRateLimit } = require('../../lib/rateLimit');
const { verifyReceipt } = require('../../lib/verifyReceipt');

async function persistTenantProofAttempt(claim, attemptStatus, signer) {
  if (claim.tenant_proof_status === 'verified' && attemptStatus !== 'verified') return;
  await db.query(
    `update claim_requests
     set tenant_proof_status = $2, tenant_proof_signer = $3,
         tenant_proof_verified_at = case when $2 = 'verified' then coalesce(tenant_proof_verified_at, now()) else null end,
         updated_at = now()
     where claim_id = $1`,
    [claim.claim_id, attemptStatus, signer || null]
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireRateLimit(req, res, { bucket: 'claim-tenant-proof', max: 30, windowMs: 60_000 })) return;

  const claimId = req.body && (req.body.claim_id || req.body.claimId);
  const receipt = req.body && req.body.receipt;
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  if (!receipt) return res.status(400).json({ ok: false, status: 'RECEIPT_REQUIRED' });

  try {
    const claimResult = await db.query(
      `select claim_id, claim_access_token_hash, tenant_signer_ens, tenant_proof_status
       from claim_requests where claim_id = $1 limit 1`,
      [claimId]
    );
    const claim = claimResult.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    const auth = getClaimAuth(req, claim);
    if (!auth.ok) return unauthorizedClaimResponse(res);

    const verification = await verifyReceipt(receipt, req.verifyOptions || {});
    const sameSigner = Boolean(verification.ok && verification.signer && verification.signer === claim.tenant_signer_ens);
    const attemptStatus = sameSigner ? 'verified' : 'invalid';
    await persistTenantProofAttempt(claim, attemptStatus, verification.signer || null);

    const protectedVerified = claim.tenant_proof_status === 'verified' && attemptStatus !== 'verified';
    return res.status(200).json({
      ok: sameSigner,
      status: protectedVerified ? 'verified' : attemptStatus,
      attempt_status: protectedVerified ? attemptStatus : undefined,
      signer: verification.signer || null,
      expected_signer: claim.tenant_signer_ens,
      verification_status: verification.status,
    });
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'TENANT_PROOF_VERIFICATION_FAILED' });
  }
};
