'use strict';

const { verifyCoinbaseWebhook } = require('../../lib/coinbaseWebhook');
const { signReceipt, resolveReceiptSigningConfigFromEnv, hasValidSigningConfig } = require('../../lib/receiptSigning');

const seenReceipts = new Map();


function normalizeReceipt(event, signerId) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('unsupported_event_shape');
  }

  const eventId = event.id || event.event_id;
  const eventType = event.type;
  if (!eventId || typeof eventId !== 'string' || !eventType || typeof eventType !== 'string') {
    throw new Error('unsupported_event_shape');
  }

  const txHash = event?.data?.transactionHash || event?.transactionHash || null;
  return {
    receipt_id: `rcpt:coinbase_cdp:${eventId}`,
    signer: signerId,
    verb: 'observe',
    source: 'coinbase.cdp.webhook',
    subject: {
      type: eventType,
      id: txHash || eventId,
    },
    input: {
      raw_event_summary: {
        id: eventId,
        type: eventType,
        transactionHash: txHash,
      },
    },
    output: {
      observation: {
        accepted: true,
        provider: 'coinbase_cdp',
        event_type: eventType,
      },
    },
    execution: {
      status: 'succeeded',
    },
    ts: new Date().toISOString(),
    metadata: {
      trace: {
        trace_id: `coinbase:${eventId}`,
        span_id: 'coinbase.webhook.verified',
        timestamp: new Date().toISOString(),
        tags: {
          provider: 'coinbase_cdp',
          event_type: eventType,
        },
      },
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  const secret = process.env.COINBASE_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ ok: false, status: 'configuration_unavailable' });
  }

  const verified = verifyCoinbaseWebhook(req, secret);
  if (!verified.ok) {
    return res.status(verified.httpStatus).json({ ok: false, status: verified.code });
  }

  const signingCfg = resolveReceiptSigningConfigFromEnv();
  if (!hasValidSigningConfig(signingCfg)) {
    return res.status(503).json({ ok: false, status: 'signing_unavailable' });
  }

  const eventId = verified.event?.id || verified.event?.event_id;
  if (!eventId) {
    return res.status(400).json({ ok: false, status: 'normalization_failed' });
  }

  if (seenReceipts.has(eventId)) {
    return res.status(200).json({ ok: true, status: 'WEBHOOK_VERIFIED_AND_SIGNED', duplicate: true, receipt: seenReceipts.get(eventId) });
  }

  try {
    const unsignedReceipt = normalizeReceipt(verified.event, signingCfg.signerId);
    const receipt = await signReceipt(unsignedReceipt, signingCfg);

    seenReceipts.set(eventId, receipt);
    return res.status(200).json({ ok: true, status: 'WEBHOOK_VERIFIED_AND_SIGNED', duplicate: false, receipt });
  } catch (error) {
    if (error && error.message === 'unsupported_event_shape') {
      return res.status(400).json({ ok: false, status: 'normalization_failed' });
    }
    return res.status(503).json({ ok: false, status: 'signing_unavailable' });
  }
};

module.exports._internal = {
  clearSeen: () => seenReceipts.clear(),
  seenReceipts,
};
