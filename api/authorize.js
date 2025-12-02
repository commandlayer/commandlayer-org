export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const trace_id = body.trace_id || `trace_${Date.now()}`;
  const { buyer, chain_id } = body;

  return res.status(200).json({
    type: 'authorize.receipt',
    step: 'authorize',
    trace_id,
    timestamp: new Date().toISOString(),
    buyer,
    chain_id,
    status: 'authorized',
  });
}
