'use strict';

const Stripe = require('../../lib/stripe-client');
const db = require('../../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ ok: false, status: 'STRIPE_NOT_CONFIGURED' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'] || req.headers['Stripe-Signature'];
  const rawBody = req.rawBody || req.body;

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return res.status(400).json({ ok: false, status: 'WEBHOOK_SIGNATURE_INVALID' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ ok: true, status: 'WEBHOOK_EVENT_UNHANDLED' });
  }

  const session = event.data && event.data.object ? event.data.object : {};
  const claimId = session.metadata && session.metadata.claimId;
  if (!claimId) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

  const claims = db.normalizeRows(await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]));
  if (!claims.length) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
  if (claims[0].status === 'paid' || claims[0].payment_status === 'paid') return res.status(200).json({ ok: true });

  await db.query(
    `update claim_payments
     set status = 'paid', stripe_payment_intent_id = $2, updated_at = now()
     where stripe_checkout_session_id = $1 or claim_id = $3`,
    [session.id || null, session.payment_intent || null, claimId]
  );
  await db.query(
    `update claim_requests
     set status = 'paid', payment_status = 'paid', stripe_payment_intent_id = $2, paid_at = now()
     where claim_id = $1`,
    [claimId, session.payment_intent || null]
  );
  await db.query(
    `insert into claim_events (claim_id, event_type, actor, message, event_json)
     values ($1, 'payment.completed', 'system', 'Stripe payment completed.', $2::jsonb)`,
    [claimId, JSON.stringify({ sessionId: session.id || null, paymentIntentId: session.payment_intent || null })]
  );
  await db.query(
    `insert into claim_status_transitions (claim_id, from_status, to_status, action, actor, metadata_json)
     values ($1, 'payment_pending', 'paid', 'payment_webhook', 'system', $2::jsonb)`,
    [claimId, JSON.stringify({ sessionId: session.id || null })]
  );

  return res.status(200).json({ ok: true });
};
