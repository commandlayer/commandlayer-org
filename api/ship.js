// api/ship.js
// Commercial "ship" demo endpoint shaped to match ship.receipt.schema.json

function makeTraceId() {
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

module.exports = function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const now = new Date().toISOString();
    const traceId = makeTraceId();

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const { order_id, carrier, tracking_number } = body;

    const shipmentId = `ship_${Date.now()}`;

    const status = "in_transit"; // demo

    const eta = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString(); // +3 days

    const receipt = {
      trace_id: traceId,
      status: "ok",
      created_at: now,
      request_ref: body.request_ref || `req_${Date.now()}`,

      result: {
        shipment_id: shipmentId,
        order_id: order_id || `order_${Date.now()}`,
        status,
        carrier: carrier || "DemoCarrier",
        tracking_number:
          tracking_number || `TRACK-${Math.random().toString(36).slice(2, 10)}`,
        eta,
        metadata: {
          demo: true,
          note: "Demo ship receipt aligned with ship.receipt.schema.json"
        }
      },

      usage: {
        calls_in_session: 1
      }
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("ship handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error"
    });
  }
};
