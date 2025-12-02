export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const trace_id = body.trace_id || `trace_${Date.now()}`;
  const { order_id, shipment_id } = body;

  return res.status(200).json({
    type: 'verify.receipt',
    step: 'verify',
    trace_id,
    timestamp: new Date().toISOString(),
    order_id,
    shipment_id,
    status: 'delivered_and_verified',
  });
}
