// api/checkout.js
// Commercial "checkout" demo endpoint shaped to match checkout.receipt.schema.json

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
    const {
      order_id: incomingOrderId,
      currency,
      total_amount,
      chain_id,
      receiver,
      items
    } = body;

    const orderId =
      typeof incomingOrderId === "string" && incomingOrderId.length > 0
        ? incomingOrderId
        : `order_${Date.now()}`;

    const status = "created"; // demo state

    const amount = {
      value: total_amount || "0.0001",
      currency: currency || "ETH",
      decimals: 18
    };

    const settlement = {
      chain_id: chain_id || "eip155:84532",
      receiver:
        receiver || "0x000000000000000000000000000000000000dEaD",
      asset: currency || "ETH",
      method: "native_transfer"
    };

    const lineItems = Array.isArray(items)
      ? items.map((item, idx) => ({ index: idx, ...item }))
      : [];

    const receipt = {
      trace_id: traceId,
      status: "ok",
      created_at: now,
      request_ref: body.request_ref || `req_${Date.now()}`,

      result: {
        order_id: orderId,
        status,
        amount,
        settlement,
        line_items: lineItems,
        metadata: {
          demo: true,
          note: "Demo checkout receipt aligned with checkout.receipt.schema.json"
        }
      },

      usage: {
        calls_in_session: 1
      }
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("checkout handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error"
    });
  }
};
