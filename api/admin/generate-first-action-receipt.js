'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');
const { buildFirstActionReceiptChallenge } = require('../../lib/receipts/first-action-receipt');

function paidOrApproved(claim) {
  return claim.payment_status === 'paid' || Boolean(claim.paid_at) || ['paid', 'cards_pinned', 'active', 'activation_approved'].includes(claim.status);
}

function preflight(claim) {
  if (!paidOrApproved(claim)) return 'FIRST_ACTION_REQUIRES_PAID_CLAIM';
  if (!claim.tenant_signer_ens || !claim.tenant_signer_kid) return 'TENANT_SIGNER_ENS_REQUIRED';
  if (claim.tenant_signer_record_status !== 'records_verified' && claim.tenant_signer_record_status !== 'verified') return 'TENANT_SIGNER_RECORDS_NOT_VERIFIED';
  if (!claim.genesis_receipt_id) return 'GENESIS_RECEIPT_REQUIRED';
  if ('tenant_proof_status' in claim && claim.tenant_proof_status && claim.tenant_proof_status !== 'verified') return 'TENANT_PROOF_NOT_VERIFIED';
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' }); }
  if (!requireAdminAuth(req, res)) return;
  const claimId = req.body && req.body.claimId;
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  const claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
  const claim = claimResult.rows[0];
  if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
  const failed = preflight(claim);
  if (failed) return res.status(400).json({ ok: false, status: failed });

  const agentsResult = await db.query('select ens, capability from claim_agents where claim_id = $1 order by id asc', [claimId]);
  const challenge = await buildFirstActionReceiptChallenge({ claim, agents: agentsResult.rows });
  await db.query(
    `update claim_requests
     set first_action_receipt_json = $2::jsonb,
         first_action_receipt_id = $3,
         first_action_receipt_hash = null,
         first_action_receipt_status = 'challenge_ready',
         first_action_receipt_verified_at = null,
         first_action_receipt_error = null,
         updated_at = now()
     where claim_id = $1`,
    [claimId, JSON.stringify(challenge), challenge.receipt_id]
  );
  return res.status(200).json({ ok: true, claimId, status: 'challenge_ready', receipt_id: challenge.receipt_id, challenge, note: 'Non-custodial flow: tenant signs this payload locally and submits the signed scoped execution receipt.' });
};
