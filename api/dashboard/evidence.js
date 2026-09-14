'use strict';

const SERVICE_IDS = ['compareagent', 'documentagent', 'parseagent', 'monitoragent', 'trackagent'];
const WINDOWS = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };

function emptyTotals() {
  return { paid_executions: 0, passed: 0, partial: 0, failed: 0, settled_amount_atomic: '0', distinct_payers: 0, self_related_executions: 0, evidence_covered_executions: 0, currency: 'USDC' };
}

function emptyReport(status, window) {
  return { schema: 'commandlayer.live-evidence-dashboard.v2', ok: status === 'LIVE', status, live: status === 'LIVE', window, updated_at: null, services: [], totals: emptyTotals(), trend: [], recent: [] };
}

function buildLiveEvidencePayload(rows, payerCount, trend, recent, window) {
  const byService = new Map(SERVICE_IDS.map((id) => [id, { service_id: id, paid_executions: 0, passed: 0, partial: 0, failed: 0, settled_amount_atomic: '0', distinct_payers: 0, self_related_executions: 0, evidence_covered_executions: 0, currency: 'USDC' }]));
  const totals = emptyTotals();
  const currencies = new Set();

  for (const row of rows) {
    const service = byService.get(String(row.service_id));
    if (!service) continue;
    const amount = BigInt(String(row.settled_amount_atomic || '0'));
    service.paid_executions = Number(row.paid_executions || 0);
    service.passed = Number(row.passed || 0);
    service.partial = Number(row.partial || 0);
    service.failed = Number(row.failed || 0);
    service.settled_amount_atomic = amount.toString();
    service.distinct_payers = Number(row.distinct_payers || 0);
    service.self_related_executions = Number(row.self_related_executions || 0);
    service.evidence_covered_executions = Number(row.evidence_covered_executions || 0);
    service.currency = row.currency ? String(row.currency) : 'USDC';
    totals.paid_executions += service.paid_executions;
    totals.passed += service.passed;
    totals.partial += service.partial;
    totals.failed += service.failed;
    totals.settled_amount_atomic = (BigInt(totals.settled_amount_atomic) + amount).toString();
    totals.self_related_executions += service.self_related_executions;
    totals.evidence_covered_executions += service.evidence_covered_executions;
    currencies.add(service.currency);
  }
  totals.distinct_payers = Number(payerCount || 0);
  totals.currency = currencies.size === 1 ? Array.from(currencies)[0] : null;
  return {
    schema: 'commandlayer.live-evidence-dashboard.v2',
    ok: true,
    status: 'LIVE',
    live: true,
    window,
    updated_at: new Date().toISOString(),
    services: Array.from(byService.values()),
    totals,
    trend: (trend || []).map((row) => ({ day: row.day, paid_executions: Number(row.paid_executions || 0), settled_amount_atomic: String(row.settled_amount_atomic || '0') })),
    recent: (recent || []).map((row) => ({ service_id: String(row.service_id), outcome: String(row.outcome), amount_atomic: String(row.amount_atomic || '0'), currency: String(row.currency || 'USDC'), evidence_covered: Number(row.evidence_reference_count || 0) > 0, created_at: row.created_at }))
  };
}

function getWindow(value) {
  return WINDOWS[value] ? value : '30d';
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  const window = getWindow(req.query && req.query.window);
  res.setHeader('Cache-Control', 'no-store');
  const databaseUrl = process.env.COMMANDLAYER_DASHBOARD_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return res.status(200).json(emptyReport('DATA_SOURCE_NOT_CONNECTED', window));

  try {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    const interval = WINDOWS[window];
    const base = "settlement_status = 'CONFIRMED' AND service_id = ANY($1::text[]) AND created_at >= NOW() - ($2 || ' days')::interval";
    const params = [SERVICE_IDS, window === '24h' ? '1' : window === '7d' ? '7' : '30'];
    const aggregates = await sql.query("SELECT service_id, COUNT(*)::int AS paid_executions, COUNT(*) FILTER (WHERE outcome = 'passed')::int AS passed, COUNT(*) FILTER (WHERE outcome = 'partial')::int AS partial, COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed, COALESCE(SUM(amount_atomic), 0)::text AS settled_amount_atomic, COUNT(DISTINCT payer_key_hash)::int AS distinct_payers, COUNT(*) FILTER (WHERE related_party_status = 'RELATED')::int AS self_related_executions, COUNT(*) FILTER (WHERE evidence_reference_count > 0)::int AS evidence_covered_executions, MAX(currency) AS currency FROM reputation_events WHERE " + base + " GROUP BY service_id", params);
    const payerResult = await sql.query("SELECT COUNT(DISTINCT payer_key_hash)::int AS distinct_payers FROM reputation_events WHERE " + base, params);
    const trendResult = await sql.query("SELECT DATE_TRUNC('day', created_at)::date::text AS day, COUNT(*)::int AS paid_executions, COALESCE(SUM(amount_atomic), 0)::text AS settled_amount_atomic FROM reputation_events WHERE " + base + " GROUP BY 1 ORDER BY 1", params);
    const recentResult = await sql.query("SELECT service_id, outcome, amount_atomic::text, currency, evidence_reference_count, created_at FROM reputation_events WHERE " + base + " ORDER BY created_at DESC LIMIT 12", params);
    const rows = Array.isArray(aggregates) ? aggregates : (aggregates.rows || []);
    const payerRows = Array.isArray(payerResult) ? payerResult : (payerResult.rows || []);
    const trends = Array.isArray(trendResult) ? trendResult : (trendResult.rows || []);
    const recent = Array.isArray(recentResult) ? recentResult : (recentResult.rows || []);
    return res.status(200).json(buildLiveEvidencePayload(rows, payerRows[0] && payerRows[0].distinct_payers, trends, recent, window));
  } catch (error) {
    console.error('dashboard evidence data source unavailable');
    return res.status(200).json(emptyReport('DATA_SOURCE_UNAVAILABLE', window));
  }
}

module.exports = handler;
module.exports.buildLiveEvidencePayload = buildLiveEvidencePayload;
module.exports.emptyReport = emptyReport;
