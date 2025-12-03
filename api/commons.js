// api/commons.js
// Demo handler for Commons verbs returning schema-shaped receipts.
// This is NOT a full validator — it's a reference-style mock aligned with your v1.0.0 patterns.

function makeTraceId() {
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function baseReceipt(body) {
  const now = new Date().toISOString();
  return {
    trace_id: body.trace_id || makeTraceId(),
    status: "ok",
    created_at: now,
    request_ref: body.request_ref || `req_${Date.now()}`
  };
}

function buildResult(verb, inputText, context) {
  const trimmed = (inputText || "").trim();
  const preview =
    trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed || "(empty)";

  switch (verb) {
    case "analyze":
      return {
        summary: `High-level analysis of input: ${preview}`,
        insights: [
          "Demo insight: this is a mock analysis aligned to analyze.receipt.schema.json",
          "In a real runtime, this would reflect provider-specific analytics."
        ],
        labels: context && context.topic ? [String(context.topic)] : ["demo"],
        score: 0.87
      };

    case "summarize":
      return {
        summary: `Summarized version of: ${preview}`
      };

    case "classify":
      return {
        summary: `Classification result for: ${preview}`,
        insights: [
          "Demo classification only. Replace with model-backed labels in production."
        ],
        labels: ["demo_label"]
      };

    case "clean":
      return {
        summary: `Cleaned version of input.`,
        insights: ["Whitespace normalized", "Obvious noise removed"],
        labels: ["cleaned"]
      };

    case "convert":
      return {
        summary: `Converted representation of the input (demo).`,
        insights: ["Input treated as generic text payload"]
      };

    case "describe":
      return {
        summary: `Description of the input (demo).`,
        insights: ["This is a mock description from the Commons demo"]
      };

    case "explain":
      return {
        summary: `Explanation for input (demo).`,
        insights: ["Root cause or reasoning would go here in a real agent"]
      };

    case "format":
      return {
        summary: `Formatted version of the input (demo).`,
        insights: ["Formatting constraints would be respected in a real runtime"]
      };

    case "parse":
      return {
        summary: `Parsed structure for the input (demo).`,
        insights: ["In production this would emit a structured object"]
      };

    case "fetch":
      return {
        summary: `Fetched/queried resource based on input: ${preview}`,
        insights: ["No real network call performed — demo only"]
      };

    default:
      return {
        summary: `Unknown Commons verb "${verb}" — demo fallback.`,
        insights: ["Supported: analyze, summarize, classify, clean, convert, describe, explain, format, parse, fetch"]
      };
  }
}

module.exports = function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const verb = (body.verb || "").toString().trim();

    if (!verb) {
      return res.status(400).json({ error: "missing_verb", message: "Body.verb is required." });
    }

    const input = body.input || {};
    const text = (input.text || "").toString();
    const context = body.context || null;

    const base = baseReceipt(body);
    const result = buildResult(verb, text, context);

    const receipt = {
      ...base,
      // For Commons v1, we mimic the "result + usage" shape seen in analyze.receipt.schema.json
      result,
      usage: {
        input_tokens: text.length,
        output_tokens: 128,
        total_tokens: text.length + 128,
        cost: 0
      }
    };

    return res.status(200).json(receipt);
  } catch (err) {
    console.error("commons handler error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err && err.message ? err.message : "Unknown error"
    });
  }
};
