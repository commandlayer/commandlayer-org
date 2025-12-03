// api/purchase.js
// Commercial "purchase" demo endpoint shaped to match purchase.receipt.schema.json

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
      purchase_id: incomingPurchaseId,
      currency,
      total_amount,
      chain_id,
      receiver
    } = body;

    const purchaseId =
      typeof incomingPurchaseId === "string" && incomingPurchaseId.length > 0
        ? incomingPurchaseId
        : `purchase_${Date.now()}`;

    const status = "success"; // demo: assume purchase succeeded

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

    const receipt = {
      trace_id: traceId,
      status: "ok",
      created_at: now,
      request_ref: body.request_ref || `req_${Date.now()}`,

      result: {
        purchase_id: purchaseId,
        status,
        amount,
        settlement,
        metadata: {
          demo: true,
          note: "Demo purchase receipt aligned with purchase.receipt.schema.json"
        }
      },

      usage: {
        calls_in_session: 1
      }
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("purchase handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error"
    });
  }
};
