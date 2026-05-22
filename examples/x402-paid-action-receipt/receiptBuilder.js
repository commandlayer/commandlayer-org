const crypto = require('node:crypto');

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function buildClasReceipt({ paidActionRequest, paymentAcceptance, executionResult, signingKeyId, workflowId }) {
  if (!paidActionRequest?.request_id || !paymentAcceptance?.payment_id) {
    throw new Error('RECEIPT_SIGNING_FAILED: missing request_id or payment_id in receipt build input.');
  }

  const requestedAt = new Date().toISOString();
  const executedAt = new Date().toISOString();
  const receiptId = makeId('rcpt_clas_act');

  const receipt = {
    receipt_id: receiptId,
    request_id: paidActionRequest.request_id,
    payment_id: paymentAcceptance.payment_id,
    action: paidActionRequest.action,
    status: 'succeeded',
    requested_at: requestedAt,
    executed_at: executedAt,
    result: executionResult,
    metadata: {
      trace: {
        request_id: paidActionRequest.request_id,
        payment_id: paymentAcceptance.payment_id,
        receipt_id: receiptId,
        workflow_id: workflowId || makeId('wf'),
        provider: paymentAcceptance.provider
      },
      proof: {
        payment: {
          scheme: 'x402',
          settlement_status: paymentAcceptance.settlement_status,
          payment_ref: paymentAcceptance.payment_ref
        },
        execution: {
          runtime_id: 'runtime_example_local',
          agent_id: 'agent_mock_summarizer_v1',
          policy_hash: 'sha256:example-policy-hash'
        },
        commandlayer_signing_hook: 'Replace proof.signature placeholders with real CommandLayer signing in production.'
      }
    },
    proof: {
      signature: [
        { role: 'payer', alg: 'Ed25519', key_id: 'payer_key_placeholder', sig: 'PLACEHOLDER_PAYER_SIG' },
        { role: 'agent', alg: 'Ed25519', key_id: 'agent_key_placeholder', sig: 'PLACEHOLDER_AGENT_SIG' },
        { role: 'runtime', alg: 'Ed25519', key_id: signingKeyId || 'runtime_key_placeholder', sig: 'PLACEHOLDER_RUNTIME_SIG' },
        { role: 'verifier', alg: 'Ed25519', key_id: 'verifier_key_placeholder', sig: 'PLACEHOLDER_VERIFIER_SIG' }
      ]
    }
  };

  return receipt;
}

module.exports = {
  buildClasReceipt
};
