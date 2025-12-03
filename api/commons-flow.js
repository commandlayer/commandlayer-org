// /api/commons-flow.js
// Commons flow demo with Ajv validation against receipt.base (no ajv-formats)

const Ajv = require('ajv');
const { randomUUID } = require('crypto');

const COMMON_VERBS = [
  'analyze',
  'classify',
  'clean',
  'convert',
  'describe',
  'explain',
  'format',
  'parse',
  'summarize',
  'fetch',
];

// --- Inline receipt.base schema (v1.0.0) ---

const receiptBaseSchema = {
  $id: 'https://commandlayer.org/schemas/v1.0.0/_shared/receipt.base.schema.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'receipt.base',
  description:
    'Base structure for all CommandLayer receipts, extended on a per-verb basis. Designed for A2A, Swarm-style delegation, and x402 alignment.',
  type: 'object',
  additionalProperties: false,
  properties: {
    x402: {
      description: 'x402 envelope describing the verb and version for this receipt.',
      allOf: [
        {
          $ref: 'https://commandlayer.org/schemas/v1.0.0/_shared/x402.schema.json',
        },
      ],
    },
    trace: {
      description:
        'Minimal execution trace for correlating this receipt with the originating request and downstream spans.',
      type: 'object',
      additionalProperties: false,
      properties: {
        trace_id: {
          description: 'Unique identifier for this execution trace within the provider or agent.',
          type: 'string',
          minLength: 1,
          maxLength: 128,
        },
        parent_trace_id: {
          description: 'Optional parent trace identifier for delegated or chained calls.',
          type: 'string',
          minLength: 1,
          maxLength: 128,
        },
        started_at: {
          description: 'RFC 3339 timestamp when execution started.',
          type: 'string',
          format: 'date-time',
          maxLength: 64,
        },
        completed_at: {
          description: 'RFC 3339 timestamp when execution completed.',
          type: 'string',
          format: 'date-time',
          maxLength: 64,
        },
        duration_ms: {
          description: 'Observed execution duration in milliseconds.',
          type: 'integer',
          minimum: 0,
          maximum: 86400000,
        },
        provider: {
          description: 'Logical provider identifier (platform, runtime, or cluster).',
          type: 'string',
          maxLength: 256,
        },
        region: {
          description: 'Execution region or data residency hint (e.g., us-east-1).',
          type: 'string',
          maxLength: 64,
        },
        model: {
          description: 'Model or engine identifier, if applicable.',
          type: 'string',
          maxLength: 256,
        },
        tags: {
          description: 'Optional opaque tags for downstream correlation and observability.',
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
          },
          maxItems: 64,
        },
      },
      required: ['trace_id'],
    },
    status: {
      description: 'Outcome status for this verb invocation.',
      type: 'string',
      enum: ['success', 'error', 'delegated'],
    },
    error: {
      description: 'Error details when status = "error".',
      type: 'object',
      additionalProperties: false,
      properties: {
        code: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
        },
        message: {
          type: 'string',
          minLength: 1,
          maxLength: 2048,
        },
        retryable: {
          description: 'Whether the caller may reasonably retry this request.',
          type: 'boolean',
        },
        details: {
          description: 'Optional provider-specific error details. Non-normative.',
          type: 'object',
          additionalProperties: true,
        },
      },
    },
    delegation_result: {
      description:
        'Swarm-style delegation outcome when another agent participated in fulfilling this request.',
      type: 'object',
      additionalProperties: false,
      properties: {
        performed: {
          description: 'Whether any delegation or handoff actually occurred.',
          type: 'boolean',
        },
        target_agent: {
          description: 'Identifier (e.g., ENS name) of the downstream agent that took over.',
          type: 'string',
          maxLength: 256,
        },
        reason: {
          description: 'Human-readable reason for delegation or handoff.',
          type: 'string',
          maxLength: 1024,
        },
        handoff_trace_id: {
          description: 'Trace or task identifier used by the downstream agent.',
          type: 'string',
          maxLength: 128,
        },
      },
    },
    metadata: {
      description:
        'Optional additional metadata, safe for logging and analytics. Must not change core semantics.',
      type: 'object',
      additionalProperties: true,
    },
    result: {
      description:
        'Verb-specific result payload; concrete shape defined by each verb receipt schema.',
      type: 'object',
    },
    usage: {
      description:
        'Optional resource usage metrics; concrete shape may be extended by each verb receipt schema.',
      type: 'object',
    },
  },
  required: ['x402', 'trace', 'status'],
};

// Minimal x402 stub so Ajv can resolve the $ref locally
const x402Schema = {
  $id: 'https://commandlayer.org/schemas/v1.0.0/_shared/x402.schema.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'x402.envelope.minimal',
  type: 'object',
  additionalProperties: true,
  properties: {
    verb: { type: 'string', minLength: 1, maxLength: 128 },
    version: { type: 'string', minLength: 1, maxLength: 32 },
  },
  required: ['verb', 'version'],
};

