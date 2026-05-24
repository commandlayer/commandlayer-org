'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getMainnetRpcUrl } = require('../lib/mainnetRpc');

test('getMainnetRpcUrl prefers ETHEREUM_RPC_URL', () => {
  const env = {
    ETHEREUM_RPC_URL: 'https://rpc-1.example',
    MAINNET_RPC_URL: 'https://rpc-2.example',
    ALCHEMY_ETHEREUM_RPC_URL: 'https://rpc-3.example',
    ALCHEMY_API_KEY: 'abc123',
  };
  assert.equal(getMainnetRpcUrl(env), 'https://rpc-1.example');
});

test('getMainnetRpcUrl maps ALCHEMY_API_KEY to Alchemy HTTPS URL', () => {
  const env = { ALCHEMY_API_KEY: 'abc123' };
  assert.equal(getMainnetRpcUrl(env), 'https://eth-mainnet.g.alchemy.com/v2/abc123');
});
