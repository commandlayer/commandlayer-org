'use strict';

const PAYMENT_VERIFICATION_MODES = {
  DEMO_ACCEPTED_ENVELOPE: 'demo_accepted_envelope',
  PROVIDER_VERIFIED: 'provider_verified',
};

function getProviderVerificationUrl() {
  const value = process.env.X402_PROVIDER_VERIFICATION_URL;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveVerificationMode() {
  return getProviderVerificationUrl()
    ? PAYMENT_VERIFICATION_MODES.PROVIDER_VERIFIED
    : PAYMENT_VERIFICATION_MODES.DEMO_ACCEPTED_ENVELOPE;
}

async function verifyWithProvider({ payload, req }) {
  const url = getProviderVerificationUrl();
  if (!url) {
    return {
      ok: true,
      paymentVerificationMode: PAYMENT_VERIFICATION_MODES.DEMO_ACCEPTED_ENVELOPE,
      provider: null,
    };
  }

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (process.env.X402_PROVIDER_API_KEY) {
    headers.Authorization = `Bearer ${process.env.X402_PROVIDER_API_KEY}`;
  }

  const providerPayload = {
    payment: payload.payment,
    request: {
      request_id: payload.request_id,
      action: payload.action,
      input: payload.input,
    },
    metadata: {
      method: req.method,
      path: req.url || req.path || '/api/examples/x402-paid-action',
      headers: {
        'x-request-id': req.headers?.['x-request-id'] || req.headers?.['X-Request-Id'] || null,
      },
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(providerPayload),
    });
  } catch {
    return { ok: false, httpStatus: 503, status: 'payment_provider_unavailable' };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, httpStatus: 503, status: 'payment_provider_unavailable' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, httpStatus: 503, status: 'payment_provider_unavailable' };
  }

  const accepted = data.accepted === true || data.settled === true || data.status === 'accepted' || data.status === 'settled';
  if (!response.ok || !accepted) {
    const paymentStatus = data.status;
    if (paymentStatus === 'required') return { ok: false, httpStatus: 402, status: 'payment_required' };
    if (paymentStatus === 'invalid' || response.status === 400 || response.status === 402) {
      return { ok: false, httpStatus: response.status === 402 ? 402 : 400, status: response.status === 402 ? 'payment_required' : 'payment_invalid' };
    }
    return { ok: false, httpStatus: 503, status: 'payment_provider_unavailable' };
  }

  return {
    ok: true,
    paymentVerificationMode: PAYMENT_VERIFICATION_MODES.PROVIDER_VERIFIED,
    provider: {
      status: typeof data.status === 'string' ? data.status : 'accepted',
      reference: typeof data.reference === 'string' ? data.reference : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
    },
  };
}

module.exports = {
  PAYMENT_VERIFICATION_MODES,
  resolveVerificationMode,
  verifyWithProvider,
};
