'use strict';

const { findReceiptById } = require('../../lib/receipts/find-receipt-by-id');

const MAX_RECEIPT_ID_LENGTH = 256;
const RECEIPT_ID_RE = /^[A-Za-z0-9._:-]+$/;

function normalizeReceiptId(value) {
  if (Array.isArray(value)) return null;
  if (typeof value !== 'string') return null;
  const receiptId = value.trim();
  if (!receiptId || receiptId.length > MAX_RECEIPT_ID_LENGTH || !RECEIPT_ID_RE.test(receiptId)) return null;
  return receiptId;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  const receiptId = normalizeReceiptId(req.query && req.query.id);
  if (!receiptId) return res.status(400).json({ ok: false, status: 'BAD_REQUEST' });

  const receipt = await findReceiptById(receiptId);
  if (!receipt) return res.status(404).json({ ok: false, status: 'RECEIPT_NOT_FOUND', receipt_id: receiptId });

  return res.status(200).json(receipt);
};

module.exports._private = { normalizeReceiptId };
