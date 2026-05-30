'use strict';

const crypto = require('node:crypto');
const { isAdminAuthorized } = require('../../api/admin/_auth');

const TOKEN_BYTES = 32;
const TOKEN_HASH_ALG = 'sha256';

function generateClaimAccessToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashClaimAccessToken(token) {
  return crypto.createHash(TOKEN_HASH_ALG).update(String(token || ''), 'utf8').digest('hex');
}

function extractClaimAccessToken(req) {
  const headers = req && req.headers ? req.headers : {};
  const headerValue = headers['x-claim-access-token'] || headers['X-Claim-Access-Token'];
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const bodyValue = body.claimAccessToken || body.claim_access_token;
  return typeof bodyValue === 'string' ? bodyValue.trim() : '';
}

function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isValidClaimAccessToken(req, storedHash) {
  const token = extractClaimAccessToken(req);
  if (!token || !storedHash) return false;
  return constantTimeEqualHex(hashClaimAccessToken(token), storedHash);
}

function getClaimAuth(req, claim) {
  if (isAdminAuthorized(req)) return { ok: true, via: 'admin' };
  if (isValidClaimAccessToken(req, claim && claim.claim_access_token_hash)) return { ok: true, via: 'claim_token' };
  return { ok: false, via: 'none' };
}

function unauthorizedClaimResponse(res) {
  return res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
}

function stripClaimSecrets(row) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  delete copy.claim_access_token_hash;
  delete copy.claimAccessToken;
  delete copy.claim_access_token;
  return copy;
}

module.exports = {
  generateClaimAccessToken,
  hashClaimAccessToken,
  extractClaimAccessToken,
  constantTimeEqualHex,
  isValidClaimAccessToken,
  getClaimAuth,
  unauthorizedClaimResponse,
  stripClaimSecrets,
};
