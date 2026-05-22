'use strict';

const { URL } = require('node:url');

const REQUIRED_STATEMENT = 'Authenticate with CommandLayer Claim activation.';

function isDev() {
  return process.env.NODE_ENV === 'development';
}

function getHost(req) {
  return String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim().toLowerCase();
}

function getAllowedDomain(req) {
  const configured = process.env.COMMANDLAYER_SIWE_DOMAINS || process.env.COMMANDLAYER_SIWE_DOMAIN || process.env.SIWE_ALLOWED_DOMAIN || '';
  const configuredDomains = configured.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (configuredDomains.length) return new Set(configuredDomains);
  const host = getHost(req).split(':')[0];
  const defaults = new Set(['www.commandlayer.org']);
  if (host === 'commandlayer.org') defaults.add('commandlayer.org');
  if (isDev()) {
    defaults.add('localhost');
    defaults.add('127.0.0.1');
  }
  return defaults;
}

function getAllowedUri(req) {
  const configured = process.env.COMMANDLAYER_SITE_URLS || process.env.COMMANDLAYER_SITE_URL || process.env.SIWE_ALLOWED_URI || '';
  const configuredUris = configured.split(',').map((v) => v.trim()).filter(Boolean).map((v) => {
    try { return new URL(v).toString(); } catch { return v; }
  });
  if (configuredUris.length) return new Set(configuredUris);
  const host = getHost(req);
  const defaults = new Set(['https://www.commandlayer.org/']);
  if (host === 'commandlayer.org' || configured.includes('https://commandlayer.org')) {
    defaults.add('https://commandlayer.org/');
  }
  if (isDev()) {
    defaults.add(`http://${host}/`);
  }
  return defaults;
}

function getAllowedChainIds() {
  const raw = process.env.COMMANDLAYER_SIWE_CHAIN_IDS || process.env.SIWE_ALLOWED_CHAIN_IDS || '1,8453';
  return new Set(raw.split(',').map((v) => Number(v.trim())).filter(Number.isFinite));
}

module.exports = async function handler(req, res) {
  const fail = (statusCode, error, reason) => res.status(statusCode).json({ ok: false, status: 'AUTH_FAILED', error, reason });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405, 'method_not_allowed', 'Method not allowed. Use POST.');
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'malformed_request', 'Request body must be a JSON object.');
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'message')) {
    return fail(400, 'missing_message', 'Missing SIWE message.');
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'signature')) {
    return fail(400, 'missing_signature', 'Missing SIWE signature.');
  }

  if (typeof body.message !== 'string') {
    return fail(400, 'invalid_message_type', 'SIWE message must be a string.');
  }
  if (typeof body.signature !== 'string') {
    return fail(400, 'invalid_signature_type', 'SIWE signature must be a string.');
  }

  const message = body.message;
  const signature = body.signature;
  if (!message) return fail(400, 'missing_message', 'Missing SIWE message.');
  if (!signature) return fail(400, 'missing_signature', 'Missing SIWE signature.');

  let SiweMessage;
  try {
    ({ SiweMessage } = require('siwe'));
  } catch {
    return fail(503, 'dependency_unavailable', 'SIWE dependency is unavailable');
  }

  try {
    const parsed = new SiweMessage(message);
    const allowedDomains = getAllowedDomain(req);
    const allowedUris = getAllowedUri(req);
    const allowedChains = getAllowedChainIds();

    const parsedDomain = String(parsed.domain || '').toLowerCase();
    if (!allowedDomains.has(parsedDomain)) {
      return fail(400, 'domain_mismatch', `Expected one of ${Array.from(allowedDomains).join(', ')} but received ${parsedDomain || '(empty)'}`);
    }

    const normalizedUri = (() => { try { return new URL(String(parsed.uri || '')).toString(); } catch { return String(parsed.uri || ''); } })();
    if (!allowedUris.has(normalizedUri)) {
      return fail(400, 'uri_mismatch', `Expected one of ${Array.from(allowedUris).join(', ')} but received ${normalizedUri || '(empty)'}`);
    }

    if (!allowedChains.has(Number(parsed.chainId))) {
      return fail(400, 'chain_not_allowed', `Unsupported SIWE chainId ${parsed.chainId}.`);
    }

    if (String(parsed.statement || '').trim() !== REQUIRED_STATEMENT) {
      return fail(400, 'statement_mismatch', `Expected statement "${REQUIRED_STATEMENT}" but received "${String(parsed.statement || '')}"`);
    }

    const result = await parsed.verify({ signature, domain: parsedDomain, nonce: parsed.nonce });
    if (!result.success) {
      return fail(401, 'signature_invalid', 'SIWE signature verification failed.');
    }

    return res.status(200).json({ ok: true, status: 'AUTHENTICATED', address: result.data.address, chainId: Number(result.data.chainId), ens: null });
  } catch (error) {
    return fail(400, 'malformed_message', error && error.message ? error.message : 'Invalid SIWE payload.');
  }
};
