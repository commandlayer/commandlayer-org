'use strict';

const crypto = require('node:crypto');

const NONCE_BYTES = 16;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'AUTH_FAILED', error: 'Method not allowed. Use GET.' });
  }

  const nonce = crypto.randomBytes(NONCE_BYTES).toString('hex');
  return res.status(200).json({ ok: true, nonce });
};
