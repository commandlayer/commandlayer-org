'use strict';

const { createMainnetProvider, getMainnetRpcUrl } = require('../../lib/mainnetRpc');

function getAddressInput(req) {
  const queryAddress = req && req.query && typeof req.query.address === 'string' ? req.query.address : '';
  if (queryAddress) return queryAddress;
  const url = req && req.url ? new URL(req.url, 'http://localhost') : null;
  return url ? (url.searchParams.get('address') || '') : '';
}

function hasProviderConfig() {
  return Boolean(
    getMainnetRpcUrl() ||
    process.env.ALCHEMY_ETH_API_KEY ||
    process.env.ALCHEMY_API_KEY ||
    process.env.SIMPLEHASH_API_KEY
  );
}

function normalizeAddress(raw) {
  const value = String(raw || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error('invalid_address');
  return value.toLowerCase();
}

async function reverseResolvePrimary(address) {
  try {
    const provider = createMainnetProvider();
    if (!provider) return null;
    const primary = await provider.lookupAddress(address);
    return primary || null;
  } catch {
    return null;
  }
}

function providerUnavailable(res) {
  return res.status(503).json({
    ok: false,
    status: 'PROVIDER_UNAVAILABLE',
    error: 'ENS owned-name lookup provider is not configured'
  });
}

async function lookupOwnedNames(address) {
  const key = process.env.SIMPLEHASH_API_KEY || process.env.ALCHEMY_ETH_API_KEY || '';
  if (!key) return null;
  const endpoint = `https://api.simplehash.com/api/v0/nfts/owners?chains=ethereum&wallet_addresses=${address}&contract_ids=ethereum.0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85&limit=50`;
  const response = await fetch(endpoint, {
    headers: { 'X-API-KEY': key, Accept: 'application/json' }
  });
  if (!response.ok) return [];
  const data = await response.json();
  const nfts = Array.isArray(data.nfts) ? data.nfts : [];
  const names = new Set();
  for (const nft of nfts) {
    const candidate = String((nft && (nft.name || (nft.extra_metadata && nft.extra_metadata.name))) || '').toLowerCase().trim();
    if (candidate.endsWith('.eth')) names.add(candidate);
  }
  return Array.from(names).sort();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const rawAddress = getAddressInput(req);
  if (!rawAddress) return res.status(400).json({ ok: false, error: 'missing_address' });

  let address;
  try { address = normalizeAddress(rawAddress); } catch { return res.status(400).json({ ok: false, error: 'invalid_address' }); }

  if (!hasProviderConfig()) return providerUnavailable(res);

  const primaryName = await reverseResolvePrimary(address);

  let names = await lookupOwnedNames(address);
  if (names === null) return providerUnavailable(res);
  if (primaryName && primaryName.endsWith('.eth') && !names.includes(primaryName.toLowerCase())) {
    names.unshift(primaryName.toLowerCase());
  }

  return res.status(200).json({
    ok: true,
    address,
    primaryName: primaryName || null,
    ownedNames: names.map((name) => ({
      name,
      source: 'ens_nft',
      ownershipStatus: 'owned',
      controlStatus: 'not_checked'
    }))
  });
};

module.exports._private = {
  getMainnetRpcUrl,
};
