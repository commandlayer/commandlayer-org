'use strict';

const db = require('../db');

/** Idempotently records card discovery metadata; it does not perform registration or verification. */
async function upsertErc8004Registration({ claimId, ens, chainId, registryAddress, agentUri = null, agentCardCid = null, metadata = null }) {
  if (!claimId || !ens || !chainId || !registryAddress) {
    throw new Error('claimId, ens, chainId, and registryAddress are required');
  }

  const result = await db.query(
    `insert into agent_registrations
       (claim_id, ens, standard, chain_id, registry_address, agent_uri, agent_card_cid, metadata_json)
     values ($1, $2, 'erc8004', $3, $4, $5, $6, $7::jsonb)
     on conflict (standard, ens, chain_id, registry_address) do update
       set claim_id = excluded.claim_id,
           agent_uri = coalesce(excluded.agent_uri, agent_registrations.agent_uri),
           agent_card_cid = coalesce(excluded.agent_card_cid, agent_registrations.agent_card_cid),
           metadata_json = coalesce(excluded.metadata_json, agent_registrations.metadata_json)
     returning *`,
    [claimId, ens, chainId, registryAddress, agentUri, agentCardCid, metadata == null ? null : JSON.stringify(metadata)]
  );
  return result.rows[0] || null;
}

async function trackPinnedCardRegistration(card) {
  const chainId = process.env.ERC8004_CHAIN_ID;
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS;
  if (!chainId || !registryAddress) return null;
  return upsertErc8004Registration({
    claimId: card.claim_id,
    ens: card.ens,
    chainId,
    registryAddress,
    agentUri: card.card_ipfs_uri || null,
    agentCardCid: card.card_cid || null,
  });
}

module.exports = { upsertErc8004Registration, trackPinnedCardRegistration };
