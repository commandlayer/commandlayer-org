'use strict';

const db = require('../../lib/db');
const { getClaimAuth, unauthorizedClaimResponse } = require('../../lib/claims/access-token');
const { requireRateLimit } = require('../../lib/rateLimit');
const { verifyFirstActionReceipt } = require('../../lib/receipts/first-action-receipt');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' }); }
  if (!requireRateLimit(req, res, { bucket: 'claim-first-action-receipt', max: 30, windowMs: 60_000 })) return;
  const claimId = req.body && (req.body.claim_id || req.body.claimId);
  const receipt = req.body && req.body.receipt;
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  if (!receipt) return res.status(400).json({ ok: false, status: 'RECEIPT_REQUIRED' });
  const claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
  const claim = claimResult.rows[0];
  if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
  const auth = getClaimAuth(req, claim);
  if (!auth.ok) return unauthorizedClaimResponse(res);
  if (claim.tenant_signer_record_status !== 'records_verified') return res.status(400).json({ ok: false, status: 'TENANT_SIGNER_RECORDS_NOT_VERIFIED' });

  const verification = await verifyFirstActionReceipt(receipt, claim);
  if (!verification.ok) {
    await db.query(`update claim_requests set first_action_receipt_status = 'failed', first_action_receipt_error = $2, updated_at = now() where claim_id = $1`, [claimId, verification.error || verification.status]);
    return res.status(400).json({ ok: false, status: verification.status, error: verification.error });
  }
  await db.query(
    `update claim_requests
     set first_action_receipt_json = $2::jsonb,
         first_action_receipt_id = $3,
         first_action_receipt_hash = $4,
         first_action_receipt_status = 'verified',
         first_action_receipt_verified_at = now(),
         first_action_receipt_error = null,
         updated_at = now()
     where claim_id = $1`,
    [claimId, JSON.stringify(receipt), verification.receipt_id, verification.hash]
  );
  return res.status(200).json({ ok: true, status: 'verified', receipt_id: verification.receipt_id, receipt_hash: verification.hash });
};
