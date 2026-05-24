'use strict';

function getMainnetRpcUrl(env = process.env) {
  const direct = [
    env.ETHEREUM_RPC_URL,
    env.MAINNET_RPC_URL,
    env.ALCHEMY_ETHEREUM_RPC_URL,
    env.ALCHEMY_ETH_RPC_URL,
    env.ETH_RPC_URL,
  ].find((value) => typeof value === 'string' && value.trim());
  if (direct) return direct.trim();

  const alchemyKey = env.ALCHEMY_API_KEY;
  if (typeof alchemyKey === 'string' && alchemyKey.trim()) {
    return `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey.trim()}`;
  }

  return '';
}

function createMainnetProvider(env = process.env) {
  const rpcUrl = getMainnetRpcUrl(env);
  if (!rpcUrl) return null;
  const { ethers } = require('ethers');
  return new ethers.JsonRpcProvider(rpcUrl);
}

module.exports = { getMainnetRpcUrl, createMainnetProvider };
