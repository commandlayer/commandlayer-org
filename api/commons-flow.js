// /api/commons-flow.js
// Commons flow demo — validates receipts against v1.0.0 Commons schemas

const Ajv = require("ajv");
const addFormats = require("ajv-formats");

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

// Map each Commons verb to its v1.0.0 receipt schema URL
const RECEIPT_SCHEMA_URLS = {
  analyze:
    "https://commandlayer.org/schemas/v1.0.0/commons/analyze/receipts/analyze.receipt.schema.json",
  classify:
    "https://commandlayer.org/schemas/v1.0.0/commons/classify/receipts/classify.receipt.schema.json",
  clean:
    "https://commandlayer.org/schemas/v1.0.0/commons/clean/receipts/clean.receipt.schema.json",
  convert:
    "https://commandlayer.org/schemas/v1.0.0/commons/convert/receipts/convert.receipt.schema.json",
  describe:
    "https://commandlayer.org/schemas/v1.0.0/commons/describe/receipts/describe.receipt.schema.json",
  explain:
    "https://commandlayer.org/schemas/v1.0.0/commons/explain/receipts/explain.receipt.schema.json",
  format:
    "https://commandlayer.org/schemas/v1.0.0/commons/format/receipts/format.receipt.schema.json",
  parse:
    "https://commandlayer.org/schemas/v1.0.0/commons/parse/receipts/parse.receipt.schema.json",
  summarize:
    "https://commandlayer.org/schemas/v1.0.0/commons/summarize/receipts/summarize.receipt.schema.json",
  fetch:
    "https://commandlayer.org/schemas/v1.0.0/commons/fetch/receipts/fetch.receipt.schema.json",
};

// Simple in-memory cache so we don't refetch schemas every call
let ajv;
const compiledReceiptValidators = new Map();

function getAjv() {
  if (!ajv) {
    ajv = new Ajv({
      strict: true,
      allErrors: true,
    });
    addFormats(ajv);
  }
  return ajv;
}

async function getReceiptValidator(verb) {
  const cached = compiledReceiptValidators.get(verb);
  if (cached) return cached;

  const url = RECEIPT_SCHEMA_URLS[verb];
  if (!url) {
    throw new Error(`No receipt schema URL for verb "${verb}"`);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load schema for ${verb}: HTTP ${res.status}`
    );
  }
  const schema = await res.json();

  const ajvInstance = getAjv();
  const validate = ajvInstance.compile(schema);
  compiledReceiptValidators.set(verb, validate);
  return validate;
}

function makeTraceId() {
  return (
    "trace_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

function makeBaseReceipt({ verb, traceId, stepIndex }) {
  const now = new Date().toISOString();
  return {
    id: `${traceId}:${verb}:${stepIndex}`,
    kind: "receipt",
    trace_id: traceId,
    verb,
    version: "1.0.0",
    timestamp: now,
    x402: {
      verb,
      version: "1.0.0",
      // keep it intentionally simple; you can extend this later
    },
  };
}

// Very simple "results" so we don't pretend to be an LLM or real runtime
function makeDemoResult(verb, input) {
  const baseSummary = `Demo ${verb} result for input length=${input.length}`;

  switch (verb) {
    case "analyze":
      return {
        summary: baseSummary,
        insights: [
          "This is a demo-only analysis result.",
          "In a real agent, this would reflect your model’s output.",
        ],
        labels: ["demo", "commons", verb],
        score: 0.42,
      };
    case "summarize":
      return {
        summary: baseSummary,
        bullet_points: [
          "Demo summarize output line 1.",
          "Demo summarize output line 2.",
        ],
      };
    case "classify":
      return {
        summary: baseSummary,
        labels: ["demo_label_a", "demo_label_b"],
      };
    case "fetch":
      return {
        summary: baseSummary,
        source_count: 1,
      };
    default:
      return {
        summary: baseSummary,
      };
  }
}

function makeUsage(stepIndex) {
  return {
    input_tokens: 128 + stepIndex * 10,
    output_tokens: 64 + stepIndex * 5,
    total_tokens: 192 + stepIndex * 15,
    cost: 0.0001 * (stepIndex + 1),
  };
}

// Vercel handler
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};

  if (!Array.isArray(body.steps)) {
    return res.status(400).json({
      error: "Invalid payload: steps must be an array",
    });
  }

  const steps = body.steps.slice(0, 3); // cap at 3 for the demo

  const normalizedSteps = steps
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      const verb = (s.verb || "").trim();
      const input = (s.input || "").trim();
      if (!verb || !COMMON_VERBS.includes(verb)) return null;
      if (!input) return null;
      return { verb, input, index: i };
    })
    .filter(Boolean);

  if (!normalizedSteps.length) {
    return res.status(400).json({
      error:
        "No valid steps provided. Each step needs a Commons verb and non-empty input.",
    });
  }

  const traceId = makeTraceId();
  const results = [];

  for (let i = 0; i < normalizedSteps.length; i++) {
    const { verb, input, index } = normalizedSteps[i];

    const base = makeBaseReceipt({
      verb,
      traceId,
      stepIndex: i,
    });

    const receipt = {
      ...base,
      result: makeDemoResult(verb, input),
      usage: makeUsage(i),
    };

    // Validate against the verb-specific receipt schema
    try {
      const validate = await getReceiptValidator(verb);
      const ok = validate(receipt);
      if (!ok) {
        results.push({
          step: index,
          verb,
          error: "Receipt validation failed",
          ajv_errors: validate.errors,
        });
        continue;
      }
    } catch (err) {
      results.push({
        step: index,
        verb,
        error: "Schema load/compile failed",
        detail: err.message || String(err),
      });
      continue;
    }

    results.push({
      step: index,
      verb,
      receipt,
    });
  }

  return res.status(200).json({
    trace_id: traceId,
    steps_requested: steps.length,
    steps_executed: normalizedSteps.length,
    results,
  });
};
