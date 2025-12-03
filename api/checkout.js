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
      items,
    } = body;

    const orderId =
      typeof incomingOrderId === "string" && incomingOrderId.length > 0
        ? incomingOrderId
        : `order_${Date.now()}`;

    const orderStatus = "created"; // demo: you could flip to "captured" etc. later

    // --- amount (matches your payment.amount schema contract) ---
    const amount = {
      // canonical amount object; adjust to exactly match your payment.amount.schema.json
      value: total_amount || "0.0001",
      currency: currency || "ETH",
      decimals: 18,
    };

    // --- settlement (matches your payment.settlement schema contract) ---
    const settlement = {
      // adjust field names to your payment.settlement.schema.json if needed
      chain_id: chain_id || "eip155:84532", // Base Sepolia for example
      receiver:
        receiver || "0x000000000000000000000000000000000000dEaD", // demo receiver
      asset: currency || "ETH",
      method: "native_transfer",
    };

    const lineItems = Array.isArray(items)
      ? items.map((item, idx) => ({
          index: idx,
          ...item,
        }))
      : [];

    const receipt = {
      // Likely part of your receipt.base (safe for demo):
      trace_id: traceId,
      status: "ok",
      created_at: now,
      request_ref: body.request_id || `req_${Date.now()}`,

      // Result block MUST follow checkout.receipt.schema.json
      result: {
        order_id: orderId,
        status: orderStatus,
        amount,
        settlement,
        line_items: lineItems,
        metadata: {
          demo: true,
          note: "This is a CommandLayer commercial checkout demo receipt.",
        },
        // reason is optional; we only include it on failure in a real flow
      },

      // usage is optional; keep loose so it stays compatible with your schema
      usage: {
        calls_in_session: 1,
        // you can add provider metering here when you wire real infra
      },
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("checkout handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error",
    });
  }
};
