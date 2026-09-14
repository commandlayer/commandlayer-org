import test from 'node:test';
import assert from 'node:assert/strict';

const { buildLiveEvidencePayload } = await import('../api/dashboard/evidence.js');

test('builds safe aggregates without exposing raw identity fields', () => {
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
    }
  ]);

  assert.equal(report.status, 'LIVE');
  assert.equal(report.totals.paid_executions, 2);
  assert.equal(report.totals.settled_amount_atomic, '10000');
  assert.equal(report.services.find((item) => item.service_id === 'parseagent').passed, 1);
  assert.equal(Object.hasOwn(report, 'payer_key_hash'), false);
});
