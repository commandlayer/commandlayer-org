'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) {
    return;
  }

  const claimId = req.query && req.query.claimId;
  if (!claimId || typeof claimId !== 'string') {
    return res.status(400).json({ ok: false, status: 'INVALID_CLAIM_ID' });
  }

  try {
    const claimRows = db.normalizeRows(
      await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId])
    );
    if (!claimRows.length) {
      return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    }

    const agentRows = db.normalizeRows(
      await db.query('select * from claim_agents where claim_id = $1 order by capability asc', [claimId])
    );
    const eventRows = db.normalizeRows(
      await db.query('select * from claim_events where claim_id = $1 order by created_at asc', [claimId])
    );
    const transitionRows = db.normalizeRows(
      await db.query('select * from claim_status_transitions where claim_id = $1 order by created_at asc', [claimId])
    );
    const cardRows = db.normalizeRows(
      await db.query('select * from agent_cards where claim_id = $1 order by ens asc', [claimId])
    );

    return res.status(200).json({
      ok: true,
      claim: claimRows[0],
      agents: agentRows,
      events: eventRows,
      transitions: transitionRows,
      cards: cardRows
    });
  } catch (error) {
    console.error('ADMIN_CLAIM_QUERY_FAILED', { message: error.message, code: error.code });
    const payload = { ok: false, status: 'ADMIN_CLAIM_QUERY_FAILED', error: 'Failed to load claim.' };
    if (process.env.NODE_ENV !== 'production') {
      payload.debug = {
        message: error.message,
        code: error.code
      };
    }
    return res.status(500).json(payload);
  }
};
