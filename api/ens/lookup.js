'use strict';

function getAddressParam(req) {
  const direct = req.query && req.query.address;
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0] || '';
  try {
    const host = (req.headers && req.headers.host) || 'localhost';
    const url = new URL(req.url || '', `http://${host}`);
    return url.searchParams.get('address') || '';
  } catch {
    return '';
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED', error: 'Method not allowed. Use GET.' });
  }

  const rawAddress = String(getAddressParam(req) || '').trim();
  if (!rawAddress) {
    return res.status(400).json({ ok: false, status: 'INVALID_REQUEST', error: 'Missing required query parameter: address' });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(rawAddress)) {
    return res.status(400).json({ ok: false, status: 'INVALID_ADDRESS', error: 'Invalid Ethereum address.' });
  }
  const address = rawAddress.toLowerCase();

  const rpcUrl = process.env.ETH_RPC_URL || process.env.BASE_RPC_URL || '';
  if (!rpcUrl) {
    return res.status(503).json({ ok: false, status: 'PROVIDER_UNAVAILABLE', error: 'ETH_RPC_URL is not configured' });
  }

  try {
    let ethers;
    try {
      ({ ethers } = require('ethers'));
    } catch {
      return res.status(503).json({ ok: false, status: 'DEPENDENCY_UNAVAILABLE', error: 'ethers dependency unavailable' });
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const primaryName = await provider.lookupAddress(address);
    return res.status(200).json({ ok: true, address, primaryName: primaryName || null, source: 'reverse_resolution' });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      status: 'LOOKUP_FAILED',
      error: error && error.message ? error.message : 'ENS reverse lookup failed.'
    });
  }
};
