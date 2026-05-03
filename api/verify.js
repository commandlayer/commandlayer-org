'use strict';

const { verifyReceipt } = require('../lib/verifyReceipt');
const MAX_JSON_BODY_BYTES = 1024 * 1024; // 1 MiB

function isOversizedJsonBody(req) {
  const contentLengthHeader = req?.headers?.['content-length'] || req?.headers?.['Content-Length'];
  const parsedContentLength = Number.parseInt(String(contentLengthHeader || ''), 10);
  if (Number.isFinite(parsedContentLength) && parsedContentLength > MAX_JSON_BODY_BYTES) {
    return true;
  }

  if (!req?.body || typeof req.body !== 'object') return false;
  try {
    return Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_JSON_BODY_BYTES;
  } catch {
    return false;
  }
}

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

  if (isOversizedJsonBody(req)) {
    return res.status(413).json({ ok: false, status: 'INVALID', reason: 'JSON request body too large.' });
  }

  try {
    const result = await verifyReceipt(req.body);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'INVALID', reason: `Unexpected verification failure: ${error.message}` });
  }
};
