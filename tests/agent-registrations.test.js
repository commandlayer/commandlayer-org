'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../lib/db');
const { upsertErc8004Registration, trackPinnedCardRegistration, erc8004Config } = require('../lib/claims/agent-registrations');

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

test('pinned card tracking uses safe Base defaults when registry env vars are missing', async () => {
  const oldChain = process.env.ERC8004_CHAIN_ID;
  const oldRegistry = process.env.ERC8004_REGISTRY_ADDRESS;
  delete process.env.ERC8004_CHAIN_ID;
  delete process.env.ERC8004_REGISTRY_ADDRESS;
  let values;
  db.query = async (_q, v) => { values = v; return { rows: [{ registration_status: 'pending' }] }; };
  const row = await trackPinnedCardRegistration({ claim_id: 'c1', ens: 'agent.eth', card_ipfs_uri: 'ipfs://cid', card_cid: 'cid' });
  assert.equal(row.registration_status, 'pending');
  assert.equal(values[2], 'eip155:8453');
  assert.equal(values[3], '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
  assert.equal(JSON.parse(values[6]).config_source, 'default_base_mainnet');
  if (oldChain === undefined) delete process.env.ERC8004_CHAIN_ID; else process.env.ERC8004_CHAIN_ID = oldChain;
  if (oldRegistry === undefined) delete process.env.ERC8004_REGISTRY_ADDRESS; else process.env.ERC8004_REGISTRY_ADDRESS = oldRegistry;
});

test('pinned card tracking skips malformed card rows safely', async () => {
  let called = false;
  db.query = async () => { called = true; return { rows: [] }; };
  assert.equal(await trackPinnedCardRegistration({ claim_id: 'c1' }), null);
  assert.equal(await trackPinnedCardRegistration({ ens: 'agent.eth' }), null);
  assert.equal(await trackPinnedCardRegistration(null), null);
  assert.equal(called, false);
});

test('ERC-8004 config reports explicit env source when both env vars are set', () => {
  const oldChain = process.env.ERC8004_CHAIN_ID;
  const oldRegistry = process.env.ERC8004_REGISTRY_ADDRESS;
  process.env.ERC8004_CHAIN_ID = 'eip155:1';
  process.env.ERC8004_REGISTRY_ADDRESS = '0xabc';
  assert.deepEqual(erc8004Config(), { chainId: 'eip155:1', registryAddress: '0xabc', source: 'env' });
  if (oldChain === undefined) delete process.env.ERC8004_CHAIN_ID; else process.env.ERC8004_CHAIN_ID = oldChain;
  if (oldRegistry === undefined) delete process.env.ERC8004_REGISTRY_ADDRESS; else process.env.ERC8004_REGISTRY_ADDRESS = oldRegistry;
});
