'use strict';

const { URL } = require('node:url');

const REQUIRED_STATEMENT = 'CommandLayer Claim activation';

function isDev() {
  return process.env.NODE_ENV === 'development';
}

function getHost(req) {
  return String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim().toLowerCase();
}

function getAllowedDomain(req) {
  const configured = process.env.COMMANDLAYER_SIWE_DOMAIN || process.env.SIWE_ALLOWED_DOMAIN || '';
  if (configured) return configured.toLowerCase();
  const host = getHost(req).split(':')[0];
  if (isDev() && (host === 'localhost' || host === '127.0.0.1')) return host;
  return '';
}

function getAllowedUri(req) {
  const configured = process.env.COMMANDLAYER_SITE_URL || process.env.SIWE_ALLOWED_URI || '';
  if (configured) {
    try { return new URL(configured).toString(); } catch { return configured; }
  }
  const host = getHost(req);
  if (isDev() && host.startsWith('localhost')) return `http://${host}/`;
  if (isDev() && host.startsWith('127.0.0.1')) return `http://${host}/`;
  return '';
}

function getAllowedChainIds() {
  const raw = process.env.COMMANDLAYER_SIWE_CHAIN_IDS || process.env.SIWE_ALLOWED_CHAIN_IDS || '1,8453';
  return new Set(raw.split(',').map((v) => Number(v.trim())).filter(Number.isFinite));
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
    const expectedDomain = getAllowedDomain(req);
    const expectedUri = getAllowedUri(req);
    const allowedChains = getAllowedChainIds();

    if (!expectedDomain) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE domain policy is not configured.' });
    }
    if (String(parsed.domain || '').toLowerCase() !== expectedDomain) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE domain mismatch.' });
    }

    if (expectedUri && parsed.uri !== expectedUri) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'SIWE URI mismatch.' });
    }

    if (!allowedChains.has(Number(parsed.chainId))) {
      return res.status(400).json({ ok: false, status: 'AUTH_FAILED', error: 'Unsupported SIWE chainId.' });
    }

    if (String(parsed.statement || '').trim() !== REQUIRED_STATEMENT) {
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
