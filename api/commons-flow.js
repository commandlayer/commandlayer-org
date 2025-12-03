// /api/commons-flow.js
// Minimal Commons flow demo — no Ajv, but schema-shaped receipts.

const crypto = require("crypto");

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
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function baseReceipt(verb, index, traceId) {
  return {
    // loosely shaped like your receipt.base:
    trace_id: traceId,
    step_index: index,
    status: "ok",
    verb,
    schema_version: "1.0.0",
    // x402 envelope stubbed:
    x402: {
      verb,
      version: "1.0.0",
    },
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}

function makeResult(verb, inputText) {
  const text = String(inputText || "").slice(0, 2000);

  switch (verb) {
    case "summarize":
      return {
        summary: text.length
          ? `Demo summary for input (${text.length} chars).`
          : "Demo summary: no input provided.",
        highlights: [
          "This is a demo-only summarize.result",
          "Real agents would map exactly to summarize.receipt schema.",
        ],
      };

    case "analyze":
      return {
        summary: `Demo analysis for: "${text.slice(0, 120)}"`,
        insights: [
          "Insight 1: this is a synthetic analysis.",
          "Insight 2: the shapes map to analyze.receipt.result.",
        ],
        labels: ["demo", "commons", "analyze"],
        score: 0.7,
      };

    case "classify":
      return {
        labels: ["demo", "classified"],
        primary_label: "demo",
        confidence: 0.95,
      };

    case "clean":
      return {
        cleaned_text: text.replace(/\s+/g, " ").trim(),
        operations: ["normalize_whitespace"],
      };

    case "convert":
      return {
        summary: "Demo convert: no-op, just echoes input.",
        raw: text,
        target_format: "demo",
      };

    case "describe":
      return {
        description: `Demo description of: "${text.slice(0, 120)}"`,
        tags: ["demo", "describe"],
      };

    case "explain":
      return {
        explanation: "Demo explain: this would normally unpack the input.",
        steps: [
          "Parse input.",
          "Apply explanation model.",
          "Return narrative explanation.",
        ],
      };

    case "format":
      return {
        formatted: text.toUpperCase(),
        style: "DEMO_UPPERCASE",
      };

    case "parse":
      return {
        parsed: {
          demo: true,
          length: text.length,
        },
        notes: "Demo parse: structured echo of your input.",
      };

    case "fetch":
      return {
        source: text || "https://example.com/demo",
        content: "Demo fetch: this is placeholder content, not real network IO.",
      };

    default:
      return {
        note: "Unknown verb in demo result; this should not happen if frontend clamps verbs.",
      };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const steps = Array.isArray(body.steps) ? body.steps : [];

    if (!steps.length) {
      return res.status(400).json({
        error: "No steps provided",
        detail: "Body must be { steps: [{ verb, input }] } with at least one step.",
      });
    }

    const traceId = makeTraceId();

    const receipts = steps.slice(0, 3).map((step, idx) => {
      const verb = (step.verb || "").trim();
      const input = (step.input || "").trim();

      if (!COMMON_VERBS.includes(verb)) {
        return {
          error: "invalid_verb",
          verb,
          index: idx,
          message: "Verb must be one of Commons v1.0.0 verbs.",
        };
      }

      if (!input) {
        return {
          error: "missing_input",
          verb,
          index: idx,
          message: "Input text is required for each step.",
        };
      }

      const receipt = baseReceipt(verb, idx, traceId);
      receipt.result = makeResult(verb, input);

      return {
        index: idx,
        verb,
        request: { input: { text: input } },
        receipt,
      };
    });

    return res.status(200).json({
      trace_id: traceId,
      steps: receipts,
      meta: {
        demo: true,
        schema_alignment: "loosely_aligned_v1_commons_receipts",
      },
    });
  } catch (err) {
    console.error("[commons-flow] fatal error", err);
    return res.status(500).json({
      error: "internal_error",
      message: err && err.message ? err.message : String(err),
    });
  }
};
