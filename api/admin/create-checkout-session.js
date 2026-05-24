'use strict';

const createStripeClient = require('../../lib/stripe-client');
const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

function asServiceUnavailable(res, status, error) {
  return res.status(503).json({ ok: false, status, error });
}

function asConflict(res, status, error) {
  return res.status(409).json({ ok: false, status, error });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }
  if (!requireAdminAuth(req, res)) return;

  const body = req.body || {};
  const claimId = typeof body.claimId === 'string' ? body.claimId.trim() : '';
  if (!claimId) return res.status(400).json({ ok: false, status: 'INVALID_CLAIM_ID' });

  let stripe;
  try {
    stripe = createStripeClient(process.env.STRIPE_SECRET_KEY);
  } catch (error) {
    if (error?.code === 'STRIPE_NOT_CONFIGURED') {
      return asServiceUnavailable(res, 'STRIPE_NOT_CONFIGURED', 'Stripe secret key is not configured.');
    }
    if (error?.code === 'STRIPE_SECRET_KEY_INVALID') {
      return asServiceUnavailable(res, 'STRIPE_SECRET_KEY_INVALID', error.message);
    }
    console.error('ADMIN_CREATE_CHECKOUT_STRIPE_INIT_FAILED', { message: error?.message, code: error?.code, claimId });
    return asServiceUnavailable(res, 'STRIPE_NOT_CONFIGURED', 'Stripe secret key is not configured.');
  }

  try {
    const claims = db.normalizeRows(await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]));
    if (!claims.length) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND', error: 'Claim not found.' });

    const claim = claims[0];
    if (claim.status === 'paid' || claim.payment_status === 'paid') {
      return asConflict(res, 'PAYMENT_ALREADY_COMPLETED', 'Payment is already completed for this claim.');
    }

    if (!['cards_published', 'payment_pending'].includes(claim.status)) {
      return asConflict(res, 'CLAIM_NOT_READY_FOR_PAYMENT', 'Claim must be cards_published before creating checkout.');
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

    const siteUrl = process.env.COMMANDLAYER_SITE_URL || 'https://www.commandlayer.org';
    const successUrl = `${siteUrl}/claim/status.html?claimId=${encodeURIComponent(claimId)}&payment=success`;
    const cancelUrl = `${siteUrl}/claim/status.html?claimId=${encodeURIComponent(claimId)}&payment=cancelled`;

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 2000,
            product_data: {
              name: 'CommandLayer Founding Activation',
              description: '10 Trust Verification agent namespaces'
            }
          }
        }],
        metadata: {
          claimId,
          tenant: claim.tenant || '',
          packId: claim.pack_id || '',
          product: 'founding_activation'
        }
      });
    } catch (error) {
      console.error('ADMIN_CREATE_CHECKOUT_SESSION_FAILED', { message: error?.message, code: error?.code, claimId });
      const payload = {
        ok: false,
        status: 'CHECKOUT_SESSION_CREATE_FAILED',
        error: 'Unable to create Stripe checkout session.'
      };
      if (process.env.NODE_ENV !== 'production') {
        payload.debug = { message: error?.message || 'Unknown Stripe error', code: error?.code || null };
      }
      return res.status(502).json(payload);
    }

    await db.query(
      `insert into claim_payments (claim_id, provider, stripe_checkout_session_id, amount_cents, currency, status, metadata_json)
       values ($1, 'stripe', $2, $3, 'usd', 'pending', $4::jsonb)
       on conflict (stripe_checkout_session_id)
       do update set status = excluded.status, metadata_json = excluded.metadata_json, updated_at = now()`,
      [claimId, session.id, 2000, JSON.stringify({ checkoutUrl: session.url || null })]
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
      [claimId, 2000, session.id]
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
    console.error('ADMIN_CREATE_CHECKOUT_SESSION_UNEXPECTED', { message: error?.message, code: error?.code, claimId });
    return res.status(500).json({ ok: false, status: 'ADMIN_CREATE_CHECKOUT_SESSION_FAILED', error: 'Failed to create checkout session.' });
  }
};
