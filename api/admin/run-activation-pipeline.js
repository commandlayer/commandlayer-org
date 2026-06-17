'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');
const pinAgentCards = require('./pin-agent-cards');
const generateGenesisReceipt = require('./generate-genesis-receipt');
const generateFirstActionReceipt = require('./generate-first-action-receipt');

function makeInternalRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function runHandler(handler, req) {
  const res = makeInternalRes();
  await handler(req, res);
  return res;
}

function paymentStep(claim) {
  return claim.status === 'paid' || claim.status === 'cards_pinned' || claim.payment_status === 'paid' || claim.paid_at ? 'already_paid' : 'payment_required';
}

function recordsVerified(claim) {
  return claim.tenant_signer_record_status === 'records_verified' || claim.tenant_signer_record_status === 'verified';
}

function canAttemptFirstAction(claim) {
  if (!claim.genesis_receipt_id) return false;
  if (!recordsVerified(claim)) return false;
  if ('tenant_proof_status' in claim && claim.tenant_proof_status && claim.tenant_proof_status !== 'verified') return false;
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) return;

  const claimId = req.body && (req.body.claimId || req.body.claim_id);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  try {
    let claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    let claim = claimResult.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    const steps = {
      payment: paymentStep(claim),
      managed_ens_publication: claim.managed_ens_publication_status || (claim.activation_mode === 'managed_namespace' ? 'not_started' : 'not_applicable'),
      ens_records: claim.tenant_signer_record_status || 'records_pending',
      agent_cards: 'not_started',
      genesis_receipt: claim.genesis_receipt_id ? 'already_generated' : 'not_started',
      tenant_action_proof: claim.tenant_proof_status || 'not_submitted',
      first_action_receipt: claim.first_action_receipt_status || 'not_generated',
      errors: {},
    };

    if (steps.payment !== 'already_paid') {
      return res.status(200).json({ ok: true, claim_id: claimId, steps });
    }

    let cardsResult = await db.query(
      `select ens, card_cid, card_ipfs_uri, card_sha256 from agent_cards where claim_id = $1 and status = 'published'`,
      [claimId]
    );
    const cardsPinned = cardsResult.rows.length > 0 && cardsResult.rows.every((c) => c.card_cid && c.card_ipfs_uri && c.card_sha256);
    if (cardsPinned) {
      steps.agent_cards = 'cards_pinned';
    } else {
      const pinRes = await runHandler(pinAgentCards, { method: 'POST', headers: { 'x-admin-api-key': req.headers['x-admin-api-key'] || process.env.ADMIN_API_KEY }, body: { claimId } });
      if (pinRes.statusCode >= 200 && pinRes.statusCode < 300) {
        steps.agent_cards = pinRes.body && pinRes.body.status === 'ALREADY_PINNED' ? 'cards_pinned' : 'cards_pinned';
      } else {
        steps.agent_cards = pinRes.body && pinRes.body.status ? pinRes.body.status : 'pinning_not_completed';
        steps.errors.agent_cards = steps.agent_cards;
      }
    }

    claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    claim = claimResult.rows[0] || claim;
    if (claim.genesis_receipt_id) {
      steps.genesis_receipt = 'already_generated';
    } else if (steps.agent_cards === 'cards_pinned' || claim.status === 'cards_pinned') {
      const genesisRes = await runHandler(generateGenesisReceipt, { method: 'POST', headers: { 'x-admin-api-key': req.headers['x-admin-api-key'] || process.env.ADMIN_API_KEY }, body: { claimId } });
      if (genesisRes.statusCode >= 200 && genesisRes.statusCode < 300) {
        steps.genesis_receipt = 'generated';
      } else if (genesisRes.statusCode === 409 && genesisRes.body && genesisRes.body.status === 'GENESIS_RECEIPT_ALREADY_EXISTS') {
        steps.genesis_receipt = 'already_generated';
      } else {
        steps.genesis_receipt = genesisRes.body && genesisRes.body.status ? genesisRes.body.status : 'not_generated';
        steps.errors.genesis_receipt = steps.genesis_receipt;
      }
    }

    claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    claim = claimResult.rows[0] || claim;
    if (claim.first_action_receipt_status === 'verified') {
      steps.first_action_receipt = 'verified';
    } else if (claim.first_action_receipt_status === 'challenge_ready') {
      steps.first_action_receipt = 'challenge_ready';
    } else if (canAttemptFirstAction(claim)) {
      const firstActionRes = await runHandler(generateFirstActionReceipt, { method: 'POST', headers: { 'x-admin-api-key': req.headers['x-admin-api-key'] || process.env.ADMIN_API_KEY }, body: { claimId } });
      if (firstActionRes.statusCode >= 200 && firstActionRes.statusCode < 300) {
        steps.first_action_receipt = firstActionRes.body && firstActionRes.body.status ? firstActionRes.body.status : 'challenge_ready';
      } else {
        steps.first_action_receipt = firstActionRes.body && firstActionRes.body.status ? firstActionRes.body.status : 'not_generated';
        steps.errors.first_action_receipt = steps.first_action_receipt;
      }
    }

    return res.status(200).json({ ok: true, claim_id: claimId, steps });
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'ACTIVATION_PIPELINE_FAILED' });
  }
};
