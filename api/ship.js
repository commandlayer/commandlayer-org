export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const trace_id = body.trace_id || `trace_${Date.now()}`;
  const { order_id, address } = body;

  return res.status(200).json({
    type: 'ship.receipt',
    step: 'ship',
    trace_id,
    timestamp: new Date().toISOString(),
    order_id,
    address,
    shipment_id: `ship_${Date.now()}`,
    carrier: 'demo-carrier',
    status: 'shipped',
  });
}
