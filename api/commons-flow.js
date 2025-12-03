cd ~/commandlayer-org

cat > api/commons-flow.js << 'EOF'
// /api/commons-flow.js
// Commons flow demo — simple, schema-shaped receipts (no Ajv yet)

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
  return (
    "trace_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

// Minimal base receipt consistent with your v1 receipt.base + x402 usage
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
    },
  };
}

// Verb-specific "result" blocks that roughly match your Commons receipts
function makeDemoResult(verb, input) {
  const len = input.length;
  const summary = `Demo ${verb} result for input length=${len}`;

  switch (verb) {
    case "analyze":
      return {
        summary,
        insights: [
          "Demo-only analysis insight #1.",
          "Demo-only analysis insight #2.",
        ],
        labels: ["demo", "commons", verb],
        score: 0.42,
      };

    case "summarize":
      return {
        summary,
        bullet_points: [
          "Demo summarize output line 1.",
          "Demo summarize output line 2.",
        ],
      };

    case "classify":
      return {
        summary,
        labels: ["demo_label_a", "demo_label_b"],
      };

    case "fetch":
      return {
        summary,
        source_count: 1,
      };

    default:
      return {
        summary,
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

module.exports = async function handler(req, res) {
  try {
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

    const steps = body.steps.slice(0, 3); // max 3 for demo

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
  } catch (err) {
    console.error("[commons-flow] fatal error", err);
    return res.status(500).json({
      error: "internal_error",
      detail: err && err.message ? err.message : String(err),
    });
  }
};
EOF
