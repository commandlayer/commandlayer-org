'use strict';

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

function isAdminAuthorized(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;

  const bearer = extractBearerToken(req);
  if (bearer && bearer === expected) return true;

  const headerKey = req.headers['x-admin-api-key'];
  return Boolean(headerKey && headerKey === expected);
}

function requireAdminAuth(req, res) {
  if (isAdminAuthorized(req)) return true;
  res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
  return false;
}

module.exports = {
  extractBearerToken,
  isAdminAuthorized,
  requireAdminAuth,
};
