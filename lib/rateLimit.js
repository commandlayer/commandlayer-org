'use strict';

const buckets = new Map();

function getClientIp(req) {
  const headers = (req && req.headers) || {};
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return (req && req.socket && req.socket.remoteAddress) || (req && req.connection && req.connection.remoteAddress) || 'unknown';
}

function checkRateLimit(req, options = {}) {
  const now = Date.now();
  const windowMs = Number.isInteger(options.windowMs) ? options.windowMs : 60_000;
  const max = Number.isInteger(options.max) ? options.max : 30;
  const bucket = options.bucket || 'default';
  const key = `${bucket}:${getClientIp(req)}`;
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, max - 1), resetAt: now + windowMs };
  }
  entry.count += 1;
  if (entry.count > max) return { ok: false, remaining: 0, resetAt: entry.resetAt };
  return { ok: true, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
}

function requireRateLimit(req, res, options = {}) {
  const result = checkRateLimit(req, options);
  if (result.ok) return true;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
  res.status(429).json({ ok: false, status: 'RATE_LIMITED' });
  return false;
}

function resetRateLimitForTests() {
  buckets.clear();
}

module.exports = { checkRateLimit, requireRateLimit, resetRateLimitForTests, getClientIp };
