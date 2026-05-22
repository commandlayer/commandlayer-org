const http = require('node:http');
const { assertPaymentAccepted } = require('./mockX402Payment');
const { executeMockAgentAction } = require('./mockAgentAction');
const { buildClasReceipt } = require('./receiptBuilder');

const dedupe = new Map();

function dedupeKey(requestId, paymentId) {
  return `${requestId}:${paymentId}`;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body, null, 2));
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/paid-action') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });

      req.on('end', () => {
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { error: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
        }

        const { paid_action_request: paidActionRequest, payment_accepted: paymentAccepted } = body || {};
        if (!paidActionRequest) {
          return sendJson(res, 400, { error: 'MISSING_REQUEST', message: 'paid_action_request is required.' });
        }

        let paymentAcceptance;
        try {
          paymentAcceptance = assertPaymentAccepted(paymentAccepted, paidActionRequest);
        } catch (error) {
          return sendJson(res, 402, { error: 'PAYMENT_REQUIRED_OR_INVALID', message: error.message });
        }

        const key = dedupeKey(paidActionRequest.request_id, paymentAcceptance.payment_id);
        if (dedupe.has(key)) {
          return sendJson(res, 200, { duplicate: true, receipt: dedupe.get(key) });
        }

        let actionResult;
        try {
          actionResult = executeMockAgentAction(paidActionRequest.action, paidActionRequest.input);
        } catch (error) {
          return sendJson(res, 500, { error: 'ACTION_EXECUTION_FAILED', message: error.message });
        }

        let receipt;
        try {
          receipt = buildClasReceipt({
            paidActionRequest,
            paymentAcceptance,
            executionResult: actionResult,
            signingKeyId: process.env.RUNTIME_SIGNING_KEY_ID,
            workflowId: process.env.WORKFLOW_ID
          });
        } catch (error) {
          return sendJson(res, 500, { error: 'RECEIPT_SIGNING_FAILED', message: error.message });
        }

        dedupe.set(key, receipt);
        return sendJson(res, 200, { duplicate: false, receipt });
      });
      return;
    }

    sendJson(res, 404, { error: 'NOT_FOUND' });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4000);
  createServer().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`x402 paid action receipt example listening on http://localhost:${port}`);
  });
}

module.exports = { createServer, dedupeKey };
