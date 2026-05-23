'use strict';

const { signReceipt, resolveReceiptSigningConfigFromEnv, hasValidSigningConfig } = require('../../lib/receiptSigning');

const seenReceipts = new Map();
const MAX_TEXT_LENGTH = 4000;

function buildDeterministicSummary(text) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const prefix = normalized.slice(0, 120);
  return prefix.length < normalized.length ? `${prefix}…` : prefix;
}

function normalizePaidActionReceipt(payload, signerId) {
  const timestamp = new Date().toISOString();
  const paymentId = payload.payment.payment_id;
  const requestId = payload.request_id;

  return {
    receipt_id: `rcpt:x402:${paymentId}:${requestId}`,
    signer: signerId,
    verb: 'summarize',
    source: 'x402.paid_action',
    subject: {
      type: 'paid_action',
      id: requestId,
    },
    input: {
      action: payload.action,
      text: payload.input.text,
      payment: {
        payment_id: paymentId,
        protocol: payload.payment.protocol,
        status: payload.payment.status,
        asset: payload.payment.asset || null,
        amount: payload.payment.amount || null,
        network: payload.payment.network || null,
      },
    },
    output: {
      summary: buildDeterministicSummary(payload.input.text),
      payment_accepted: true,
    },
    execution: { status: 'succeeded' },
    ts: timestamp,
    metadata: {
      trace: {
        trace_id: `x402:${requestId}`,
        span_id: 'x402.paid_action.executed',
        timestamp,
        tags: {
          payment_protocol: 'x402',
          payment_id: paymentId,
          action: 'summarize.text',
        },
      },
    },
  };
}

function parsePayload(body) {
  if (!body) return null;
  if (typeof body === 'object' && !Array.isArray(body)) return body;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  let payload;
  try {
    payload = parsePayload(req.body);
  } catch {
    return res.status(400).json({ ok: false, status: 'malformed_payload' });
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ ok: false, status: 'malformed_payload' });
  }

  if (!payload.payment || typeof payload.payment !== 'object' || Array.isArray(payload.payment)) {
    return res.status(402).json({ ok: false, status: 'payment_required' });
  }

  const { request_id: requestId, action, input, payment } = payload;

  if (!requestId || typeof requestId !== 'string' || !action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, status: 'malformed_payload' });
  }

  if (action !== 'summarize.text') {
    return res.status(400).json({ ok: false, status: 'unsupported_action' });
  }

  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.text !== 'string') {
    return res.status(400).json({ ok: false, status: 'malformed_payload' });
  }

  if (input.text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ ok: false, status: 'malformed_payload' });
  }

  if (payment.protocol !== 'x402' || payment.status !== 'accepted' || typeof payment.payment_id !== 'string' || !payment.payment_id.trim()) {
    return res.status(400).json({ ok: false, status: 'payment_invalid' });
  }

  const dedupeKey = `${requestId}::${payment.payment_id}`;
  if (seenReceipts.has(dedupeKey)) {
    return res.status(200).json({ ok: true, status: 'PAID_ACTION_EXECUTED_AND_SIGNED', duplicate: true, receipt: seenReceipts.get(dedupeKey) });
  }

  const signingCfg = resolveReceiptSigningConfigFromEnv();
  if (!hasValidSigningConfig(signingCfg)) {
    return res.status(503).json({ ok: false, status: 'signing_unavailable' });
  }

  try {
    const unsignedReceipt = normalizePaidActionReceipt(payload, signingCfg.signerId || 'runtime.commandlayer.eth');
    const receipt = await signReceipt(unsignedReceipt, signingCfg);
    seenReceipts.set(dedupeKey, receipt);
    return res.status(200).json({ ok: true, status: 'PAID_ACTION_EXECUTED_AND_SIGNED', duplicate: false, receipt });
  } catch {
    return res.status(503).json({ ok: false, status: 'signing_unavailable' });
  }
};

module.exports._internal = {
  clearSeen: () => seenReceipts.clear(),
  seenReceipts,
  normalizePaidActionReceipt,
  buildDeterministicSummary,
};
