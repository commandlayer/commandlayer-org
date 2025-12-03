/ api/commons-flow.js
//
// Multi-step Commons flow demo.
// Accepts up to 3 Commons verbs and returns chained, schema-shaped receipts.
//
// Expected request:
// POST /api/commons-flow
// {
//   "steps": [
//     { "verb": "summarize", "input": "text to summarize" },
//     { "verb": "analyze", "input": "text to analyze" },
//     { "verb": "fetch", "input": "https://example.com" }
//   ]
// }
// Vercel serverless function for CommandLayer Commons flows.
// Accepts an array of steps: [{ verb, input: { text }, context? }]
// Returns a trace_id and one receipt per step, shaped like v1 Commons receipts.

const COMMON_VERBS = [
  "analyze",
@@ -26,191 +17,187 @@ const COMMON_VERBS = [
  "fetch",
];

function makeTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
/**
 * Cheap unique-ish id for demo purposes.
 */
function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function makeReceiptId(verb, idx) {
  return `rcpt-${verb}-${idx}-${Date.now()}`;
}
/**
 * Build a base receipt skeleton similar to receipt.base + x402 overlay.
 */
function makeBaseReceipt(verb, traceId) {
  const now = new Date().toISOString();

function makeBaseReceipt(verb, idx, traceId) {
  return {
    // This roughly matches what your receipt.base + x402 layer expect.
    id: makeReceiptId(verb, idx),
    id: makeId("rcpt"),
    verb,
    version: "1.0.0",
    trace_id: traceId,
    created_at: new Date().toISOString(),
    status: "ok",
    created_at: now,
    x402: {
      verb,
      version: "1.0.0",
      // Demo-only; in real x402 envelopes you’d have more structure.
      intent: `${verb}.receipt`,
      // These are demo-only fields; real runtimes would wire real values.
      chain_id: "eip155:84532",
      payer: "0xDEMO_PAYER",
      payee: "0xDEMO_AGENT",
      intent_id: makeId("intent"),
    },
  };
}

// Very lightweight, schema-shaped "result" block per verb.
// This is **demo only** – no Ajv validation, but fields line up with your patterns.
function makeResultForVerb(verb, input, stepIdx) {
  const baseSummary = `Demo ${verb} result for step ${stepIdx + 1}`;
/**
 * Build a verb-specific `result` payload that roughly matches the
 * spirit of the v1 Commons schemas. This is *demo* logic only.
 */
function makeResultForVerb(verb, text, idx) {
  const snippet = (text || "").slice(0, 180);

  switch (verb) {
    case "analyze":
      return {
        summary: baseSummary,
        summary: `Analysis of input #${idx + 1}: ${snippet}`,
        insights: [
          "Input was accepted and processed in a demo context.",
          "No external providers were called.",
          "Detected structure and key themes.",
          "Identified potential signals / anomalies.",
        ],
        labels: ["demo", "commons"],
        score: 0.42,
        labels: ["demo", "commons", "analyze"],
        score: 0.82,
      };

    case "summarize":
      return {
        summary: `Summarized: ${
          typeof input === "string"
            ? input.slice(0, 120)
            : "structured request payload"
        }`,
        insights: ["Compression applied in a non-lossless demo mode."],
        summary: `Summary: ${snippet}`,
        highlights: ["Key information compressed.", "Non-essential detail dropped."],
      };

    case "classify":
      return {
        summary: baseSummary,
        insights: ["Classified into a synthetic label set."],
        labels: ["demo_label_A", "demo_label_B"],
        summary: `Classification result for: ${snippet}`,
        labels: ["demo_label_a", "demo_label_b"],
      };

    case "clean":
      return {
        summary: "Input was normalized / cleaned in a demo pipeline.",
        insights: ["Whitespace trimmed.", "Obvious noise removed."],
        summary: `Cleaned input (whitespace / noise removed).`,
        transformed_preview: snippet.replace(/\s+/g, " "),
      };

    case "convert":
      return {
        summary: "Input converted between representations in a demo pipeline.",
        insights: ["No external codecs involved."],
        summary: `Converted representation of input.`,
        from: "text/plain",
        to: "demo/structured",
      };

    case "describe":
      return {
        summary: "High-level description generated for the provided input.",
        summary: `Description of the input.`,
        attributes: ["demo_attribute_a", "demo_attribute_b"],
      };

    case "explain":
      return {
        summary: "Causal / relational explanation generated for the input.",
        summary: `Explanation of how/why for this input.`,
        steps: [
          "Interpret input.",
          "Apply demo reasoning.",
          "Produce a natural language explanation.",
        ],
      };

    case "format":
      return {
        summary: "Output formatted into a structured, presentable shape.",
        summary: `Formatted output for presentation.`,
        format: "markdown",
        preview: `> ${snippet}`,
      };

    case "parse":
      return {
        summary: "Structured meaning parsed from raw content.",
        summary: `Parsed structure extracted from raw input.`,
        fields: ["demo_field_a", "demo_field_b"],
      };

    case "fetch":
      return {
        summary:
          "Fetch simulated; no real network calls made in this demonstration.",
        insights: [
          "In a real runtime this would retrieve remote data.",
          "Here we just echo a synthetic payload.",
        ],
        summary: `Fetched data based on input.`,
        source: "demo://commons-fetch",
      };

    default:
      return {
        summary: baseSummary,
        summary: `Result for verb "${verb}" on input: ${snippet}`,
      };
  }
}

function makeUsage(stepIdx) {
  // Completely synthetic usage – just enough to show shape.
/**
 * Build a small usage block (tokens/cost/etc.) for demo purposes.
 */
function makeUsage() {
  return {
    input_tokens: 128 + stepIdx * 10,
    output_tokens: 256 + stepIdx * 20,
    total_tokens: 384 + stepIdx * 30,
    input_tokens: Math.floor(Math.random() * 500) + 50,
    output_tokens: Math.floor(Math.random() * 300) + 50,
    total_tokens: Math.floor(Math.random() * 800) + 100,
    cost: 0,
  };
}

module.exports = (req, res) => {
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const inputSteps = Array.isArray(body.steps) ? body.steps : [];
    const steps = Array.isArray(body.steps) ? body.steps : [];

    if (!inputSteps.length) {
    if (!steps.length) {
      return res.status(400).json({
        error: "No steps provided. Expected { steps: [{ verb, input }, ...] }",
        error: "invalid_request",
        detail: "Expected 'steps' array with at least one item.",
      });
    }

    // Only allow known Commons verbs and max 3 steps for demo.
    const steps = inputSteps
      .slice(0, 3)
      .filter(
        (s) =>
          s &&
          typeof s.verb === "string" &&
          COMMON_VERBS.includes(s.verb.toLowerCase())
      );
    const traceId = makeId("trace");

    if (!steps.length) {
      return res.status(400).json({
        error:
          "No valid Commons verbs provided. Allowed verbs: " +
          COMMON_VERBS.join(", "),
      });
    }
    const receipts = steps.map((step, idx) => {
      const verb = String(step.verb || "").toLowerCase();
      const input = step.input || {};
      const text = typeof input.text === "string" ? input.text : "";

    const traceId = makeTraceId();

    const flowSteps = steps.map((step, idx) => {
      const verb = step.verb.toLowerCase();
      const input = step.input ?? "";
      const requestSchemaBase =
        "https://commandlayer.org/schemas/v1.0.0/commons";

      const request = {
        verb,
        trace_id: traceId,
        // Where the canonical request schema lives for this verb.
        schemas: {
          request: `${requestSchemaBase}/${verb}/requests/${verb}.request.schema.json`,
          receipt: `${requestSchemaBase}/${verb}/receipts/${verb}.receipt.schema.json`,
        },
        payload: {
          // Demo-only: we just echo input.
          input,
        },
      };
      if (!COMMON_VERBS.includes(verb)) {
        return {
          error: "unsupported_verb",
          verb,
          index: idx,
        };
      }

      const receipt = {
        ...makeBaseReceipt(verb, idx, traceId),
        result: makeResultForVerb(verb, input, idx),
        usage: makeUsage(idx),
      };
      const base = makeBaseReceipt(verb, traceId);
      const result = makeResultForVerb(verb, text, idx);
      const usage = makeUsage();

      return {
        step_index: idx,
        verb,
        request,
        receipt,
        ...base,
        result,
        usage,
      };
    });

    return res.status(200).json({
      trace_id: traceId,
      steps: flowSteps,
      steps: receipts,
    });
  } catch (err) {
    console.error("[commons-flow] error:", err);
    console.error("[api/commons-flow] error:", err);
    return res.status(500).json({
      error: "Internal error in commons flow demo",
      detail: err.message,
      error: "internal_error",
      detail: err && err.message ? err.message : String(err),
    });
  }
};
}
