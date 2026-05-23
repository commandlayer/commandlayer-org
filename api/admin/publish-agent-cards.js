'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

const BASE_URL = 'https://www.commandlayer.org';
const CARD_VERSION = '1.1.0';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  if (!requireAdminAuth(req, res)) return;

  const claimId = typeof req.body?.claimId === 'string' ? req.body.claimId.trim() : '';
  if (!claimId) return res.status(400).json({ ok: false, status: 'INVALID_CLAIM_ID' });

  let transactionOpen = false;
  try {
    const claimRows = db.normalizeRows(await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]));
    if (!claimRows.length) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    const claim = claimRows[0];
    if (claim.status !== 'approved' && claim.status !== 'cards_published') {
      return res.status(409).json({ ok: false, status: 'CLAIM_NOT_APPROVED', error: 'Claim must be approved before publishing cards.' });
    }

    const agents = db.normalizeRows(await db.query('select * from claim_agents where claim_id = $1 order by capability asc', [claimId]));
    if (!agents.length) return res.status(409).json({ ok: false, status: 'AGENTS_NOT_FOUND' });

    const existing = db.normalizeRows(await db.query('select * from agent_cards where claim_id = $1 order by ens asc', [claimId]));
    const existingByEns = new Map(existing.map((row) => [String(row.ens || '').trim(), row]));

    if (claim.status === 'cards_published' && isComplete(agents, existingByEns)) {
      return res.status(200).json({ ok: true, claimId, status: 'CARDS_ALREADY_PUBLISHED', cards: formatCards(existing) });
    }

    await db.query('begin');
    transactionOpen = true;

    const cards = [];
    for (const agent of agents) {
      const ens = String(agent.ens || '').trim();
      const capability = String(agent.capability || '').trim();
      const cardPath = `/agent-cards/agents/v${CARD_VERSION}/trust/${ens}.json`;
      const cardUrl = `${BASE_URL}${cardPath}`;
      const cardJson = buildCardJson(agent, ens, capability);

      await db.query(
        `insert into agent_cards (claim_id, ens, card_url, card_json, version, status)
         values ($1, $2, $3, $4::jsonb, $5, 'published')
         on conflict (card_url)
         do update set
           claim_id = excluded.claim_id,
           ens = excluded.ens,
           card_json = excluded.card_json,
           version = excluded.version,
           status = 'published',
           updated_at = now()`,
        [claimId, ens, cardUrl, JSON.stringify(cardJson), CARD_VERSION]
      );

      await db.query(
        `update claim_agents
         set card_url = $3,
             card_status = 'published',
             card_published_at = coalesce(card_published_at, now())
         where claim_id = $1 and id = $2`,
        [claimId, agent.id, cardUrl]
      );
      cards.push({ ens, cardUrl });
    }

    const alreadyPublishedEvent = db.normalizeRows(
      await db.query("select id from claim_events where claim_id = $1 and event_type = 'agent_cards.published' limit 1", [claimId])
    );
    if (!alreadyPublishedEvent.length) {
      await db.query(
        `insert into claim_events (claim_id, event_type, actor, message, event_json)
         values ($1, 'agent_cards.published', 'admin', 'Agent cards published', $2::jsonb)`,
        [claimId, JSON.stringify({ count: cards.length, cards })]
      );
    }

    const publishedTransition = db.normalizeRows(
      await db.query(
        `select id from claim_status_transitions
         where claim_id = $1 and from_status = 'approved' and to_status = 'cards_published' and action = 'publish_agent_cards'
         limit 1`,
        [claimId]
      )
    );
    if (!publishedTransition.length) {
      await db.query(
        `insert into claim_status_transitions (claim_id, from_status, to_status, action, actor, reason, metadata_json)
         values ($1, 'approved', 'cards_published', 'publish_agent_cards', 'admin', null, $2::jsonb)`,
        [claimId, JSON.stringify({ cardCount: cards.length })]
      );
    }

    if (claim.status === 'approved') {
      await db.query("update claim_requests set status = 'cards_published' where claim_id = $1", [claimId]);
    }

    await db.query('commit');
    transactionOpen = false;

    return res.status(200).json({
      ok: true,
      claimId,
      status: claim.status === 'approved' ? 'CARDS_PUBLISHED' : 'AGENT_CARDS_REPAIRED',
      cards
    });
  } catch (error) {
    if (transactionOpen) {
      try { await db.query('rollback'); } catch (_) {}
    }

    const statusCode = error && error.statusCode ? error.statusCode : 500;
    const status = error && error.status ? error.status : (statusCode === 500 ? 'ADMIN_PUBLISH_AGENT_CARDS_FAILED' : 'AGENT_CARD_PUBLISH_FAILED');
    const message = error && error.error ? error.error : 'Failed to publish agent cards.';

    console.error('ADMIN_PUBLISH_AGENT_CARDS_FAILED', { message: error.message, code: error.code, claimId });

    const payload = { ok: false, status, error: message };
    if (process.env.NODE_ENV !== 'production') payload.debug = { message: error.message, code: error.code };
    return res.status(statusCode).json(payload);
  }
};

function isComplete(agents, existingByEns) {
  for (const agent of agents) {
    const ens = String(agent.ens || '').trim();
    const row = existingByEns.get(ens);
    if (!row) return false;
    if (!agent.card_url || !agent.card_status) return false;
  }
  return true;
}

function formatCards(rows) {
  return rows.map((row) => ({ ens: row.ens, cardUrl: row.card_url }));
}

function buildCardJson(agent, ens, capability) {
  return {
    type: 'erc8004/registration/v1',
    name: ens,
    description: `CommandLayer Trust Verification agent for ${capability}.`,
    image: 'https://www.commandlayer.org/icon2.png',
    services: [
      { type: 'ens', endpoint: ens },
      { type: 'commandlayer_runtime', endpoint: 'https://runtime.commandlayer.org' },
      { type: 'commandlayer_verifier', endpoint: 'https://runtime.commandlayer.org/verify' }
    ],
    commandlayer: {
      version: CARD_VERSION,
      tenant: agent.tenant,
      capability,
      canonicalParent: agent.canonical_parent,
      skill: agent.skill,
      skillFamily: agent.skill_family,
      kid: agent.kid,
      publicKey: agent.public_key,
      runtime: 'https://runtime.commandlayer.org',
      verifier: 'https://runtime.commandlayer.org/verify'
    },
    registrations: []
  };
}
