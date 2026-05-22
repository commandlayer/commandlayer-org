'use strict';

const { URL } = require('node:url');

const ALLOWED_CHAIN_IDS = new Set((process.env.SIWE_ALLOWED_CHAIN_IDS || '1,8453,11155111').split(',').map((v) => Number(v.trim())).filter(Number.isFinite));
const ALLOWED_DOMAIN = process.env.SIWE_ALLOWED_DOMAIN || '';
const ALLOWED_URI = process.env.SIWE_ALLOWED_URI || '';
const REQUIRED_STATEMENT = 'CommandLayer Claim activation';

function getHost(req) {
  return String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim().toLowerCase();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'AUTH_FAILED', error: 'Method not allowed. Use POST.' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!message || !signature) {
    return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'Missing SIWE message or signature.' });
  }

  let SiweMessage;
  try {
    ({ SiweMessage } = require('siwe'));
  } catch {
    return res.status(503).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE verification dependency unavailable on server.' });
  }

  try {
    const parsed = new SiweMessage(message);
    const expectedDomain = ALLOWED_DOMAIN || getHost(req);
    if (expectedDomain && String(parsed.domain || '').toLowerCase() !== expectedDomain) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE domain mismatch.' });
    }

    if (ALLOWED_URI && parsed.uri !== ALLOWED_URI) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE URI mismatch.' });
    }

    if (!ALLOWED_CHAIN_IDS.has(Number(parsed.chainId))) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'Unsupported SIWE chainId.' });
    }

    if (!String(parsed.statement || '').toLowerCase().includes(REQUIRED_STATEMENT.toLowerCase())) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'Invalid SIWE statement for claim activation.' });
    }

    const result = await parsed.verify({ signature, domain: expectedDomain, nonce: parsed.nonce });
    if (!result.success) {
      return res.status(401).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE signature verification failed.' });
    }

    return res.status(200).json({ ok: true, status: 'AUTHENTICATED', address: result.data.address, chainId: Number(result.data.chainId), ens: null });
  } catch (error) {
    return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: error && error.message ? error.message : 'Invalid SIWE payload.' });
  }
};
