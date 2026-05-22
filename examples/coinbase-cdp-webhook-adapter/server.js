const express = require('express');
const { verifyCoinbaseWebhook } = require('./verifyCoinbaseWebhook');

const app = express();
const seenEventIds = new Set();

const PORT = Number(process.env.PORT || 3001);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const FRESHNESS_WINDOW_SECONDS = Number(process.env.FRESHNESS_WINDOW_SECONDS || 300);

function normalizeToClasObserveReceipt(event, verification) {
  return {
    kind: 'observe_receipt',
    source: 'coinbase_cdp_webhook',
    observed_at: new Date().toISOString(),
    event_id: event.id || event.event_id || 'unknown_event_id',
    event_type: event.type || 'unknown_event_type',
    payload: event,
    metadata: {
      trace: {
        provider: 'coinbase_cdp',
        signature_header: 'X-Hook0-Signature',
        signature_timestamp: verification.signature.t,
        signed_header_names: verification.signature.h,
        signed_header_values: verification.signedHeaderValues
      },
      proof: {
        type: 'commandlayer_signature_pending',
        note: 'Hook for CommandLayer signing step. Coinbase HMAC proves sender authenticity to this server only; public verifiability starts after CommandLayer signs this normalized receipt.'
      }
    }
  };
}

app.post('/coinbase/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const verification = verifyCoinbaseWebhook({
      rawBody: req.body,
      headers: req.headers,
      webhookSecret: WEBHOOK_SECRET,
      toleranceSeconds: FRESHNESS_WINDOW_SECONDS
    });

    const event = JSON.parse(req.body.toString('utf8'));
    const eventId = event.id || event.event_id;

    if (eventId && seenEventIds.has(eventId)) {
      return res.status(200).json({ status: 'duplicate_ignored', event_id: eventId });
    }
    if (eventId) seenEventIds.add(eventId);

    const normalizedReceipt = normalizeToClasObserveReceipt(event, verification);

    return res.status(200).json({
      status: 'accepted',
      normalized_receipt: normalizedReceipt
    });
  } catch (error) {
    return res.status(400).json({
      status: 'rejected',
      reason: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Coinbase CDP webhook adapter example listening on http://localhost:${PORT}`);
  console.log('This is an example adapter only. Do not deploy as-is to production.');
});
