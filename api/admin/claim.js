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
    const claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    if (!claimResult.rows.length) {
      return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    }

    const agentsResult = await db.query(
      `select ens, capability, canonical_parent, skill, skill_family, created_at
       from claim_agents where claim_id = $1 order by created_at asc`,
      [claimId]
    );
    const eventsResult = await db.query(
      `select event_type, message, metadata_json, created_at
       from claim_events where claim_id = $1 order by created_at asc`,
      [claimId]
    );

    return res.status(200).json({
      ok: true,
      claim: claimResult.rows[0],
      agents: agentsResult.rows,
      events: eventsResult.rows
    });
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'ADMIN_CLAIM_QUERY_FAILED' });
  }
};
