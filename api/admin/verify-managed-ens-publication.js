'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');
const { verifyManagedEnsPublication } = require('../../lib/claims/managed-ens-publication');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' }); }
  if (!requireAdminAuth(req, res)) return;
  const claimId = req.body && (req.body.claim_id || req.body.claimId);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  try {
    const result = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    const claim = result.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    const verification = await verifyManagedEnsPublication(claim, req.verifyOptions || {});
    if (verification.ok) {
      await db.query(
        `update claim_requests
         set managed_ens_publication_status = 'verified', tenant_signer_record_status = 'records_verified',
             tenant_signer_records_verified_at = now(), managed_ens_verified_at = now(),
             managed_ens_publication_error = null, tenant_signer_verification_error = null, updated_at = now()
         where claim_id = $1`,
        [claimId]
      );
    } else {
      await db.query(
        `update claim_requests
         set managed_ens_publication_status = $2, managed_ens_publication_error = $3,
             tenant_signer_verification_error = $3, updated_at = now()
         where claim_id = $1`,
        [claimId, verification.status, verification.error]
      );
    }
    return res.status(200).json({ ok: true, claim_id: claimId, verification });
  } catch (error) {
    try { await db.query(`update claim_requests set managed_ens_publication_status = 'failed', managed_ens_publication_error = $2, updated_at = now() where claim_id = $1`, [claimId, error.message]); } catch (_) {}
    return res.status(400).json({ ok: false, status: error.status || 'MANAGED_ENS_PUBLICATION_VERIFY_FAILED', error: error.message });
  }
};
