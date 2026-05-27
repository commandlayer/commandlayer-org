'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

const READY_STATUSES = new Set(['cards_published', 'payment_pending']);

function parseJsonBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (typeof req.body === 'object') return req.body;
  return null;
}

function safeLog(message, code, claimId) {
  console.error('[admin.create-checkout-session]', { message, code: code || null, claimId: claimId || null });
}

async function hasColumn(tableName, columnName) {
  const result = await db.query(
    `select 1
       from information_schema.columns
      where table_name = $1 and column_name = $2
      limit 1`,
    [tableName, columnName],
  );
  return result.rows.length > 0;
}

async function createStripeCheckoutSession({ stripeSecretKey, amountCents, siteUrl, claim }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${siteUrl}/claim/status.html?claimId=${encodeURIComponent(claim.claim_id)}&payment=success`);
  params.set('cancel_url', `${siteUrl}/claim/status.html?claimId=${encodeURIComponent(claim.claim_id)}&payment=cancel`);
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', 'CommandLayer Founding Activation');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[claimId]', claim.claim_id);
  params.set('metadata[tenant]', claim.tenant || '');
  params.set('metadata[packId]', claim.pack_id || '');

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload || !payload.id || !payload.url) {
    const error = new Error('Failed to create Stripe checkout session');
    error.code = 'CHECKOUT_SESSION_CREATE_FAILED';
    throw error;
  }
  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) return;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return res.status(500).json({ ok: false, status: 'STRIPE_NOT_CONFIGURED' });
  if (stripeSecretKey.startsWith('pk_')) return res.status(500).json({ ok: false, status: 'STRIPE_SECRET_KEY_INVALID' });

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, status: 'INVALID_JSON_BODY' });

  const claimId = typeof body.claimId === 'string' ? body.claimId.trim() : '';
  const forceNew = body.forceNew === true;
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

  const siteUrl = process.env.COMMANDLAYER_SITE_URL || 'https://www.commandlayer.org';
  const amountCents = Number.parseInt(process.env.STRIPE_FOUNDING_PRICE_CENTS || '2000', 10);

  try {
    const claimResult = await db.query('select claim_id, tenant, pack_id, status, payment_status from claim_requests where claim_id = $1 limit 1', [claimId]);
    const claim = claimResult.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });

    if (claim.payment_status === 'paid' || claim.status === 'paid') {
      return res.status(409).json({ ok: false, status: 'PAYMENT_ALREADY_COMPLETED' });
    }
    if (!READY_STATUSES.has(claim.status)) {
      return res.status(409).json({ ok: false, status: 'CLAIM_NOT_READY_FOR_PAYMENT' });
    }

    const paymentResult = await db.query(
      'select * from claim_payments where claim_id = $1 and provider = $2 order by updated_at desc nulls last, id desc limit 1',
      [claimId, 'stripe'],
    );
    const existingPayment = paymentResult.rows[0] || null;

    if (claim.status === 'payment_pending' && !forceNew && existingPayment && existingPayment.checkout_url) {
      return res.status(200).json({
        ok: true,
        checkoutUrl: existingPayment.checkout_url,
        stripeCheckoutSessionId: existingPayment.stripe_checkout_session_id || null,
        claimId,
      });
    }

    const stripeSession = await createStripeCheckoutSession({ stripeSecretKey, amountCents, siteUrl, claim });

    const hasCheckoutUrlColumn = await hasColumn('claim_payments', 'checkout_url');
    if (hasCheckoutUrlColumn) {
      await db.query(
        `insert into claim_payments (claim_id, provider, payment_status, stripe_checkout_session_id, checkout_url, updated_at)
         values ($1, 'stripe', 'pending', $2, $3, now())
         on conflict (claim_id, provider)
         do update set payment_status = excluded.payment_status,
                       stripe_checkout_session_id = excluded.stripe_checkout_session_id,
                       checkout_url = excluded.checkout_url,
                       updated_at = now()`,
        [claimId, stripeSession.id, stripeSession.url],
      );
    } else {
      await db.query(
        `insert into claim_payments (claim_id, provider, payment_status, stripe_checkout_session_id, updated_at)
         values ($1, 'stripe', 'pending', $2, now())
         on conflict (claim_id, provider)
         do update set payment_status = excluded.payment_status,
                       stripe_checkout_session_id = excluded.stripe_checkout_session_id,
                       updated_at = now()`,
        [claimId, stripeSession.id],
      );
    }

    const isFirstTransition = claim.status === 'cards_published';
    if (isFirstTransition) {
      await db.query("update claim_requests set status = 'payment_pending', payment_status = 'pending', stripe_checkout_session_id = $2 where claim_id = $1", [claimId, stripeSession.id]);
      await db.query(
        `insert into claim_status_transitions (claim_id, from_status, to_status)
         select $1, 'cards_published', 'payment_pending'
         where not exists (
           select 1 from claim_status_transitions
           where claim_id = $1 and from_status = 'cards_published' and to_status = 'payment_pending'
         )`,
        [claimId],
      );
    } else {
      await db.query('update claim_requests set payment_status = $2, stripe_checkout_session_id = $3 where claim_id = $1', [claimId, 'pending', stripeSession.id]);
    }

    const eventType = forceNew ? 'payment.checkout_regenerated' : 'payment.checkout_created';
    await db.query('insert into claim_events (claim_id, event_type, metadata) values ($1, $2, $3::jsonb)', [claimId, eventType, JSON.stringify({ provider: 'stripe' })]);

    return res.status(200).json({ ok: true, checkoutUrl: stripeSession.url, stripeCheckoutSessionId: stripeSession.id, claimId });
  } catch (error) {
    safeLog('checkout session creation failed', error && error.code, claimId);
    if (error && error.code === 'CHECKOUT_SESSION_CREATE_FAILED') {
      return res.status(502).json({ ok: false, status: 'CHECKOUT_SESSION_CREATE_FAILED' });
    }
    return res.status(500).json({ ok: false, status: 'CHECKOUT_SESSION_CREATE_FAILED' });
  }
};
