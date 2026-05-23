'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

const CLAIM_STATUSES = {
  CREATED: 'created',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CARDS_PUBLISHED: 'cards_published',
  PAYMENT_PENDING: 'payment_pending',
  PAID: 'paid',
  ERC8004_REGISTERED: 'erc8004_registered',
  ENS_RECORDS_GENERATED: 'ens_records_generated',
  ENS_PROVISIONED: 'ens_provisioned',
  LIVE_TEST_PASSED: 'live_test_passed',
  LIVE: 'live',
  FAILED: 'failed'
};

const SUPPORTED_ACTIONS = new Set(['approve', 'reject', 'mark_failed', 'add_note']);

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  if (!requireAdminAuth(req, res)) return;

  const body = req.body || {};
  const claimId = typeof body.claimId === 'string' ? body.claimId.trim() : '';
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const actor = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : 'admin';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const override = body.override === true;

  if (!claimId) return res.status(400).json({ ok: false, status: 'INVALID_CLAIM_ID' });
  if (!SUPPORTED_ACTIONS.has(action)) return res.status(400).json({ ok: false, status: 'INVALID_ACTION' });
  if ((action === 'reject' || action === 'mark_failed') && !reason) {
    return res.status(400).json({ ok: false, status: 'REASON_REQUIRED' });
  }

  try {
    const claimRows = db.normalizeRows(await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]));
    if (!claimRows.length) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    const claim = claimRows[0];
    const fromStatus = claim.status;

    if (action === 'approve') {
      const allow = fromStatus === CLAIM_STATUSES.CREATED || (fromStatus === CLAIM_STATUSES.REJECTED && override);
      if (!allow) {
        return res.status(409).json({ ok: false, status: 'INVALID_STATUS_TRANSITION', error: `Cannot approve claim from ${fromStatus} status.`, fromStatus, action });
      }
      await db.query(
        `update claim_requests
         set status = $2,
             approved_at = now(),
             reviewed_at = now(),
             reviewed_by = $3,
             admin_notes = case when $4 <> '' then $4 else admin_notes end
         where claim_id = $1`,
        [claimId, CLAIM_STATUSES.APPROVED, actor, notes]
      );
      await insertEventAndTransition({ claimId, fromStatus, toStatus: CLAIM_STATUSES.APPROVED, action, actor, reason, notes, eventType: 'claim.approved', metadata: { override } });
      return res.status(200).json({ ok: true, status: 'CLAIM_ACTION_APPLIED', claimId, action, claimStatus: CLAIM_STATUSES.APPROVED });
    }

    if (action === 'reject') {
      if (fromStatus !== CLAIM_STATUSES.CREATED) {
        return res.status(409).json({ ok: false, status: 'INVALID_STATUS_TRANSITION', error: `Cannot reject claim from ${fromStatus} status.`, fromStatus, action });
      }
      await db.query(
        `update claim_requests
         set status = $2,
             rejected_at = now(),
             reviewed_at = now(),
             reviewed_by = $3,
             rejection_reason = $4
         where claim_id = $1`,
        [claimId, CLAIM_STATUSES.REJECTED, actor, reason]
      );
      await insertEventAndTransition({ claimId, fromStatus, toStatus: CLAIM_STATUSES.REJECTED, action, actor, reason, notes, eventType: 'claim.rejected' });
      return res.status(200).json({ ok: true, status: 'CLAIM_ACTION_APPLIED', claimId, action, claimStatus: CLAIM_STATUSES.REJECTED });
    }

    if (action === 'mark_failed') {
      if (fromStatus === CLAIM_STATUSES.LIVE) {
        return res.status(409).json({ ok: false, status: 'INVALID_STATUS_TRANSITION', error: `Cannot mark_failed claim from ${fromStatus} status.`, fromStatus, action });
      }
      await db.query(
        `update claim_requests
         set status = $2,
             last_error = $3,
             last_error_at = now()
         where claim_id = $1`,
        [claimId, CLAIM_STATUSES.FAILED, reason]
      );
      await insertEventAndTransition({ claimId, fromStatus, toStatus: CLAIM_STATUSES.FAILED, action, actor, reason, notes, eventType: 'claim.failed' });
      return res.status(200).json({ ok: true, status: 'CLAIM_ACTION_APPLIED', claimId, action, claimStatus: CLAIM_STATUSES.FAILED });
    }

    const mergedNotes = [claim.admin_notes, notes || reason].filter(Boolean).join('\n').trim();
    await db.query('update claim_requests set admin_notes = $2 where claim_id = $1', [claimId, mergedNotes]);
    await db.query(
      `insert into claim_events (claim_id, event_type, actor, event_json)
       values ($1, 'claim.note_added', $2, $3::jsonb)`,
      [claimId, actor, JSON.stringify({ action, reason, notes })]
    );
    return res.status(200).json({ ok: true, status: 'CLAIM_ACTION_APPLIED', claimId, action, claimStatus: fromStatus });
  } catch (error) {
    console.error('ADMIN_CLAIM_ACTION_FAILED', { message: error.message, code: error.code });
    return res.status(500).json({ ok: false, status: 'ADMIN_CLAIM_ACTION_FAILED', error: 'Failed to apply claim action.' });
  }
};

async function insertEventAndTransition({ claimId, fromStatus, toStatus, action, actor, reason, notes, eventType, metadata }) {
  await db.query(
    `insert into claim_events (claim_id, event_type, actor, event_json)
     values ($1, $2, $3, $4::jsonb)`,
    [claimId, eventType, actor, JSON.stringify({ action, reason, notes, ...(metadata || {}) })]
  );
  await db.query(
    `insert into claim_status_transitions (claim_id, from_status, to_status, action, actor, reason, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [claimId, fromStatus, toStatus, action, actor, reason || null, JSON.stringify({ notes, ...(metadata || {}) })]
  );
}
