'use strict';

const Stripe = require('../../lib/stripe-client');
const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  if (!requireAdminAuth(req, res)) return;

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ ok: false, status: 'STRIPE_NOT_CONFIGURED' });
  }

  const body = req.body || {};
  const claimId = typeof body.claimId === 'string' ? body.claimId.trim() : '';
  if (!claimId) return res.status(400).json({ ok: false, status: 'INVALID_CLAIM_ID' });

  try {
    const claims = db.normalizeRows(await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]));
    if (!claims.length) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    const claim = claims[0];
    if (claim.status === 'paid' || claim.payment_status === 'paid') {
      return res.status(409).json({ ok: false, status: 'PAYMENT_ALREADY_COMPLETED' });
    }

    if (!['cards_published', 'payment_pending'].includes(claim.status)) {
      return res.status(409).json({ ok: false, status: 'CLAIM_NOT_READY_FOR_PAYMENT' });
    }

    if (claim.status === 'payment_pending' && claim.stripe_checkout_session_id) {
      return res.status(200).json({
        ok: true,
        status: 'CHECKOUT_SESSION_CREATED',
        claimId,
        checkoutUrl: claim.stripe_checkout_url || null,
        sessionId: claim.stripe_checkout_session_id
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const priceCents = Number.parseInt(process.env.STRIPE_FOUNDING_PRICE_CENTS || '2000', 10) || 2000;
    const siteUrl = process.env.COMMANDLAYER_SITE_URL || 'https://www.commandlayer.org';
    const successUrl = `${siteUrl}/claim/status.html?claimId=${encodeURIComponent(claimId)}&payment=success`;
    const cancelUrl = `${siteUrl}/claim/status.html?claimId=${encodeURIComponent(claimId)}&payment=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: priceCents,
          product_data: { name: 'Founding Activation' }
        }
      }],
      metadata: {
        claimId,
        tenant: claim.tenant || '',
        packId: claim.pack_id || '',
        product: 'founding_activation'
      }
    });

    await db.query(
      `insert into claim_payments (claim_id, provider, stripe_checkout_session_id, amount_cents, currency, status, metadata_json)
       values ($1, 'stripe', $2, $3, 'usd', 'pending', $4::jsonb)
       on conflict (stripe_checkout_session_id)
       do update set status = excluded.status, metadata_json = excluded.metadata_json, updated_at = now()`,
      [claimId, session.id, priceCents, JSON.stringify({ checkoutUrl: session.url || null })]
    );

    const fromStatus = claim.status;
    await db.query(
      `update claim_requests
       set status = 'payment_pending',
           payment_status = 'pending',
           payment_amount_cents = $2,
           payment_currency = 'usd',
           stripe_checkout_session_id = $3
       where claim_id = $1`,
      [claimId, priceCents, session.id]
    );

    await db.query(
      `insert into claim_events (claim_id, event_type, actor, message, event_json)
       values ($1, 'payment.checkout_created', 'system', $2, $3::jsonb)`,
      [claimId, 'Stripe checkout created.', JSON.stringify({ sessionId: session.id, checkoutUrl: session.url || null })]
    );

    if (fromStatus === 'cards_published') {
      await db.query(
        `insert into claim_status_transitions (claim_id, from_status, to_status, action, actor, metadata_json)
         values ($1, 'cards_published', 'payment_pending', 'create_checkout', 'system', $2::jsonb)`,
        [claimId, JSON.stringify({ sessionId: session.id })]
      );
    }

    return res.status(200).json({ ok: true, status: 'CHECKOUT_SESSION_CREATED', claimId, checkoutUrl: session.url || null, sessionId: session.id });
  } catch (error) {
    console.error('ADMIN_CREATE_CHECKOUT_SESSION_FAILED', { message: error.message, code: error.code });
    return res.status(500).json({ ok: false, status: 'ADMIN_CREATE_CHECKOUT_SESSION_FAILED', error: 'Failed to create checkout session.' });
  }
};
