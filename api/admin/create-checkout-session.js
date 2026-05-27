'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');

const READY_STATUSES = new Set(['cards_published', 'payment_pending']);
const CHECKOUT_BASE_URL = 'https://www.commandlayer.org/claim/status.html';

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

function safeLog(message, code, type, claimId) {
  console.error('[admin.create-checkout-session]', {
    message: message || 'unknown',
    code: code || null,
    type: type || null,
    claimId: claimId || null,
  });
}

function isNonProduction() {
  return process.env.NODE_ENV !== 'production';
}

function buildErrorResponse(status, debug) {
  const response = { ok: false, status };
  if (status === 'CHECKOUT_SESSION_DB_WRITE_FAILED') {
    response.error = 'Checkout was created but payment state could not be saved.';
  }
  if (!isNonProduction() || !debug) return response;
  response.debug = { message: debug.message || null, code: debug.code || null };
  return response;
}

function parseSiteUrl(rawSiteUrl) {
  try {
    const parsed = new URL(rawSiteUrl);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'www.commandlayer.org') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function hasTable(tableName) {
  const result = await db.query(
    `select 1
       from information_schema.tables
      where table_schema = 'public' and table_name = $1
      limit 1`,
    [tableName],
  );
  return result.rows.length > 0;
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

async function createStripeCheckoutSession({ stripeSecretKey, amountCents, claim }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${CHECKOUT_BASE_URL}?claimId=${encodeURIComponent(claim.claim_id)}&payment=success`);
  params.set('cancel_url', `${CHECKOUT_BASE_URL}?claimId=${encodeURIComponent(claim.claim_id)}&payment=cancel`);
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
    const stripeError = payload && payload.error ? payload.error : null;
    const error = new Error('Stripe checkout session creation failed');
    error.code = stripeError && stripeError.code ? stripeError.code : 'STRIPE_CHECKOUT_CREATE_FAILED';
    error.type = stripeError && stripeError.type ? stripeError.type : null;
    error.status = 'STRIPE_CHECKOUT_CREATE_FAILED';
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

  const siteUrl = process.env.COMMANDLAYER_SITE_URL || 'https://www.commandlayer.org';
  if (!parseSiteUrl(siteUrl)) return res.status(500).json({ ok: false, status: 'SITE_URL_INVALID' });

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, status: 'INVALID_JSON_BODY' });

  const claimId = typeof body.claimId === 'string' ? body.claimId.trim() : '';
  const forceNew = body.forceNew === true;
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });

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

    const stripeSession = await createStripeCheckoutSession({ stripeSecretKey, amountCents, claim });

    try {
      if (!(await hasTable('claim_payments'))) {
        const missingPaymentsTableError = new Error('claim_payments table missing');
        missingPaymentsTableError.code = 'CLAIM_PAYMENTS_TABLE_MISSING';
        throw missingPaymentsTableError;
      }

      const hasPaymentsStatusColumn = await hasColumn('claim_payments', 'payment_status');
      const hasLegacyPaymentsStatusColumn = await hasColumn('claim_payments', 'status');
      const hasPaymentsStripeSessionColumn = await hasColumn('claim_payments', 'stripe_checkout_session_id');
      const hasCheckoutUrlColumn = await hasColumn('claim_payments', 'checkout_url');
      const hasPaymentsUpdatedAtColumn = await hasColumn('claim_payments', 'updated_at');

      const paymentColumns = ['claim_id', 'provider'];
      const paymentValues = ['$1', "'stripe'"];
      const paymentUpdates = [];
      const paymentParams = [claimId];
      let nextParam = 2;

      if (hasPaymentsStatusColumn) {
        paymentColumns.push('payment_status');
        paymentValues.push("'pending'");
        paymentUpdates.push("payment_status = 'pending'");
      } else if (hasLegacyPaymentsStatusColumn) {
        paymentColumns.push('status');
        paymentValues.push("'pending'");
        paymentUpdates.push("status = 'pending'");
      }
      if (hasPaymentsStripeSessionColumn) {
        paymentColumns.push('stripe_checkout_session_id');
        paymentValues.push(`$${nextParam}`);
        paymentUpdates.push('stripe_checkout_session_id = excluded.stripe_checkout_session_id');
        paymentParams.push(stripeSession.id);
        nextParam += 1;
      }
      if (hasCheckoutUrlColumn) {
        paymentColumns.push('checkout_url');
        paymentValues.push(`$${nextParam}`);
        paymentUpdates.push('checkout_url = excluded.checkout_url');
        paymentParams.push(stripeSession.url);
        nextParam += 1;
      }
      if (hasPaymentsUpdatedAtColumn) {
        paymentColumns.push('updated_at');
        paymentValues.push('now()');
        paymentUpdates.push('updated_at = now()');
      }
      if (paymentUpdates.length === 0) {
        const missingWritableColumnsError = new Error('claim_payments has no writable checkout columns');
        missingWritableColumnsError.code = 'CLAIM_PAYMENTS_COLUMNS_MISSING';
        throw missingWritableColumnsError;
      }

      await db.query(
        `insert into claim_payments (${paymentColumns.join(', ')})
         values (${paymentValues.join(', ')})
         on conflict (claim_id, provider)
         do update set ${paymentUpdates.join(', ')}`,
        paymentParams,
      );

      const hasPaymentStatus = await hasColumn('claim_requests', 'payment_status');
      const hasStripeSession = await hasColumn('claim_requests', 'stripe_checkout_session_id');
      const setClauses = [];
      if (claim.status === 'cards_published') setClauses.push("status = 'payment_pending'");
      if (hasPaymentStatus) setClauses.push("payment_status = 'pending'");
      if (hasStripeSession) setClauses.push('stripe_checkout_session_id = $2');
      if (setClauses.length > 0) {
        await db.query(`update claim_requests set ${setClauses.join(', ')} where claim_id = $1`, [claimId, stripeSession.id]);
      }

      if (claim.status === 'cards_published' && (await hasTable('claim_status_transitions'))) {
        await db.query(
          `insert into claim_status_transitions (claim_id, from_status, to_status)
           select $1, 'cards_published', 'payment_pending'
           where not exists (
             select 1 from claim_status_transitions
             where claim_id = $1 and from_status = 'cards_published' and to_status = 'payment_pending'
           )`,
          [claimId],
        );
      }

      const eventType = forceNew ? 'payment.checkout_regenerated' : 'payment.checkout_created';
      if (await hasTable('claim_events')) {
        const hasMessageColumn = await hasColumn('claim_events', 'message');
        const hasMetadataJsonColumn = await hasColumn('claim_events', 'metadata_json');
        if (hasMessageColumn && hasMetadataJsonColumn) {
          await db.query('insert into claim_events (claim_id, event_type, message, metadata_json) values ($1, $2, $3, $4::jsonb)', [claimId, eventType, 'Stripe checkout session prepared', JSON.stringify({ provider: 'stripe' })]);
        } else if (hasMessageColumn) {
          await db.query('insert into claim_events (claim_id, event_type, message) values ($1, $2, $3)', [claimId, eventType, 'Stripe checkout session prepared']);
        }
      }
    } catch (error) {
      error.status = 'CHECKOUT_SESSION_DB_WRITE_FAILED';
      throw error;
    }

    return res.status(200).json({ ok: true, checkoutUrl: stripeSession.url, stripeCheckoutSessionId: stripeSession.id, claimId });
  } catch (error) {
    safeLog(error && error.message, error && error.code, error && error.type, claimId);
    if (error && error.status === 'STRIPE_CHECKOUT_CREATE_FAILED') {
      return res.status(502).json(buildErrorResponse('STRIPE_CHECKOUT_CREATE_FAILED', error));
    }
    if (error && error.status === 'CHECKOUT_SESSION_DB_WRITE_FAILED') {
      return res.status(500).json(buildErrorResponse('CHECKOUT_SESSION_DB_WRITE_FAILED', error));
    }
    return res.status(500).json(buildErrorResponse('CHECKOUT_SESSION_CREATE_FAILED', error));
  }
};
