export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const trace_id = body.trace_id || `trace_${Date.now()}`;
  const { order_id, total_amount, currency } = body;

  return res.status(200).json({
    type: 'purchase.receipt',
    step: 'purchase',
    trace_id,
    timestamp: new Date().toISOString(),
    order_id,
    total_amount,
    currency,
    tx_hash: `0xDEMO${Date.now().toString(16)}`,
    status: 'purchased',
  });
}
