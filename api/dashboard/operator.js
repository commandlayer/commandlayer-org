'use strict';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  const expected = process.env.COMMANDLAYER_DASHBOARD_OPERATOR_TOKEN;
  if (!expected || req.headers.authorization !== 'Bearer ' + expected) {
    return res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
  }
  const databaseUrl = process.env.COMMANDLAYER_DASHBOARD_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return res.status(503).json({ ok: false, status: 'DATA_SOURCE_NOT_CONNECTED' });
  try {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    const result = await sql.query("SELECT event_id, service_id, execution_id, outcome, settlement_status, amount_atomic::text, currency, payer_key_hash, evidence_reference_count, related_party_status, network, transaction_hash, created_at FROM reputation_events ORDER BY created_at DESC LIMIT 100");
    const events = Array.isArray(result) ? result : (result.rows || []);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ schema: 'commandlayer.dashboard-operator.v1', ok: true, events });
  } catch (error) {
    console.error('dashboard operator data source unavailable');
    return res.status(503).json({ ok: false, status: 'DATA_SOURCE_UNAVAILABLE' });
  }
}
module.exports = handler;
