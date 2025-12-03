// /api/commons-flow.js
// Commons flow demo — Ajv-validated against a demo-aligned copy of receipt.base

const crypto = require("crypto");
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

// Inline, demo-aligned copy of receipt.base:
// - Same structure and semantics
// - x402 is simplified inline instead of using a $ref
const receiptBaseSchema = {
  $id: "https://commandlayer.org/schemas/v1.0.0/_shared/receipt.base.demo.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "receipt.base (demo-aligned)",
  description:
    "Base structure for all CommandLayer receipts, extended on a per-verb basis. Demo-aligned copy (inline x402).",
  type: "object",
  additionalProperties: false,
  properties: {
    x402: {
      description:
        "x402 envelope describing the verb and version for this receipt.",
      type: "object",
      additionalProperties: true,
      properties: {
        verb: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        version: {
          type: "string",
          minLength: 1,
          maxLength: 32,
        },
      },
      required: ["verb", "version"],
    },
    trace: {
      description:
        "Minimal execution trace for correlating this receipt with the originating request and downstream spans.",
      type: "object",
      additionalProperties: false,
      properties: {
        trace_id: {
          description:
            "Unique identifier for this execution trace within the provider or agent.",
          type: "string",
          minLength: 1,
          maxLength: 128,
        },
        parent_trace_id: {
          description:
            "Optional parent trace identifier for delegated or chained calls.",
          type: "string",
          minLength: 1,
          maxLength: 128,
        },
        started_at: {
          description: "RFC 3339 timestamp when execution started.",
          type: "string",
          format: "date-time",
          maxLength: 64,
        },
        completed_at: {
          description: "RFC 3339 timestamp when execution completed.",
          type: "string",
          format: "date-time",
          maxLength: 64,
        },
        duration_ms: {
          description: "Observed execution duration in milliseconds.",
          type: "integer",
          minimum: 0,
          maximum: 86400000,
        },
        provider: {
          description:
            "Logical provider identifier (platform, runtime, or cluster).",
          type: "string",
          maxLength: 256,
        },
        region: {
          description:
            "Execution region or data residency hint (e.g., us-east-1).",
          type: "string",
          maxLength: 64,
        },
        model: {
          description: "Model or engine identifier, if applicable.",
          type: "string",
          maxLength: 256,
        },
        tags: {
          description:
            "Optional opaque tags for downstream correlation and observability.",
          type: "array",
          items: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
          maxItems: 64,
        },
      },
      required: ["trace_id"],
    },
    status: {
      description: "Outcome status for this verb invocation.",
      type: "string",
      enum: ["success", "error", "delegated"],
    },
    error: {
      description: "Error details when status = 'error'.",
      type: "object",
      additionalProperties: false,
      properties: {
        code: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
        message: {
          type: "string",
          minLength: 1,
          maxLength: 2048,
        },
        retryable: {
          description:
            "Whether the caller may reasonably retry this request.",
          type: "boolean",
        },
        details: {
          description:
            "Optional provider-specific error details. Non-normative.",
          type: "object",
          additionalProperties: true,
        },
      },
    },
    delegation_result: {
      description:
        "Swarm-style delegation outcome when another agent participated in fulfilling this request.",
      type: "object",
      additionalProperties: false,
      properties: {
        performed: {
          description:
            "Whether any delegation or handoff actually occurred.",
          type: "boolean",
        },
        target_agent: {
          description:
            "Identifier (e.g., ENS name) of the downstream agent that took over.",
          type: "string",
          maxLength: 256,
        },
        reason: {
          description:
            "Human-readable reason for delegation or handoff.",
          type: "string",
          maxLength: 1024,
        },
        handoff_trace_id: {
          description:
            "Trace or task identifier used by the downstream agent.",
          type: "string",
          maxLength: 128,
        },
      },
    },
    metadata: {
      description:
        "Optional additional metadata, safe for logging and analytics. Must not change core semantics.",
      type: "object",
      additionalProperties: true,
    },
    result: {
      description:
        "Verb-specific result payload; concrete shape defined by each verb receipt schema.",
      type: "object",
    },
    usage: {
      description:
        "Optional resource usage metrics; concrete shape may be extended by each verb receipt schema.",
      type: "object",
    },
  },
  required: ["x402", "trace", "status"],
};

