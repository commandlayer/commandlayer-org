'use strict';

const db = require('../../lib/db');
const { stableStringify, sha256Hex, pinJsonToPinata } = require('../../lib/ipfsPinning');

function firstObjectValue(agent, keys) {
  for (const key of keys) {
    const value = agent && agent[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function deriveCardJsonFromClaimAgent(agent) {
  return firstObjectValue(agent, [
    'card_json',
    'published_card_json',
    'published_card',
    'card',
    'published_json',
    'source_json',
  ]);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!process.env.ADMIN_API_KEY || req.headers['x-admin-api-key'] !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
  }

  const provider = process.env.IPFS_PINNING_PROVIDER || 'pinata';
  if (provider !== 'pinata') return res.status(400).json({ ok: false, status: 'UNSUPPORTED_PINNING_PROVIDER' });

  const claimId = req.body && req.body.claimId;
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  const claimResult = await db.query('select claim_id, status from claim_requests where claim_id = $1 limit 1', [claimId]);
  const claim = claimResult.rows[0];
  if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
  if (claim.status !== 'paid' && claim.status !== 'cards_pinned') return res.status(400).json({ ok: false, status: 'CLAIM_NOT_PAID' });

  let cardsResult = await db.query(
    `select id, claim_id, ens, card_json, card_cid, card_ipfs_uri, card_gateway_url, card_sha256, pin_status
     from agent_cards
     where claim_id = $1 and status = 'published'
     order by created_at asc`,
    [claimId]
  );

  if (!cardsResult.rows.length && claim.status === 'paid') {
    const agentsResult = await db.query(
      `select * from claim_agents where claim_id = $1 and status = 'published' order by created_at asc`,
      [claimId]
    );

    for (const agent of agentsResult.rows) {
      const cardJson = deriveCardJsonFromClaimAgent(agent);
      if (!cardJson) {
        console.warn('[admin.pin-agent-cards] CARD_JSON_MISSING', { claimId, ens: agent.ens });
        continue;
      }

      await db.query(
        `insert into agent_cards (claim_id, ens, card_json, status, pin_status)
         values ($1, $2, $3::jsonb, 'published', 'pending')`,
        [claimId, agent.ens, JSON.stringify(cardJson)]
      );
    }

    cardsResult = await db.query(
      `select id, claim_id, ens, card_json, card_cid, card_ipfs_uri, card_gateway_url, card_sha256, pin_status
       from agent_cards
       where claim_id = $1 and status = 'published'
       order by created_at asc`,
      [claimId]
    );
  }

  if (!cardsResult.rows.length) {
    console.warn('[admin.pin-agent-cards] NO_AGENT_CARDS_TO_PIN', { claimId });
    return res.status(400).json({ ok: false, status: 'NO_AGENT_CARDS_TO_PIN' });
  }

  const allPinned = cardsResult.rows.every((r) => r.card_cid && r.card_ipfs_uri && r.card_sha256);
  if (allPinned) return res.status(200).json({ ok: true, status: 'ALREADY_PINNED', claimId, cards: cardsResult.rows });

  const gatewayBase = (process.env.IPFS_GATEWAY_BASE_URL || 'https://gateway.pinata.cloud/ipfs').replace(/\/$/, '');

  try {
    const pinned = [];
    for (const row of cardsResult.rows) {
      if (!row.card_json) {
        console.warn('[admin.pin-agent-cards] CARD_JSON_MISSING', { claimId, ens: row.ens });
        continue;
      }

      const canonical = stableStringify(row.card_json);
      const hash = sha256Hex(canonical);

      if (row.card_cid && row.card_ipfs_uri && row.card_sha256) {
        pinned.push({ ens: row.ens, card_cid: row.card_cid, card_sha256: row.card_sha256, card_gateway_url: row.card_gateway_url });
        continue;
      }

      try {
        const cid = await pinJsonToPinata(row.card_json);
        const ipfsUri = `ipfs://${cid}`;
        const gatewayUrl = `${gatewayBase}/${cid}`;
        await db.query(
          `update agent_cards
           set card_cid = $2, card_ipfs_uri = $3, card_gateway_url = $4, card_sha256 = $5,
               card_pinned_at = now(), pinning_provider = $6, pin_status = 'pinned', pin_error = null
           where id = $1`,
          [row.id, cid, ipfsUri, gatewayUrl, hash, provider]
        );
        pinned.push({ ens: row.ens, card_cid: cid, card_sha256: hash, card_gateway_url: gatewayUrl });
      } catch (error) {
        await db.query("update agent_cards set pin_status = 'error', pin_error = $2 where id = $1", [row.id, String(error && error.message ? error.message : 'pinning_failed')]);
        console.error('[admin.pin-agent-cards] IPFS_PIN_FAILED', { claimId, ens: row.ens });
        throw error;
      }
    }

    await db.query('update claim_requests set status = $2, updated_at = now() where claim_id = $1', [claimId, 'cards_pinned']);
    await db.query(
      `insert into claim_events (claim_id, event_type, message, metadata_json)
       values ($1, 'agent_cards.pinned', 'Agent cards pinned to IPFS.', $2::jsonb)`,
      [claimId, JSON.stringify({ provider, count: pinned.length })]
    );
    await db.query(
      `insert into claim_status_transitions (claim_id, from_status, to_status)
       values ($1, 'paid', 'cards_pinned')`,
      [claimId]
    );
    console.log('[admin.pin-agent-cards] IPFS_PIN_SUCCESS', { claimId, count: pinned.length });

    return res.status(200).json({ ok: true, status: 'CARDS_PINNED', claimId, provider, cards: pinned });
  } catch (error) {
    return res.status(502).json({ ok: false, status: 'IPFS_PIN_FAILED', claimId });
  }
};
