'use strict';

const { verifyReceipt } = require('../../lib/verifyReceipt');
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
    return res.status(405).json({
      agent: 'verifyagent.eth',
      action: 'verify_receipt',
      ok: false,
      status: 'INVALID',
      result: {
        reason: 'Method not allowed. Use POST.',
        hash: null,
        hash_matches: false,
        signature_valid: false,
        ens_resolved: false,
      },
    });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !req.body.receipt) {
    return res.status(400).json({
      agent: 'verifyagent.eth',
      action: 'verify_receipt',
      ok: false,
      status: 'INVALID',
      result: {
        reason: 'Missing receipt in request body.',
        hash: null,
        hash_matches: false,
        signature_valid: false,
        ens_resolved: false,
      },
    });
  }

  if (isOversizedJsonBody(req)) {
    return res.status(413).json({
      agent: 'verifyagent.eth',
      action: 'verify_receipt',
      ok: false,
      status: 'INVALID',
      result: {
        reason: 'JSON request body too large.',
        hash: null,
        hash_matches: false,
        signature_valid: false,
        ens_resolved: false,
      },
    });
  }

  try {
    const verification = await verifyReceipt(req.body.receipt);
    return res.status(200).json({
      agent: 'verifyagent.eth',
      action: 'verify_receipt',
      ok: verification.ok,
      status: verification.status,
      result: {
        reason: verification.reason,
        signer: verification.signer,
        verb: verification.verb,
        hash: verification.hash,
        hash_matches: verification.hash_matches,
        signature_valid: verification.signature_valid,
        ens_resolved: verification.ens_resolved,
        key_id: verification.key_id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      agent: 'verifyagent.eth',
      action: 'verify_receipt',
      ok: false,
      status: 'INVALID',
      result: {
        reason: `Unexpected verification failure: ${error.message}`,
        hash: null,
        hash_matches: false,
        signature_valid: false,
        ens_resolved: false,
      },
    });
  }
};
