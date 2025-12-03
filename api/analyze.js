// api/analyze.js
// Commons "analyze" demo endpoint shaped to match analyze.receipt.schema.json

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

    const receipt = {
      // Likely covered by receipt.base.schema.json (trace, status, timestamps)
      trace_id: traceId,
      status: "ok",
      created_at: now,
      request_ref: body.request_id || `req_${Date.now()}`,

      // x402 envelope narrowed by schema to verb/version
      x402: {
        verb: "analyze",
        version: "1.0.0",
        spec: "x402-demo",
        network: body.network || "eip155:84532",
        from: body.caller || "demo.client.commandlayer",
        to: "analyzeagent.eth"
      },

      // Matches analyze.result schema you sent
      result: {
        summary:
          "Demo analysis complete. This receipt is shaped to match Protocol-Commons analyze.receipt.",
        insights: [
          "Demo-only: analysis pipeline executed successfully.",
          "Demo-only: this structure can be validated against analyze.receipt.schema.json."
        ],
        labels: ["demo", "commons", "analyze"],
        score: 0.9
      },

      // Optional usage block
      usage: {
        input_tokens: body.input_tokens || 256,
        output_tokens: body.output_tokens || 96,
        total_tokens: body.total_tokens || 352,
        cost: body.cost || 0.00012
      }
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("analyze handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error"
    });
  }
};
