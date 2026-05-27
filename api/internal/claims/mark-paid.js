'use strict';

const db = require('../../../lib/db');

function logSafe(message, code, claimId, provider, step) {
  console.log(JSON.stringify({ message, code, claimId: claimId || null, provider: provider || null, step: step || null }));
}

function normalizedBody(body) {
  const claimId = body.claimId;
  const provider = typeof body.provider === 'string' ? body.provider.toLowerCase() : body.provider;
  const providerPaymentId = body.providerPaymentId || null;
  const paymentIntentId = body.paymentIntentId || body.stripePaymentIntentId || null;
  const stripeCheckoutSessionId = body.stripeCheckoutSessionId || providerPaymentId || null;
  const amountCents = body.amountCents;
  const currency = (body.currency || 'usd').toLowerCase();
  return { claimId, provider, providerPaymentId, paymentIntentId, stripeCheckoutSessionId, amountCents, currency };
}

function errorPayload(status, httpStatus, debug) {
  const payload = { ok: false, status };
  if (process.env.NODE_ENV !== 'production' && debug) payload.debug = debug;
  return { httpStatus, payload };
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
    logSafe('Internal payment confirmation endpoint not configured', 'INTERNAL_PAYMENT_CONFIRMATION_NOT_CONFIGURED', null, null, 'config');
    return res.status(503).json({ ok: false, status: 'INTERNAL_PAYMENT_CONFIRMATION_NOT_CONFIGURED' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  const expected = `Bearer ${sharedSecret}`;
  if (authHeader !== expected) {
    logSafe('Unauthorized internal payment confirmation request', 'UNAUTHORIZED', null, null, 'auth');
    return res.status(401).json({ ok: false, status: 'UNAUTHORIZED' });
  }
  logSafe('Authorization passed', 'AUTH_OK', null, null, 'auth');

  const body = req.body || {};
  const { claimId, provider, providerPaymentId, paymentIntentId, stripeCheckoutSessionId, amountCents, currency } = normalizedBody(body);
  logSafe('Parsed payment confirmation payload', 'PARSED_OK', claimId, provider, 'parse');

  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  if (!provider) return res.status(400).json({ ok: false, status: 'PROVIDER_REQUIRED' });
  if (provider !== 'stripe') return res.status(400).json({ ok: false, status: 'PROVIDER_NOT_SUPPORTED' });
  if (!providerPaymentId && !stripeCheckoutSessionId && !paymentIntentId) return res.status(400).json({ ok: false, status: 'PROVIDER_PAYMENT_ID_REQUIRED' });
  if (!Number.isInteger(amountCents) || amountCents <= 0) return res.status(400).json({ ok: false, status: 'INVALID_AMOUNT_CENTS' });

  try {
    const claimResult = await db.query('select claim_id, status from claim_requests where claim_id = $1 limit 1', [claimId]);
    const claim = claimResult.rows[0];
    logSafe('Claim lookup completed', 'CLAIM_LOOKUP_OK', claimId, provider, 'claim_lookup');
    if (!claim) {
      const err = errorPayload('CLAIM_NOT_FOUND', 404, { message: 'Claim lookup returned no rows', code: 'CLAIM_NOT_FOUND', step: 'claim_lookup' });
      return res.status(err.httpStatus).json(err.payload);
    }

    logSafe('Claim status evaluated', 'CLAIM_STATUS_CHECKED', claimId, provider, 'claim_status');
    if (claim.status !== 'payment_pending' && claim.status !== 'paid') {
      const err = errorPayload('CLAIM_NOT_READY_FOR_PAYMENT', 400, { message: 'Claim status does not allow payment confirmation', code: 'CLAIM_NOT_READY_FOR_PAYMENT', step: 'claim_status' });
      return res.status(err.httpStatus).json(err.payload);
    }

    const paymentUpdate = await db.query(
      `update claim_payments
       set status = 'paid', stripe_checkout_session_id = $3, stripe_payment_intent_id = $4,
           amount_cents = $5, currency = $6, updated_at = now()
       where claim_id = $1 and provider = $2`,
      [claimId, provider, stripeCheckoutSessionId, paymentIntentId, amountCents, currency]
    );
    logSafe('Payment row update attempted', 'PAYMENT_UPDATE_ATTEMPTED', claimId, provider, 'payment_update');

    if (!paymentUpdate.rowCount) {
      try {
        await db.query(
          `insert into claim_payments
           (claim_id, provider, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents, currency, status, metadata_json)
           values ($1, $2, $3, $4, $5, $6, 'paid', $7::jsonb)`,
          [claimId, provider, stripeCheckoutSessionId, paymentIntentId, amountCents, currency, JSON.stringify({ providerPaymentId })]
        );
        logSafe('Payment row inserted', 'PAYMENT_INSERT_OK', claimId, provider, 'payment_insert');
      } catch (insertError) {
        if (insertError && insertError.code === '23505') {
          await db.query(
            `update claim_payments
             set status = 'paid', stripe_checkout_session_id = $3, stripe_payment_intent_id = $4,
                 amount_cents = $5, currency = $6, updated_at = now()
             where claim_id = $1 and provider = $2`,
            [claimId, provider, stripeCheckoutSessionId, paymentIntentId, amountCents, currency]
          );
          logSafe('Payment row race resolved via retry update', 'PAYMENT_RETRY_UPDATE_OK', claimId, provider, 'payment_insert_retry');
        } else {
          throw Object.assign(insertError || new Error('payment insert failed'), { step: 'payment_insert', code: (insertError && insertError.code) || null });
        }
      }
    }

    if (claim.status === 'paid') {
      logSafe('Claim already paid; returning idempotent success', 'CLAIM_MARKED_PAID', claimId, provider, 'idempotent');
      return res.status(200).json({ ok: true, status: 'CLAIM_MARKED_PAID', claimId });
    }

    await db.query(
      `update claim_requests
       set status = 'paid', payment_status = 'paid', paid_at = now(),
           stripe_checkout_session_id = coalesce($2, stripe_checkout_session_id)
       where claim_id = $1
         and status in ('payment_pending', 'paid')`,
      [claimId, stripeCheckoutSessionId]
    );
    logSafe('Claim request updated to paid', 'CLAIM_REQUEST_UPDATED', claimId, provider, 'claim_update');

    try {
      await db.query(
        `insert into claim_events (claim_id, event_type, message, metadata_json)
         values ($1, 'payment.completed', 'Payment completed.', $2::jsonb)`,
        [claimId, JSON.stringify({ provider })]
      );
      logSafe('Optional payment event insert completed', 'EVENT_INSERT_OK', claimId, provider, 'event_insert');
    } catch (eventError) {
      logSafe('Optional payment event insert skipped', eventError.code || 'OPTIONAL_EVENT_INSERT_SKIPPED', claimId, provider, 'event_insert');
    }

    try {
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
      logSafe('Optional status transition recorded', 'TRANSITION_INSERT_OK', claimId, provider, 'transition_insert');
    } catch (transitionError) {
      logSafe('Optional status transition insert skipped', transitionError.code || 'OPTIONAL_TRANSITION_INSERT_SKIPPED', claimId, provider, 'transition_insert');
    }

    logSafe('Claim marked paid', 'CLAIM_MARKED_PAID', claimId, provider, 'done');
    return res.status(200).json({ ok: true, status: 'CLAIM_MARKED_PAID', claimId });
  } catch (error) {
    const step = error.step || 'unknown';
    const code = error.code || 'MARK_PAID_DB_FAILED';
    logSafe('Failed to confirm claim payment', code, claimId, provider, step);
    const err = errorPayload('MARK_PAID_DB_FAILED', 500, { message: error.message || 'mark-paid failed', code, step });
    return res.status(err.httpStatus).json(err.payload);
  }
};
