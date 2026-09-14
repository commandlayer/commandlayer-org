'use strict';

const SERVICE_IDS = ['compareagent', 'documentagent', 'parseagent', 'monitoragent', 'trackagent'];

function emptyTotals() {
  return {
    paid_executions: 0,
    passed: 0,
    partial: 0,
    failed: 0,
    settled_amount_atomic: '0',
    distinct_payers: 0,
    self_related_executions: 0,
    evidence_covered_executions: 0,
    currency: 'USDC'
  };
}

function emptyReport(status) {
  return {
    schema: 'commandlayer.live-evidence-dashboard.v1',
    ok: status === 'LIVE',
    status,
    live: status === 'LIVE',
    updated_at: null,
    services: [],
    totals: emptyTotals()
  };
}

function buildLiveEvidencePayload(rows) {
  const byService = new Map();
  const payerSets = new Map();
  let totals = emptyTotals();
  const currencies = new Set();

  for (const id of SERVICE_IDS) {
    byService.set(id, {
      service_id: id,
      paid_executions: 0,
      passed: 0,
      partial: 0,
      failed: 0,
      settled_amount_atomic: '0',
      distinct_payers: 0,
      self_related_executions: 0,
      evidence_covered_executions: 0,
      currency: 'USDC'
    });
    payerSets.set(id, new Set());
  }

  for (const row of rows) {
    const service = byService.get(String(row.service_id));
    if (!service) continue;
    const count = Number(row.paid_executions || 0);
    const passed = Number(row.passed || 0);
    const partial = Number(row.partial || 0);
    const failed = Number(row.failed || 0);
    const amount = BigInt(String(row.settled_amount_atomic || '0'));
    const distinctPayers = Number(row.distinct_payers || 0);
    const related = Number(row.self_related_executions || 0);
    const evidence = Number(row.evidence_covered_executions || 0);
    const currency = row.currency ? String(row.currency) : 'USDC';

    service.paid_executions = count;
    service.passed = passed;
    service.partial = partial;
    service.failed = failed;
    service.settled_amount_atomic = amount.toString();
    service.distinct_payers = distinctPayers;
    service.self_related_executions = related;
    service.evidence_covered_executions = evidence;
    service.currency = currency;

    totals.paid_executions += count;
    totals.passed += passed;
    totals.partial += partial;
    totals.failed += failed;
    totals.settled_amount_atomic = (BigInt(totals.settled_amount_atomic) + amount).toString();
    totals.distinct_payers += distinctPayers;
    totals.self_related_executions += related;
    totals.evidence_covered_executions += evidence;
    currencies.add(currency);
  }

  totals.currency = currencies.size === 1 ? Array.from(currencies)[0] : null;
  return {
    schema: 'commandlayer.live-evidence-dashboard.v1',
    ok: true,
    status: 'LIVE',
    live: true,
    updated_at: new Date().toISOString(),
    services: Array.from(byService.values()),
    totals
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  res.setHeader('Cache-Control', 'no-store');
  const databaseUrl = process.env.COMMANDLAYER_DASHBOARD_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return res.status(200).json(emptyReport('DATA_SOURCE_NOT_CONNECTED'));

  try {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(databaseUrl);
    const result = await sql.query(
      "SELECT service_id, COUNT(*)::int AS paid_executions, COUNT(*) FILTER (WHERE outcome = 'passed')::int AS passed, COUNT(*) FILTER (WHERE outcome = 'partial')::int AS partial, COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed, COALESCE(SUM(amount_atomic), 0)::text AS settled_amount_atomic, COUNT(DISTINCT payer_key_hash)::int AS distinct_payers, COUNT(*) FILTER (WHERE related_party_status = 'RELATED')::int AS self_related_executions, COUNT(*) FILTER (WHERE evidence_reference_count > 0)::int AS evidence_covered_executions, MAX(currency) AS currency FROM reputation_events WHERE settlement_status = 'CONFIRMED' AND service_id = ANY($1::text[]) GROUP BY service_id",
      [SERVICE_IDS]
    );
    const rows = Array.isArray(result) ? result : (result.rows || []);
    return res.status(200).json(buildLiveEvidencePayload(rows));
  } catch (error) {
    console.error('dashboard evidence data source unavailable');
    return res.status(200).json(emptyReport('DATA_SOURCE_UNAVAILABLE'));
  }
}

module.exports = handler;
module.exports.buildLiveEvidencePayload = buildLiveEvidencePayload;
module.exports.emptyReport = emptyReport;
