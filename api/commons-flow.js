// api/commons-flow.js
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

function makeTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeReceiptId(verb, idx) {
  return `rcpt-${verb}-${idx}-${Date.now()}`;
}

function makeBaseReceipt(verb, idx, traceId) {
  return {
    // This roughly matches what your receipt.base + x402 layer expect.
    id: makeReceiptId(verb, idx),
    trace_id: traceId,
    created_at: new Date().toISOString(),
    status: "ok",
    x402: {
      verb,
      version: "1.0.0",
      // Demo-only; in real x402 envelopes you’d have more structure.
      intent: `${verb}.receipt`,
    },
  };
}

// Very lightweight, schema-shaped "result" block per verb.
// This is **demo only** – no Ajv validation, but fields line up with your patterns.
function makeResultForVerb(verb, input, stepIdx) {
  const baseSummary = `Demo ${verb} result for step ${stepIdx + 1}`;
  switch (verb) {
    case "analyze":
      return {
        summary: baseSummary,
        insights: [
          "Input was accepted and processed in a demo context.",
          "No external providers were called.",
        ],
        labels: ["demo", "commons"],
        score: 0.42,
      };
    case "summarize":
      return {
        summary: `Summarized: ${
          typeof input === "string"
            ? input.slice(0, 120)
            : "structured request payload"
        }`,
        insights: ["Compression applied in a non-lossless demo mode."],
      };
    case "classify":
      return {
        summary: baseSummary,
        insights: ["Classified into a synthetic label set."],
        labels: ["demo_label_A", "demo_label_B"],
      };
    case "clean":
      return {
        summary: "Input was normalized / cleaned in a demo pipeline.",
        insights: ["Whitespace trimmed.", "Obvious noise removed."],
      };
    case "convert":
      return {
        summary: "Input converted between representations in a demo pipeline.",
        insights: ["No external codecs involved."],
      };
    case "describe":
      return {
        summary: "High-level description generated for the provided input.",
      };
    case "explain":
      return {
        summary: "Causal / relational explanation generated for the input.",
      };
    case "format":
      return {
        summary: "Output formatted into a structured, presentable shape.",
      };
    case "parse":
      return {
        summary: "Structured meaning parsed from raw content.",
      };
    case "fetch":
      return {
        summary:
          "Fetch simulated; no real network calls made in this demonstration.",
        insights: [
          "In a real runtime this would retrieve remote data.",
          "Here we just echo a synthetic payload.",
        ],
      };
    default:
      return {
        summary: baseSummary,
      };
  }
}

function makeUsage(stepIdx) {
  // Completely synthetic usage – just enough to show shape.
  return {
    input_tokens: 128 + stepIdx * 10,
    output_tokens: 256 + stepIdx * 20,
    total_tokens: 384 + stepIdx * 30,
    cost: 0,
  };
}

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const inputSteps = Array.isArray(body.steps) ? body.steps : [];

    if (!inputSteps.length) {
      return res.status(400).json({
        error: "No steps provided. Expected { steps: [{ verb, input }, ...] }",
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

    if (!steps.length) {
      return res.status(400).json({
        error:
          "No valid Commons verbs provided. Allowed verbs: " +
          COMMON_VERBS.join(", "),
      });
    }

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

      const receipt = {
        ...makeBaseReceipt(verb, idx, traceId),
        result: makeResultForVerb(verb, input, idx),
        usage: makeUsage(idx),
      };

      return {
        step_index: idx,
        verb,
        request,
        receipt,
      };
    });

    return res.status(200).json({
      trace_id: traceId,
      steps: flowSteps,
    });
  } catch (err) {
    console.error("[commons-flow] error:", err);
    return res.status(500).json({
      error: "Internal error in commons flow demo",
      detail: err.message,
    });
  }
};
