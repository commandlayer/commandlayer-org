'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_AGE_SECONDS = 300;

function getHeader(req, name) {
  if (!req || !req.headers) return undefined;
  const direct = req.headers[name];
  if (direct !== undefined) return direct;
  return req.headers[name.toLowerCase()];
}

function parseHookSignature(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.split(',').map((p) => p.trim()).filter(Boolean);
  const map = new Map();
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    map.set(part.slice(0, idx), part.slice(idx + 1));
  }
  const t = map.get('t');
  const h = map.get('h');
  const v1 = map.get('v1');
  if (!t || !h || !v1) return null;
  const ts = Number.parseInt(t, 10);
  if (!Number.isFinite(ts)) return null;
  const signedHeaderNames = h.split(' ').map((v) => v.trim()).filter(Boolean);
  if (!signedHeaderNames.length || !/^[0-9a-fA-F]+$/.test(v1)) return null;
  return { timestamp: ts, signedHeaderNames, signatureHex: v1.toLowerCase() };
}

function buildSignedPayload({ timestamp, signedHeaderNames, req, rawBody }) {
  const signedHeaderNamesStr = signedHeaderNames.join(' ');
  const signedHeaderValues = signedHeaderNames
    .map((headerName) => String(getHeader(req, headerName) ?? ''))
    .join('.');
  return `${timestamp}.${signedHeaderNamesStr}.${signedHeaderValues}.${rawBody}`;
}

function getRawBodyString(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

function verifyCoinbaseWebhook(req, secret) {
  const signatureHeader = getHeader(req, 'x-hook0-signature');
  if (!signatureHeader) return { ok: false, code: 'missing_signature', httpStatus: 400 };

  const parsed = parseHookSignature(signatureHeader);
  if (!parsed) return { ok: false, code: 'malformed_signature', httpStatus: 400 };

  const maxAge = Number.parseInt(process.env.COINBASE_WEBHOOK_MAX_AGE_SECONDS || '', 10);
  const maxAgeSeconds = Number.isFinite(maxAge) && maxAge >= 0 ? maxAge : DEFAULT_MAX_AGE_SECONDS;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > maxAgeSeconds) {
    return { ok: false, code: 'stale_signature', httpStatus: 400 };
  }

  const rawBody = getRawBodyString(req);
  const signedPayload = buildSignedPayload({ ...parsed, req, rawBody });
  const expectedHex = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = Buffer.from(parsed.signatureHex, 'hex');
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, code: 'invalid_signature', httpStatus: 400 };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: 'malformed_payload', httpStatus: 400 };
  }

  return { ok: true, event, rawBody };
}

module.exports = { verifyCoinbaseWebhook, parseHookSignature, buildSignedPayload, getRawBodyString };