// --- Ajv setup ---
// No ajv-formats here on purpose: less to go wrong at runtime.

let validateReceiptBase;
let ajvSetupError = null;

try {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  });

  ajv.addSchema(x402Schema);
  validateReceiptBase = ajv.compile(receiptBaseSchema);
} catch (err) {
  console.error('[commons-flow] Ajv setup failed; receipts will not be validated', err);
  ajvSetupError = String(err && err.message ? err.message : err);
  validateReceiptBase = null;
}

// --- Utilities ---

function makeTrace(traceId, extraTags) {
  const started = new Date();
  const completed = new Date();

  return {
    trace_id: traceId,
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
    duration_ms: 0,
    provider: 'commandlayer.demo',
    region: 'vercel',
    model: 'demo-mock-1',
    tags: extraTags || [],
  };
}

function makeResultForVerb(verb, text) {
  switch (verb) {
    case 'analyze':
      return {
        summary: `Demo analysis for: "${text}"`,
        insights: [
          'Insight 1: this is a synthetic analysis.',
          'Insight 2: the shapes map to analyze.receipt.result.',
        ],
        labels: ['demo', 'commons', 'analyze'],
        score: 0.7,
      };
    case 'summarize':
      return {
        summary: `Demo summary for: "${text}"`,
        bullets: ['Point 1 (demo)', 'Point 2 (demo)', 'Point 3 (demo)'],
      };
    case 'classify':
      return {
        summary: `Demo classification for: "${text}"`,
        labels: ['demo-label-1', 'demo-label-2'],
      };
    case 'clean':
      return {
        summary: 'Demo clean: input normalized',
        before: text,
        after: text.trim(),
      };
    case 'convert':
      return {
        summary: 'Demo convert: no-op, just echoes input.',
        raw: text,
        target_format: 'demo',
      };
    case 'describe':
      return {
        summary: `Demo description for: "${text}"`,
        details: ['High-level description (demo)', 'Secondary detail (demo)'],
      };
    case 'explain':
      return {
        summary: `Demo explanation for: "${text}"`,
        steps: ['Step 1 (demo)', 'Step 2 (demo)', 'Step 3 (demo)'],
      };
    case 'format':
      return {
        summary: 'Demo format: formatted output',
        formatted: `**${text}**`,
      };
    case 'parse':
      return {
        summary: 'Demo parse: tokenized segments',
        tokens: text.split(/\s+/).filter(Boolean),
      };
    case 'fetch':
      return {
        summary: `Demo fetch: fake retrieval for "${text}"`,
        url: 'https://example.com/demo',
      };
    default:
      return {
        summary: `Unsupported verb "${verb}" in demo.`,
      };
  }
}

function makeUsage(text, result) {
  const inputTokens = text.length;
  const resultStr = JSON.stringify(result || {});
  const outputTokens = resultStr.length;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

// --- Handler ---

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const incomingSteps = Array.isArray(body.steps) ? body.steps : [];

  const normalizedSteps = [];
  incomingSteps.forEach((step, idx) => {
    if (!step) return;
    const verb = (step.verb || '').trim();
    const input = step.input || {};
    const text =
      typeof input === 'string'
        ? input.trim()
        : typeof input.text === 'string'
        ? input.text.trim()
        : '';

    if (!verb || !COMMON_VERBS.includes(verb)) return;
    if (!text) return;

    normalizedSteps.push({
      index: idx,
      verb,
      text,
    });
  });

  if (!normalizedSteps.length) {
    return res.status(400).json({
      error:
        'No valid steps provided. Each step needs a Commons verb and non-empty input.text.',
    });
  }

  const traceId =
    typeof randomUUID === 'function'
      ? randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

  const responseSteps = [];

  for (const step of normalizedSteps) {
    const result = makeResultForVerb(step.verb, step.text);
    const usage = makeUsage(step.text, result);

    const receipt = {
      x402: {
        verb: step.verb,
        version: '1.0.0',
      },
      trace: makeTrace(traceId, ['commons-demo', step.verb]),
      status: 'success',
      result,
      usage,
      metadata: {
        step_index: step.index,
      },
    };

    if (validateReceiptBase) {
      const valid = validateReceiptBase(receipt);
      if (!valid) {
        console.error('[commons-flow] Receipt validation failed', validateReceiptBase.errors);
        // For demo: DO NOT 500; return the invalid receipt with errors so you can see what’s wrong.
        responseSteps.push({
          index: step.index,
          verb: step.verb,
          request: { input: { text: step.text } },
          receipt,
          validation_errors: validateReceiptBase.errors,
        });
        continue;
      }
    }

    responseSteps.push({
      index: step.index,
      verb: step.verb,
      request: {
        input: { text: step.text },
      },
      receipt,
    });
  }

  return res.status(200).json({
  trace_id: traceId,
  steps: responseSteps,
  meta: {
    demo: true,
    schema_alignment: 'receipt.base.v1.0.0',
    ajv_validation: !!validateReceiptBase,
    ajv_setup_error: ajvSetupError || null,
    },
  });
};
