'use strict';

const db = require('../../../lib/db');

function logSafe(message, code, claimId, provider) {
  console.log(JSON.stringify({ message, code, claimId: claimId || null, provider: provider || null }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  const sharedSecret = process.env.COMMERCIAL_WEBHOOK_SHARED_SECRET;
  if (!sharedSecret) {
    logSafe('Internal payment confirmation endpoint not configured', 'INTERNAL_PAYMENT_CONFIRMATION_NOT_CONFIGURED');
    return res.status(503).json({ ok: false, status: 'INTERNAL_PAYMENT_CONFIRMATION_NOT_CONFIGURED' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  const expected = `Bearer ${sharedSecret}`;
  if (authHeader !== expected) {
    logSafe('Unauthorized internal payment confirmation request', 'UNAUTHORIZED');
    return res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
  }

  const body = req.body || {};
  const claimId = body.claimId;
  const provider = body.provider;
  const providerPaymentId = body.providerPaymentId;
  const paymentIntentId = body.paymentIntentId || null;
  const amountCents = body.amountCents;
  const currency = (body.currency || 'usd').toLowerCase();

  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  if (!provider) return res.status(400).json({ ok: false, status: 'PROVIDER_REQUIRED' });
  if (provider !== 'stripe') return res.status(400).json({ ok: false, status: 'PROVIDER_NOT_SUPPORTED' });
  if (!providerPaymentId) return res.status(400).json({ ok: false, status: 'PROVIDER_PAYMENT_ID_REQUIRED' });
  if (!Number.isInteger(amountCents) || amountCents <= 0) return res.status(400).json({ ok: false, status: 'INVALID_AMOUNT_CENTS' });

  try {
    const claimResult = await db.query('select claim_id, status from claim_requests where claim_id = $1 limit 1', [claimId]);
    const claim = claimResult.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    if (claim.status !== 'payment_pending' && claim.status !== 'paid') {
      return res.status(400).json({ ok: false, status: 'CLAIM_NOT_READY_FOR_PAYMENT' });
    }

    await db.query(
      `update claim_payments
       set status = 'paid', provider_payment_id = $3, payment_intent_id = $4, amount_cents = $5, currency = $6, updated_at = now()
       where claim_id = $1 and provider = $2`,
      [claimId, provider, providerPaymentId, paymentIntentId, amountCents, currency]
    );

    await db.query(
      `update claim_payments
       set status = 'paid', claim_id = $1, provider = $2, payment_intent_id = $4, amount_cents = $5, currency = $6, updated_at = now()
       where provider_payment_id = $3`,
      [claimId, provider, providerPaymentId, paymentIntentId, amountCents, currency]
    );

    if (claim.status === 'paid') {
      logSafe('Claim already paid; returning idempotent success', 'CLAIM_MARKED_PAID', claimId, provider);
      return res.status(200).json({ ok: true, status: 'CLAIM_MARKED_PAID', claimId });
    }

    await db.query(
      `update claim_requests
       set status = 'paid', payment_status = 'paid', payment_amount_cents = $2,
           payment_currency = $3, stripe_checkout_session_id = $4,
           stripe_payment_intent_id = $5, paid_at = now(), updated_at = now()
       where claim_id = $1`,
      [claimId, amountCents, currency, providerPaymentId, paymentIntentId]
    );

    await db.query(
      `insert into claim_events (claim_id, event_type, message, metadata_json)
       values ($1, 'payment.completed', 'Payment completed.', $2::jsonb)`,
      [claimId, JSON.stringify({ provider })]
    );

    const transitionExists = await db.query(
      `select 1 from claim_status_transitions
       where claim_id = $1 and from_status = 'payment_pending' and to_status = 'paid'
       limit 1`,
      [claimId]
    );
    if (!transitionExists.rows.length) {
      await db.query(
        `insert into claim_status_transitions (claim_id, from_status, to_status)
         values ($1, 'payment_pending', 'paid')`,
        [claimId]
      );
    }

    logSafe('Claim marked paid', 'CLAIM_MARKED_PAID', claimId, provider);
    return res.status(200).json({ ok: true, status: 'CLAIM_MARKED_PAID', claimId });
  } catch (error) {
    logSafe('Failed to confirm claim payment', 'PAYMENT_CONFIRMATION_FAILED', claimId, provider);
    return res.status(500).json({ ok: false, status: 'PAYMENT_CONFIRMATION_FAILED' });
  }
};
