const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../examples/x402-paid-action-receipt/server');

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
        });
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

test('paid-action emits receipt and enforces idempotency', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const payload = {
    paid_action_request: {
      request_id: 'req_test_1',
      action: 'summarize.text',
      input: { text: 'A long text used to create a short summary.' },
      payment: { required: true, plan: 'pro', max_amount: '0.05', currency: 'USD' }
    },
    payment_accepted: {
      event: 'payment.accepted',
      request_id: 'req_test_1',
      payment_id: 'pay_test_1',
      provider: 'x402-compatible',
      settled_amount: '0.05',
      currency: 'USD',
      accepted_at: '2026-05-22T12:00:01Z'
    }
  };

  const first = await postJson(port, '/paid-action', payload);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.receipt.request_id, 'req_test_1');
  assert.equal(first.body.receipt.payment_id, 'pay_test_1');
  assert.equal(first.body.receipt.metadata.trace.request_id, 'req_test_1');
  assert.equal(first.body.receipt.metadata.trace.payment_id, 'pay_test_1');

  const second = await postJson(port, '/paid-action', payload);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.receipt.receipt_id, first.body.receipt.receipt_id);

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});
