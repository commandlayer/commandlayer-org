// api/authorize.js
// Commercial "authorize" demo endpoint shaped to match authorize.receipt.schema.json

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
      authorization_id: incomingAuthId,
      total_amount,
      currency,
      chain_id,
      receiver
    } = body;

    const authorizationId =
      typeof incomingAuthId === "string" && incomingAuthId.length > 0
        ? incomingAuthId
        : `auth_${Date.now()}`;

    const status = "authorized"; // demo status

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
        authorization_id: authorizationId,
        status,
        amount,
        settlement,
        expires_at: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // +10 min
        metadata: {
          demo: true,
          note: "Demo authorization receipt aligned with authorize.receipt.schema.json"
        }
      },

      usage: {
        calls_in_session: 1
      }
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("authorize handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error"
    });
  }
};
