'use strict';

function requireAdminAuth(req, res) {
  const configured = process.env.ADMIN_API_KEY;
  if (!configured) {
    res.status(503).json({ ok: false, status: 'ADMIN_NOT_CONFIGURED' });
    return false;
  }

  const authorization = req.headers && (req.headers.authorization || req.headers.Authorization);
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  if (!token || token !== configured) {
    res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
    return false;
  }

  return true;
}

module.exports = {
  requireAdminAuth
};
