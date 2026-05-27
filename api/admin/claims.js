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

  if (!requireAdminAuth(req, res)) return;

  const result = await db.query(
    `select
      cr.claim_id,
      cr.tenant,
      cr.authenticated_address,
      cr.pack_id,
      cr.status,
      cr.payment_status,
      cr.created_at,
      cr.paid_at,
      cr.stripe_checkout_session_id,
      coalesce(ca.agent_count, 0)::int as agent_count
     from claim_requests cr
     left join (
       select claim_id, count(*)::int as agent_count
       from claim_agents
       group by claim_id
     ) ca on ca.claim_id = cr.claim_id
     order by cr.created_at desc`
  );

  const claims = result.rows.map((row) => ({
    claimId: row.claim_id,
    tenant: row.tenant,
    wallet: row.authenticated_address,
    packId: row.pack_id,
    status: row.status,
    paymentStatus: row.payment_status,
    agentCount: row.agent_count,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
  }));

  return res.status(200).json({ ok: true, claims });
};
