'use strict';

const Stripe = require('stripe');

function createStripeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = function createStripeClient(secretKey, options = {}) {
  const key = typeof secretKey === 'string' ? secretKey.trim() : '';
  if (!key) {
    throw createStripeError('STRIPE_NOT_CONFIGURED', 'Stripe secret key is not configured.');
  }
  if (key.startsWith('pk_')) {
    throw createStripeError('STRIPE_SECRET_KEY_INVALID', 'Stripe secret key must be a server secret key (sk_*), not a publishable key.');
  }
  return new Stripe(key, options);
};
