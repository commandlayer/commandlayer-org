'use strict';

const MAX_JSON_BODY_BYTES = 1024 * 1024;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function bodyTooLarge(req) {
  const raw = req?.headers?.['content-length'] || req?.headers?.['Content-Length'];
  const length = Number.parseInt(String(raw || ''), 10);
  if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) return true;
  try {
    return req?.body && Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_JSON_BODY_BYTES;
  } catch {
    return false;
  }
}

async function installedVerifier() {
  const module = await import('verifyagent/factory-execution-evidence');
  if (typeof module.verifyFactoryExecutionEvidenceReceipt !== 'function') {
    throw new Error('VerifyAgent factory verifier export is unavailable');
  }
  return module.verifyFactoryExecutionEvidenceReceipt;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end?.() || res.status(204);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    return res.status(405).json({ ok: false, status: 'INVALID', reason: 'Method not allowed. Use POST.' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ ok: false, status: 'INVALID', reason: 'Missing or invalid JSON body.' });
  }
  if (bodyTooLarge(req)) {
    return res.status(413).json({ ok: false, status: 'INVALID', reason: 'JSON request body too large.' });
  }

  const receipt = req.body.receipt || req.body;
  const injected = typeof req.factoryVerify === 'function' ? req.factoryVerify : null;
  const keyUrl = req.factoryKeyUrl || process.env.COMMANDLAYER_RECEIPT_KEY_URL;
  if (!injected && !nonEmpty(keyUrl)) {
    return res.status(503).json({
      ok: false,
      status: 'INDETERMINATE',
      reason: 'FACTORY_TRUST_ROOT_NOT_CONFIGURED',
      truth_certified: false,
      proof_scope: 'execution_integrity_and_provenance',
    });
  }

  try {
    const verify = injected || await installedVerifier();
    const options = req.factoryVerifyOptions || { keyDocument: { url: keyUrl.trim() } };
    const result = await verify(receipt, options);
    return res.status(200).json({
      agent: 'verifyagent.eth',
      action: 'verify_factory_execution_receipt',
      ...result,
    });
  } catch {
    return res.status(503).json({
      ok: false,
      status: 'INDETERMINATE',
      reason: 'FACTORY_VERIFIER_UNAVAILABLE',
      truth_certified: false,
      proof_scope: 'execution_integrity_and_provenance',
    });
  }
};

module.exports.MAX_JSON_BODY_BYTES = MAX_JSON_BODY_BYTES;
