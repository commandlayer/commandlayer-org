'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

async function hasTable(tableName) {
  const result = await db.query('select to_regclass($1) as table_name', [tableName]);
  return Boolean(result.rows[0] && result.rows[0].table_name);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) return;

  const claimId = req.query && typeof req.query.claimId === 'string' ? req.query.claimId.trim() : '';
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  const claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
  const claim = claimResult.rows[0];
  if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

  const agentsResult = await db.query('select * from claim_agents where claim_id = $1 order by created_at asc', [claimId]);
  const eventsResult = await db.query('select * from claim_events where claim_id = $1 order by created_at desc', [claimId]);

  let transitions = [];
  if (await hasTable('claim_status_transitions')) {
    const transitionsResult = await db.query('select * from claim_status_transitions where claim_id = $1 order by created_at desc', [claimId]);
    transitions = transitionsResult.rows;
  }

  let cards = [];
  if (await hasTable('agent_cards')) {
    const cardsResult = await db.query('select * from agent_cards where claim_id = $1 order by created_at asc', [claimId]);
    cards = cardsResult.rows;
  }

  let latestPayment = null;
  if (await hasTable('claim_payments')) {
    const paymentResult = await db.query('select * from claim_payments where claim_id = $1 order by created_at desc limit 1', [claimId]);
    latestPayment = paymentResult.rows[0] || null;
  }

  return res.status(200).json({ ok: true, claim, agents: agentsResult.rows, events: eventsResult.rows, transitions, cards, latestPayment });
};
