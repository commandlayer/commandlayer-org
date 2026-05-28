'use strict';

const db = require('../../lib/db');
const { resolveReceiptSigningConfigFromEnv, hasValidSigningConfig } = require('../../lib/receiptSigning');
const { createGenesisReceipt } = require('../../lib/receipts/create-genesis-receipt');
const { requireAdminAuth } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) return;

  const claimId = req.body && req.body.claimId;
  const force = Boolean(req.body && req.body.force);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  const signingCfg = resolveReceiptSigningConfigFromEnv();
  if (!hasValidSigningConfig(signingCfg)) return res.status(503).json({ ok: false, status: 'SIGNING_UNAVAILABLE' });

  const claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
  const claim = claimResult.rows[0];
  if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
  if (claim.status !== 'cards_pinned') return res.status(400).json({ ok: false, status: 'GENESIS_REQUIRES_CARDS_PINNED' });
  if (claim.genesis_receipt_id && !force) return res.status(409).json({ ok: false, status: 'GENESIS_RECEIPT_ALREADY_EXISTS' });

  const cardsResult = await db.query(
    `select ens, card_cid, card_ipfs_uri, card_gateway_url, card_sha256
     from agent_cards where claim_id = $1 and status = 'published' order by updated_at asc`,
    [claimId]
  );

  if (!cardsResult.rows.length) return res.status(400).json({ ok: false, status: 'GENESIS_REQUIRES_PINNED_CARDS' });
  const missingPinned = cardsResult.rows.some((r) => !r.card_cid || !r.card_ipfs_uri || !r.card_gateway_url || !r.card_sha256);
  if (missingPinned) return res.status(400).json({ ok: false, status: 'GENESIS_REQUIRES_PINNED_CARDS' });

  const firstAgent = cardsResult.rows[0].ens || '';
  const [label, namespace] = firstAgent.split('.');
  const { receipt, receiptHash, receiptChainRoot, generatedAt } = await createGenesisReceipt({
    claimId,
    label,
    namespace,
    owner: claim.authenticated_address,
    verbs: ['verify', 'attest'],
    agentCardHash: cardsResult.rows[0].card_sha256,
    agentCardCid: cardsResult.rows[0].card_ipfs_uri,
    signerId: signingCfg.signerId,
    kid: signingCfg.kid,
    privateKeyPem: signingCfg.privateKeyPem
  });

  await db.query(
    `update claim_requests
     set genesis_receipt_json = $2::jsonb,
         genesis_receipt_hash = $3,
         genesis_receipt_id = $4,
         genesis_generated_at = $5::timestamptz,
         receipt_chain_root = $6,
         updated_at = now()
     where claim_id = $1`,
    [claimId, JSON.stringify(receipt), receiptHash, receipt.receipt_id, generatedAt, receiptChainRoot]
  );

  return res.status(200).json({ ok: true, claimId, receipt_id: receipt.receipt_id, receipt_hash: receiptHash, receipt_chain_root: receiptChainRoot, chain_root: receiptChainRoot, generated_at: generatedAt, receipt, cards: cardsResult.rows });
};
