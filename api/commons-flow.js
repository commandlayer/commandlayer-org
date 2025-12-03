// api/commons-flow.js
//
// Vercel serverless function for CommandLayer Commons flows.
// Accepts an array of steps: [{ verb, input: { text }, context? }]
// Returns a trace_id and one receipt per step, shaped like v1 Commons receipts.

const COMMON_VERBS = [
  "analyze",
  "classify",
  "clean",
  "convert",
  "describe",
  "explain",
  "format",
  "parse",
  "summarize",
  "fetch",
];

/**
 * Cheap unique-ish id for demo purposes.
 */
function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Build a base receipt skeleton similar to receipt.base + x402 overlay.
 */
function makeBaseReceipt(verb, traceId) {
  const now = new Date().toISOString();

  return {
    id: makeId("rcpt"),
    verb,
    version: "1.0.0",
    trace_id: traceId,
    created_at: now,
    x402: {
      verb,
      version: "1.0.0",
      // These are demo-only fields; real runtimes would wire real values.
      chain_id: "eip155:84532",
      payer: "0xDEMO_PAYER",
      payee: "0xDEMO_AGENT",
      intent_id: makeId("intent"),
    },
  };
}

/**
 * Build a verb-specific `result` payload that roughly matches the
 * spirit of the v1 Commons schemas. This is *demo* logic only.
 */
function makeResultForVerb(verb, text, idx) {
  const snippet = (text || "").slice(0, 180);

  switch (verb) {
    case "analyze":
      return {
        summary: `Analysis of input #${idx + 1}: ${snippet}`,
        insights: [
          "Detected structure and key themes.",
          "Identified potential signals / anomalies.",
        ],
        labels: ["demo", "commons", "analyze"],
        score: 0.82,
      };

    case "summarize":
      return {
        summary: `Summary: ${snippet}`,
        highlights: ["Key information compressed.", "Non-essential detail dropped."],
      };

    case "classify":
      return {
        summary: `Classification result for: ${snippet}`,
        labels: ["demo_label_a", "demo_label_b"],
      };

    case "clean":
      return {
        summary: `Cleaned input (whitespace / noise removed).`,
        transformed_preview: snippet.replace(/\s+/g, " "),
      };

    case "convert":
      return {
        summary: `Converted representation of input.`,
        from: "text/plain",
        to: "demo/structured",
      };

    case "describe":
      return {
        summary: `Description of the input.`,
        attributes: ["demo_attribute_a", "demo_attribute_b"],
      };

    case "explain":
      return {
        summary: `Explanation of how/why for this input.`,
        steps: [
          "Interpret input.",
          "Apply demo reasoning.",
          "Produce a natural language explanation.",
        ],
      };

    case "format":
      return {
        summary: `Formatted output for presentation.`,
        format: "markdown",
        preview: `> ${snippet}`,
      };

    case "parse":
      return {
        summary: `Parsed structure extracted from raw input.`,
        fields: ["demo_field_a", "demo_field_b"],
      };

    case "fetch":
      return {
        summary: `Fetched data based on input.`,
        source: "demo://commons-fetch",
      };

    default:
      return {
        summary: `Result for verb "${verb}" on input: ${snippet}`,
      };
  }
}

/**
 * Build a small usage block (tokens/cost/etc.) for demo purposes.
 */
function makeUsage() {
  return {
    input_tokens: Math.floor(Math.random() * 500) + 50,
    output_tokens: Math.floor(Math.random() * 300) + 50,
    total_tokens: Math.floor(Math.random() * 800) + 100,
    cost: 0,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const steps = Array.isArray(body.steps) ? body.steps : [];

    if (!steps.length) {
      return res.status(400).json({
        error: "invalid_request",
        detail: "Expected 'steps' array with at least one item.",
      });
    }

    const traceId = makeId("trace");

    const receipts = steps.map((step, idx) => {
      const verb = String(step.verb || "").toLowerCase();
      const input = step.input || {};
      const text = typeof input.text === "string" ? input.text : "";

      if (!COMMON_VERBS.includes(verb)) {
        return {
          error: "unsupported_verb",
          verb,
          index: idx,
        };
      }

      const base = makeBaseReceipt(verb, traceId);
      const result = makeResultForVerb(verb, text, idx);
      const usage = makeUsage();

      return {
        ...base,
        result,
        usage,
      };
    });

    return res.status(200).json({
      trace_id: traceId,
      steps: receipts,
    });
  } catch (err) {
    console.error("[api/commons-flow] error:", err);
    return res.status(500).json({
      error: "internal_error",
      detail: err && err.message ? err.message : String(err),
    });
  }
}
