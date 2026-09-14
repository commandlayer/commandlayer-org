import test from 'node:test';
import assert from 'node:assert/strict';

const { buildLiveEvidencePayload } = await import('../api/dashboard/evidence.js');

test('builds safe aggregates and preserves a global payer count', () => {
  const report = buildLiveEvidencePayload([
    {
      service_id: 'parseagent',
      paid_executions: 2,
      passed: 1,
      partial: 1,
      failed: 0,
      settled_amount_atomic: '10000',
      distinct_payers: 2,
      self_related_executions: 0,
      evidence_covered_executions: 2,
      currency: 'USDC',
      payer_key_hash: 'never-returned'
    },
    {
      service_id: 'compareagent',
      paid_executions: 1,
      passed: 1,
      partial: 0,
      failed: 0,
      settled_amount_atomic: '50000',
      distinct_payers: 1,
      self_related_executions: 0,
      evidence_covered_executions: 1,
      currency: 'USDC'
    }
  ], 2, [{ day: '2026-09-14', paid_executions: 3, settled_amount_atomic: '60000' }], [], '30d');

  assert.equal(report.status, 'LIVE');
  assert.equal(report.totals.paid_executions, 3);
  assert.equal(report.totals.settled_amount_atomic, '60000');
  assert.equal(report.totals.distinct_payers, 2);
  assert.equal(report.trend[0].paid_executions, 3);
  assert.equal(report.services.find((item) => item.service_id === 'parseagent').passed, 1);
  assert.equal(Object.hasOwn(report, 'payer_key_hash'), false);
});