// Ajv instance (strict, with date-time formats)
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateReceiptBase = ajv.compile(receiptBaseSchema);

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function demoUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function buildResultForVerb(verb, inputText) {
  // Very simple demo shapes; these map loosely to your v1 Commons result payloads.
  switch (verb) {
    case "analyze":
      return {
        summary: `Demo analysis for: "${inputText}"`,
        insights: [
          "Insight 1: this is a synthetic analysis.",
          "Insight 2: the shapes map to analyze.receipt.result.",
        ],
        labels: ["demo", "commons", "analyze"],
        score: 0.7,
      };
    case "summarize":
      return {
        summary: `Demo summary for: "${inputText}"`,
        bullets: [
          "Bullet 1: demo-only summarization.",
          "Bullet 2: shapes loosely aligned to summarize.receipt.",
        ],
      };
    case "classify":
      return {
        label: "demo_category",
        confidence: 0.8,
        summary: `Classified input as demo_category`,
      };
    case "clean":
      return {
        summary: "Demo clean: whitespace normalized, obvious noise removed.",
        original_length: inputText.length,
        cleaned_length: inputText.trim().length,
      };
    case "convert":
      return {
        summary: "Demo convert: no-op, just echoes input.",
        raw: inputText,
        target_format: "demo",
      };
    case "describe":
      return {
        summary: `Demo description based on: "${inputText}"`,
      };
    case "explain":
      return {
        summary: `Demo explanation for: "${inputText}"`,
        steps: [
          "Step 1: restate the problem.",
          "Step 2: outline a high-level explanation.",
        ],
      };
    case "format":
      return {
        summary: "Demo formatting applied.",
      };
    case "parse":
      return {
        summary: "Demo parse: structured fields extracted.",
      };
    case "fetch":
      return {
        summary: `Demo fetch: pretend we retrieved content for "${inputText}".`,
      };
    default:
      return {
        summary: `Demo result for verb "${verb}"`,
      };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let steps = [];
  try {
    steps = (req.body && req.body.steps) || [];
  } catch (_e) {
    return res.status(400).json({ error: "invalid_json_body" });
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({
      error: "invalid_steps",
      message:
        "Body must be { steps: [{ verb, input }] } with at least one Commons verb.",
    });
  }

  const flowTraceId = newId();
  const outSteps = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index] || {};
    const verb = (step.verb || "").trim();
    const inputText = (step.input || "").trim();

    if (!verb || !COMMON_VERBS.includes(verb)) {
      return res.status(400).json({
        error: "unsupported_verb",
        step_index: index,
        verb,
      });
    }

    if (!inputText) {
      return res.status(400).json({
        error: "missing_input",
        step_index: index,
        verb,
      });
    }

    const stepTraceId = `${flowTraceId}:${index}`;
    const started = new Date();
    const result = buildResultForVerb(verb, inputText);
    const completed = new Date();
    const durationMs = completed.getTime() - started.getTime();

    const receipt = {
      x402: {
        verb,
        version: "1.0.0",
      },
      trace: {
        trace_id: stepTraceId,
        parent_trace_id: flowTraceId,
        started_at: started.toISOString(),
        completed_at: completed.toISOString(),
        duration_ms: durationMs,
        provider: "commandlayer-demo",
        region: "vercel",
        model: "demo-runtime",
        tags: ["commons-flow-demo"],
      },
      status: "success",
      result,
      usage: demoUsage(),
      metadata: {
        verb,
        step_index: index,
        schema_version: "1.0.0",
      },
    };

    const valid = validateReceiptBase(receipt);
    if (!valid) {
      console.error("Receipt validation failed", validateReceiptBase.errors);
      return res.status(500).json({
        error: "internal_schema_violation",
        step_index: index,
        details: validateReceiptBase.errors,
      });
    }

    outSteps.push({
      index,
      verb,
      request: {
        input: {
          text: inputText,
        },
      },
      receipt,
    });
  }

  return res.status(200).json({
    trace_id: flowTraceId,
    steps: outSteps,
    meta: {
      demo: true,
      schema_alignment: "demo_base_v1_commons_receipts",
      steps_count: outSteps.length,
    },
  });
};
