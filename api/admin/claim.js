'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');
const { stripClaimSecrets } = require('../../lib/claims/access-token');

async function hasTable(tableName) {
  const result = await db.query('select to_regclass($1) as table_name', [tableName]);
  return Boolean(result.rows[0] && result.rows[0].table_name);
}

function isUndefinedDbRelationError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.code === '42P01';
}

function isUndefinedDbColumnError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.code === '42703';
}

function isOptionalRelationError(error) {
  return isUndefinedDbRelationError(error) || isUndefinedDbColumnError(error);
}

async function queryOptionalRows(queryText, params, fallbackValue, label) {
  try {
    const result = await db.query(queryText, params);
    return result.rows;
  } catch (error) {
    if (!isOptionalRelationError(error)) throw error;
    console.debug('[admin.claim] optional query failed', { label, code: error.code });
    return fallbackValue;
  }
}

async function queryOptionalOne(queryText, params, label) {
  try {
    const result = await db.query(queryText, params);
    return result.rows[0] || null;
  } catch (error) {
    if (!isOptionalRelationError(error)) throw error;
    console.debug('[admin.claim] optional query failed', { label, code: error.code });
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) return;

  const claimId = req.query && typeof req.query.claimId === 'string' ? req.query.claimId.trim() : '';
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  try {
    const claimResult = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    const claim = claimResult.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    const agentsResult = await db.query('select * from claim_agents where claim_id = $1 order by ens asc, id asc', [claimId]);
    const eventsResult = await db.query('select * from claim_events where claim_id = $1 order by created_at desc', [claimId]);

    let transitions = [];
    if (await hasTable('claim_status_transitions')) {
      transitions = await queryOptionalRows('select * from claim_status_transitions where claim_id = $1 order by created_at desc', [claimId], [], 'claim_status_transitions');
    }

    let cards = [];
    if (await hasTable('agent_cards')) {
      cards = await queryOptionalRows('select * from agent_cards where claim_id = $1 order by ens asc, card_url asc', [claimId], [], 'agent_cards');
    }

    let latestPayment = null;
    if (await hasTable('claim_payments')) {
      latestPayment = await queryOptionalOne('select * from claim_payments where claim_id = $1 order by updated_at desc nulls last, paid_at desc nulls last, id desc limit 1', [claimId], 'claim_payments');
    }

    let registrations = [];
    if (await hasTable('agent_registrations')) {
      registrations = await queryOptionalRows('select * from agent_registrations where claim_id = $1 order by ens asc, standard asc', [claimId], [], 'agent_registrations');
    }

    return res.status(200).json({ ok: true, claim: stripClaimSecrets(claim), agents: agentsResult.rows, events: eventsResult.rows, transitions, cards, registrations, latestPayment });
  } catch (error) {
    console.error('[admin.claim] failed to load claim detail', { code: error && error.code });
    const payload = {
      ok: false,
      status: 'ADMIN_CLAIM_DETAIL_FAILED',
      error: 'Failed to load claim detail.',
    };
    if (process.env.NODE_ENV !== 'production') {
      payload.debug = {
        message: error && error.message ? error.message : 'Unknown error',
        code: error && error.code ? error.code : null,
      };
    }
    return res.status(500).json(payload);
  }
};
