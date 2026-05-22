const crypto = require('node:crypto');

function parseHook0Signature(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    throw new Error('Missing X-Hook0-Signature header');
  }

  const parts = headerValue.split(',').map((segment) => segment.trim());
  const parsed = {};

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || !value) continue;
    parsed[key] = value;
  }

  if (!parsed.t || !parsed.h || !parsed.v1) {
    throw new Error('Invalid X-Hook0-Signature format. Expected t, h, v1');
  }

  return parsed;
}

function ensureFreshTimestamp(unixTimestamp, toleranceSeconds = 300) {
  const timestamp = Number(unixTimestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid signature timestamp');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new Error('Webhook timestamp outside freshness window');
  }
}

function buildSignedHeaderValues(reqHeaders, signedHeaderNames) {
  return signedHeaderNames
    .split(';')
    .map((name) => reqHeaders[name.toLowerCase()] ?? '')
    .join(';');
}

function verifyCoinbaseWebhook({ rawBody, headers, webhookSecret, toleranceSeconds = 300 }) {
  if (!webhookSecret) {
    throw new Error('WEBHOOK_SECRET is required');
  }

  if (!Buffer.isBuffer(rawBody)) {
    throw new Error('rawBody must be a Buffer from express.raw');
  }

  const signatureHeader = headers['x-hook0-signature'];
  const { t, h, v1 } = parseHook0Signature(signatureHeader);
  ensureFreshTimestamp(t, toleranceSeconds);

  const signedHeaderValues = buildSignedHeaderValues(headers, h);
  const rawBodyString = rawBody.toString('utf8');
  const signedPayload = `${t}.${h}.${signedHeaderValues}.${rawBodyString}`;

  const computed = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

  const expected = Buffer.from(v1, 'hex');
  const actual = Buffer.from(computed, 'hex');

  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('Invalid webhook signature');
  }

  return {
    ok: true,
    signature: { t, h, v1 },
    signedHeaderValues,
    signedPayload
  };
}

module.exports = {
  verifyCoinbaseWebhook,
  parseHook0Signature,
  ensureFreshTimestamp,
  buildSignedHeaderValues
};
