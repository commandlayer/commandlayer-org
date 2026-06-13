'use strict';

const db = require('../../lib/db');
const { getClaimAuth, unauthorizedClaimResponse, stripClaimSecrets } = require('../../lib/claims/access-token');

function cardsStatus(cards) {
  if (!cards.length) return 'not_pinned';
  if (cards.every((c) => c.card_cid && c.card_ipfs_uri && c.card_sha256)) return 'cards_pinned';
  return 'cards_pending';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  const claimId = req.query && (req.query.claim_id || req.query.claimId);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  try {
    const claimResult = await db.query(
      `select claim_id, claim_access_token_hash, tenant, activation_mode, status, payment_status, paid_at,
        tenant_signer_ens, tenant_signer_record_status, tenant_signer_records_verified_at, tenant_signer_records_network,
        tenant_signer_txt_records, managed_ens_publication_status, managed_ens_parent_namespace,
        managed_ens_parent_authority_audited, tenant_proof_status, tenant_proof_signer, tenant_proof_verified_at,
        genesis_receipt_id, genesis_generated_at, first_action_receipt_status, first_action_receipt_id, first_action_receipt_hash, first_action_receipt_error
       from claim_requests where claim_id = $1 limit 1`,
      [claimId]
    );
    const claim = claimResult.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    const auth = getClaimAuth(req, claim);
    if (!auth.ok) return unauthorizedClaimResponse(res);
    let cards = [];
    try {
      const cardsResult = await db.query(
        `select ens, card_cid, card_ipfs_uri, card_gateway_url, card_sha256, pin_status from agent_cards where claim_id = $1 order by ens asc`,
        [claimId]
      );
      cards = cardsResult.rows;
    } catch (_error) {
      cards = [];
    }
    const paymentConfirmed = claim.status === 'paid' || claim.status === 'cards_pinned' || claim.status === 'active' || claim.payment_status === 'paid' || Boolean(claim.paid_at);
    const pipeline = {
      tenant_signing_identity: claim.tenant_signer_ens ? 'generated' : 'missing',
      claim_request: 'created',
      payment: paymentConfirmed ? 'paid' : (claim.payment_status || 'unpaid'),
      ens_records: claim.tenant_signer_record_status || 'records_pending',
      agent_cards: cardsStatus(cards),
      genesis_receipt: claim.genesis_receipt_id ? 'generated' : 'not_generated',
      tenant_action_proof: claim.tenant_proof_status || 'not_submitted',
      first_action_receipt: claim.first_action_receipt_status || 'not_generated',
      agent_live: paymentConfirmed && claim.tenant_signer_record_status === 'records_verified' && cardsStatus(cards) === 'cards_pinned' && claim.genesis_receipt_id && claim.tenant_proof_status === 'verified' && (claim.first_action_receipt_status === 'verified' || typeof claim.first_action_receipt_status === 'undefined') ? 'live' : 'not_live',
    };
    return res.status(200).json({ ok: true, read_only: true, claim: { ...stripClaimSecrets(claim), cardsStatus: cardsStatus(cards) }, pipeline, cards });
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'CLAIM_STATUS_UNAVAILABLE' });
  }
};
