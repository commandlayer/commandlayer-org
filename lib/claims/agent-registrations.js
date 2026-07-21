'use strict';

const db = require('../db');

const DEFAULT_ERC8004_CHAIN_ID = 'eip155:8453';
const DEFAULT_ERC8004_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

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

function erc8004Config() {
  return {
    chainId: process.env.ERC8004_CHAIN_ID || DEFAULT_ERC8004_CHAIN_ID,
    registryAddress: process.env.ERC8004_REGISTRY_ADDRESS || DEFAULT_ERC8004_REGISTRY_ADDRESS,
    source: process.env.ERC8004_CHAIN_ID && process.env.ERC8004_REGISTRY_ADDRESS ? 'env' : 'default_base_mainnet',
  };
}

async function trackPinnedCardRegistration(card) {
  if (!card || !card.claim_id || !card.ens) return null;
  const { chainId, registryAddress, source } = erc8004Config();
  return upsertErc8004Registration({
    claimId: card.claim_id,
    ens: card.ens,
    chainId,
    registryAddress,
    agentUri: card.card_ipfs_uri || null,
    agentCardCid: card.card_cid || null,
    metadata: { config_source: source },
  });
}

module.exports = { upsertErc8004Registration, trackPinnedCardRegistration, erc8004Config };
