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
      `select
         cr.claim_id,
         cr.tenant,
         cr.authenticated_address,
         cr.activation_mode,
         cr.pack_id,
         cr.status,
         cr.created_at,
         count(ca.id)::int as agent_count
       from claim_requests cr
       left join claim_agents ca on ca.claim_id = cr.claim_id
       group by
         cr.claim_id,
         cr.tenant,
         cr.authenticated_address,
         cr.activation_mode,
         cr.pack_id,
         cr.status,
         cr.created_at
       order by cr.created_at desc
       limit $1`,
      [limit]
    );

    const claims = result.rows.map((row) => ({
      claimId: row.claim_id,
      tenant: row.tenant,
      authenticatedAddress: row.authenticated_address,
      activationMode: row.activation_mode,
      packId: row.pack_id,
      status: row.status,
      agentCount: Number(row.agent_count || 0),
      createdAt: row.created_at
    }));

    return res.status(200).json({ ok: true, claims });
  } catch (error) {
    console.error('ADMIN_CLAIMS_QUERY_FAILED', { message: error.message, code: error.code });
    return res.status(500).json({ ok: false, status: 'ADMIN_CLAIMS_QUERY_FAILED', error: 'Failed to load claims.' });
  }
};
