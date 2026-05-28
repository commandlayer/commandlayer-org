'use strict';

const { verifyReceipt } = require('../lib/verifyReceipt');
const { findReceiptById } = require('../lib/receipts/find-receipt-by-id');

const MAX_RECEIPT_ID_LENGTH = 256;
const RECEIPT_ID_RE = /^[A-Za-z0-9._:-]+$/;

function resolveCorsOrigin(originHeader) {
  if (!originHeader || typeof originHeader !== 'string') return null;
  if (originHeader === 'https://www.commandlayer.org' || originHeader === 'https://commandlayer.org') return originHeader;
  if (originHeader.startsWith('chrome-extension://')) return originHeader;
  return null;
}

function normalizeReceiptId(value) {
  if (typeof value !== 'string') return null;
  const receiptId = value.trim();
  if (!receiptId || receiptId.length > MAX_RECEIPT_ID_LENGTH || !RECEIPT_ID_RE.test(receiptId)) return null;
  return receiptId;
}

function inferReceiptType(receipt) {
  const raw = typeof receipt?.receipt_type === 'string' ? receipt.receipt_type.trim().toLowerCase() : '';
  if (['genesis', 'execution', 'observe', 'action', 'workflow'].includes(raw)) return raw;
  return 'unknown';
}

function compactVerification(receiptId, receipt, verification) {
  const receiptType = inferReceiptType(receipt);
  if (!verification.ok) {
    return {
      ok: false,
      status: 'INVALID',
      receipt_id: receiptId,
      reason: verification.reason || 'Receipt is invalid.',
    };
  }

  return {
    ok: true,
    receipt_id: receiptId,
    status: 'VERIFIED',
    receipt_type: receiptType,
    agent: receipt?.agent || null,
    verb: receipt?.verb || null,
    signer: verification.signer || receipt?.signer || null,
    verified_at: new Date().toISOString(),
    verification: {
      hash_matches: Boolean(verification.hash_matches),
      signature_valid: Boolean(verification.signature_valid),
      ens_resolved: Boolean(verification.ens_resolved),
      public_key_source: verification.public_key_source || null,
      key_id: verification.key_id || null,
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const allowedOrigin = resolveCorsOrigin(req?.headers?.origin || req?.headers?.Origin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ ok: false, status: 'BAD_REQUEST' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ ok: false, status: 'BAD_REQUEST' });
  }

  const receiptId = normalizeReceiptId(req.body.receipt_id);
  if (!receiptId) {
    return res.status(400).json({ ok: false, status: 'BAD_REQUEST' });
  }

  const receipt = await findReceiptById(receiptId);
  if (!receipt) {
    return res.status(404).json({ ok: false, status: 'RECEIPT_NOT_FOUND', receipt_id: receiptId });
  }

  try {
    const verification = await verifyReceipt(receipt, req.verifyOptions || {});
    return res.status(200).json(compactVerification(receiptId, receipt, verification));
  } catch (error) {
    console.error('[verify-id] unexpected verification failure', { code: error && error.code ? error.code : null });
    return res.status(200).json({ ok: false, status: 'INVALID', receipt_id: receiptId, reason: 'Receipt verification failed.' });
  }
};

module.exports._private = {
  normalizeReceiptId,
  inferReceiptType,
  compactVerification,
};
