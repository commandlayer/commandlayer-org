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

  const requestedLimit = Number.parseInt(req.query && req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 200)
    : 50;

  try {
    const result = await db.query(
      `select claim_id, tenant, authenticated_address, activation_mode, pack_id, status, created_at
       from claim_requests
       order by created_at desc
       limit $1`,
      [limit]
    );

    const claims = [];
    for (const row of result.rows) {
      const countResult = await db.query(
        'select count(*)::int as agent_count from claim_agents where claim_id = $1',
        [row.claim_id]
      );
      const agentCount = countResult.rows && countResult.rows[0] ? Number(countResult.rows[0].agent_count || 0) : 0;
      claims.push({
        claimId: row.claim_id,
        tenant: row.tenant,
        authenticatedAddress: row.authenticated_address,
        activationMode: row.activation_mode,
        packId: row.pack_id,
        status: row.status,
        agentCount,
        createdAt: row.created_at
      });
    }

    return res.status(200).json({ ok: true, claims });
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'ADMIN_CLAIMS_QUERY_FAILED' });
  }
};
