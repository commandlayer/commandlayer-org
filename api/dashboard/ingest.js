'use strict';

const SERVICE_IDS = new Set(['compareagent', 'documentagent', 'parseagent', 'monitoragent', 'trackagent']);
const OUTCOMES = new Set(['passed', 'partial', 'failed']);
const RELATED = new Set(['NOT_ASSERTED', 'NOT_RELATED', 'RELATED']);

function fail(res, status, code) {
  return res.status(status).json({ ok: false, status: code });
}

function validString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED');
  }
  const expected = process.env.COMMANDLAYER_DASHBOARD_INGEST_TOKEN;
  const auth = req.headers.authorization || '';
  if (!expected || auth !== 'Bearer ' + expected) return fail(res, 401, 'UNAUTHORIZED');

  const body = req.body || {};
  if (!SERVICE_IDS.has(body.service_id) || !validString(body.service_version, 120) || !validString(body.manifest_hash, 200) || !validString(body.execution_id, 160) || !OUTCOMES.has(body.outcome) || body.settlement_status !== 'CONFIRMED' || !/^[0-9]+$/.test(String(body.amount_atomic)) || !validString(body.currency, 20) || !validString(body.payer_key_hash, 200) || !RELATED.has(body.related_party_status || 'NOT_ASSERTED') || !Number.isInteger(body.evidence_reference_count) || body.evidence_reference_count < 0 || body.evidence_reference_count > 100) {
    return fail(res, 400, 'INVALID_EVIDENCE_EVENT');
  }

  const databaseUrl = process.env.COMMANDLAYER_DASHBOARD_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return fail(res, 503, 'DATA_SOURCE_NOT_CONNECTED');

  try {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    await sql.query(
      "INSERT INTO reputation_events (event_id, service_id, service_version, manifest_hash, execution_id, outcome, settlement_status, amount_atomic, currency, payer_key_hash, evidence_reference_count, related_party_status, network, transaction_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (execution_id) DO NOTHING",
      [body.event_id || body.execution_id, body.service_id, body.service_version, body.manifest_hash, body.execution_id, body.outcome, body.settlement_status, String(body.amount_atomic), body.currency, body.payer_key_hash, body.evidence_reference_count, body.related_party_status || 'NOT_ASSERTED', body.network || null, body.transaction_hash || null]
    );
    return res.status(201).json({ ok: true, status: 'RECORDED', execution_id: body.execution_id });
  } catch (error) {
    console.error('dashboard evidence ingestion failed');
    return fail(res, 503, 'DATA_SOURCE_UNAVAILABLE');
  }
}

module.exports = handler;
