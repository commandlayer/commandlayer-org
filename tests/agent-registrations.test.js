'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../lib/db');
const { upsertErc8004Registration, trackPinnedCardRegistration } = require('../lib/claims/agent-registrations');

test('upsert ERC-8004 metadata is idempotent and leaves proof fields untouched', async () => {
  let query;
  let values;
  db.query = async (q, v) => { query = q; values = v; return { rows: [{ registration_status: 'pending' }] }; };
  const row = await upsertErc8004Registration({ claimId: 'c1', ens: 'agent.eth', chainId: '1', registryAddress: '0xregistry', agentUri: 'ipfs://cid', agentCardCid: 'cid' });
  assert.match(query, /on conflict \(standard, ens, chain_id, registry_address\) do update/);
  assert.equal(query.includes('agent_id ='), false);
  assert.equal(query.includes('registration_tx_hash ='), false);
  assert.deepEqual(values.slice(0, 6), ['c1', 'agent.eth', '1', '0xregistry', 'ipfs://cid', 'cid']);
  assert.equal(row.registration_status, 'pending');
});

test('pinned card tracking requires explicit registry configuration', async () => {
  const oldChain = process.env.ERC8004_CHAIN_ID;
  const oldRegistry = process.env.ERC8004_REGISTRY_ADDRESS;
  delete process.env.ERC8004_CHAIN_ID;
  delete process.env.ERC8004_REGISTRY_ADDRESS;
  let called = false;
  db.query = async () => { called = true; return { rows: [] }; };
  assert.equal(await trackPinnedCardRegistration({ claim_id: 'c1', ens: 'agent.eth' }), null);
  assert.equal(called, false);
  if (oldChain === undefined) delete process.env.ERC8004_CHAIN_ID; else process.env.ERC8004_CHAIN_ID = oldChain;
  if (oldRegistry === undefined) delete process.env.ERC8004_REGISTRY_ADDRESS; else process.env.ERC8004_REGISTRY_ADDRESS = oldRegistry;
});
