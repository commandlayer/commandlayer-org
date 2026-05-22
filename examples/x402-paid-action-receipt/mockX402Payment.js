const crypto = require('node:crypto');

function assertPaymentAccepted(paymentEvent, paidActionRequest) {
  if (!paymentEvent) {
    throw new Error('MISSING_PAYMENT: payment accepted event is required before execution.');
  }

  if (paymentEvent.event !== 'payment.accepted') {
    throw new Error('INVALID_PAYMENT: expected event to be payment.accepted.');
  }

  if (paymentEvent.request_id !== paidActionRequest.request_id) {
    throw new Error('INVALID_PAYMENT: request_id mismatch between action request and payment event.');
  }

  if (!paymentEvent.payment_id || !paymentEvent.provider) {
    throw new Error('INVALID_PAYMENT: payment_id and provider are required.');
  }

  return {
    settlement_status: 'accepted',
    payment_id: paymentEvent.payment_id,
    payment_ref: paymentEvent.payment_id,
    provider: paymentEvent.provider,
    settled_amount: paymentEvent.settled_amount,
    currency: paymentEvent.currency,
    accepted_at: paymentEvent.accepted_at,
    verification_token: `x402v1:${crypto.createHash('sha256').update(JSON.stringify(paymentEvent)).digest('hex').slice(0, 24)}`
  };
}

module.exports = {
  assertPaymentAccepted
};
