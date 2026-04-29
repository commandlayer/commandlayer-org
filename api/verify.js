'use strict';

const { verifyReceipt } = require('../lib/verifyReceipt');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'INVALID', reason: 'Method not allowed. Use POST.' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ ok: false, status: 'INVALID', reason: 'Missing or invalid JSON body.' });
  }

  try {
    const result = await verifyReceipt(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'INVALID', reason: `Unexpected verification failure: ${error.message}` });
  }
};
