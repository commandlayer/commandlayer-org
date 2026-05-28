'use strict';

const db = require('../db');

function isOptionalStorageError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.code === '42P01' || error.code === '42703' || error.code === 'DATABASE_URL_MISSING';
}

function normalizeReceiptJson(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
}

function normalizeReceiptRow(row) {
  if (!row || typeof row !== 'object') return null;
  return normalizeReceiptJson(
    row.receipt_json ||
      row.genesis_receipt_json ||
      row.body_json ||
      row.payload_json ||
      row.json ||
      row.receipt ||
      null,
  );
}

async function queryOne(queryText, params, label) {
  try {
    const result = await db.query(queryText, params);
    return result.rows[0] || null;
  } catch (error) {
    if (isOptionalStorageError(error)) {
      console.debug('[receipts.find] optional receipt lookup unavailable', { label, code: error.code });
      return null;
    }
    console.error('[receipts.find] receipt lookup failed', { label, code: error && error.code ? error.code : null });
    return null;
  }
}

async function findReceiptById(receiptId) {
  if (typeof receiptId !== 'string' || !receiptId.trim()) return null;
  const normalizedId = receiptId.trim();

  const claimRow = await queryOne(
    `select genesis_receipt_json
     from claim_requests
     where genesis_receipt_id = $1
     limit 1`,
    [normalizedId],
    'claim_requests.genesis_receipt_id',
  );
  const claimReceipt = normalizeReceiptRow(claimRow);
  if (claimReceipt) return claimReceipt;

  const receiptRow = await queryOne(
    `select *
     from receipts
     where receipt_id = $1
     limit 1`,
    [normalizedId],
    'receipts.receipt_id',
  );
  const storedReceipt = normalizeReceiptRow(receiptRow);
  if (storedReceipt) return storedReceipt;

  return null;
}

module.exports = {
  findReceiptById,
  _private: {
    isOptionalStorageError,
    normalizeReceiptJson,
    normalizeReceiptRow,
  },
};
