// /api/commons-flow.js
// Runtime-backed Commons flow: forwards each step to Railway runtime and returns receipts + curl + validation results.
// IMPORTANT: This API never hard-fails the demo due to schema validation mismatch. It reports validation errors inline.

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
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

const VERSION = "1.0.0";

// Demo-minimal receipt shape: require x402 + trace.trace_id + status, allow extras.
const receiptBaseSchema = {
  $id: "https://commandlayer.org/schemas/v1.0.0/_shared/receipt.base.schema.json",
  title: "receipt.base (demo-minimal)",
  type: "object",
  additionalProperties: true, // demo safe
  properties: {
    x402: {
      type: "object",
      additionalProperties: true,
      properties: {
        verb: { type: "string", minLength: 1, maxLength: 128 },
        version: { type: "string", minLength: 1, maxLength: 32 },
        entry: { type: "string", minLength: 1 },
      },
      required: ["verb", "version"],
    },
    trace: {
      type: "object",
      additionalProperties: true, // runtime includes more fields
      properties: {
        trace_id: { type: "string", minLength: 1, maxLength: 128 },
      },
      required: ["trace_id"],
    },
    status: { type: "string", enum: ["success", "error", "delegated"] },
    error: { type: "object", additionalProperties: true },
    result: { type: "object", additionalProperties: true },
    usage: { type: "object", additionalProperties: true },
    metadata: { type: "object", additionalProperties: true },
  },
  required: ["x402", "trace", "status"],
};

let validateReceiptBase = null;
let ajvSetupError = null;

try {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  validateReceiptBase = ajv.compile(receiptBaseSchema);
} catch (e) {
  ajvSetupError = e?.message || String(e);
  validateReceiptBase = null;
}

function normalizeText(input) {
  if (typeof input === "string") return input.trim();
  if (input && typeof input.text === "string") return input.text.trim();
  if (input && typeof input.content === "string") return input.content.trim();
  return "";
}

function makeTraceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeCurl(runtimeUrl, runtimeReq) {
  // Use single quotes safely for bash; JSON uses double quotes.
  const json = JSON.stringify(runtimeReq);
  return [
    `curl -sS --max-time 20 -X POST '${runtimeUrl}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  --data-binary '${json.replace(/'/g, "'\\''")}'`,
  ].join("\n");
}

async function postJson(url, body, timeoutMs = 20000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    // Try to parse JSON; runtime can return HTML on errors.
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (json && (json.error || json.message)) || text || `HTTP ${res.status}`,
        data: json || null,
        raw: json ? null : text,
      };
    }

    return { ok: true, status: res.status, data: json ?? text };
  } finally {
    clearTimeout(t);
  }
}

async function getHealth(runtimeBase) {
  if (!runtimeBase) return { ok: false, status: null, detail: "missing_runtime_base" };
  const url = `${runtimeBase.replace(/\/$/, "")}/health`;
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, detail: res.ok ? "ok" : text.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: null, detail: e?.message || String(e) };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // IMPORTANT: read env at request-time
  const RUNTIME_BASE = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");

  if (!RUNTIME_BASE) {
    return res.status(500).json({
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your Railway runtime base URL (e.g. https://runtime-production-214f.up.railway.app) and redeploy.",
    });
  }

  const body = req.body || {};
  const incomingSteps = Array.isArray(body.steps) ? body.steps : [];

  const steps = [];
  incomingSteps.forEach((s, idx) => {
    const verb = String(s?.verb || "").trim();
    const text = normalizeText(s?.input);
    if (!verb || !COMMON_VERBS.includes(verb)) return;
    if (!text) return;
    steps.push({ index: idx, verb, text });
  });

  if (!steps.length) {
    return res.status(400).json({
      error: "No valid steps provided. Each step needs a Commons verb and non-empty input.",
      expected: { steps: [{ verb: "summarize", input: "hello" }] },
    });
  }

  const trace_id = body.trace_id ? String(body.trace_id).trim() : makeTraceId();

  // Pre-flight health (so the UI can display it immediately)
  const health = await getHealth(RUNTIME_BASE);

  const responseSteps = [];
  const curlBlocks = [];

  for (const step of steps) {
    const runtimeUrl = `${RUNTIME_BASE}/${step.verb}/v${VERSION}`;

    // Match your runtime request shape
    const runtimeReq = {
      x402: {
        entry: `x402://${step.verb}agent.eth/${step.verb}/v${VERSION}`,
        verb: step.verb,
        version: VERSION,
      },
      actor: "composer.commandlayer.org",
      trace: { trace_id },
      input: { content: step.text },
    };

    const curl = makeCurl(runtimeUrl, runtimeReq);
    curlBlocks.push(`# ${step.verb}\n${curl}`);

    const r = await postJson(runtimeUrl, runtimeReq, 20000);

    if (!r.ok) {
      // NOTE: return 502 for upstream failure, but include curl + raw for debugging
      return res.status(502).json({
        error: "Runtime call failed",
        verb: step.verb,
        runtime_url: runtimeUrl,
        status: r.status,
        detail: r.error,
        data: r.data,
        raw: r.raw,
        trace_id,
        meta: {
          mode: "runtime-backed",
          runtime_base: RUNTIME_BASE,
          runtime_health: health,
          receipt_base_validated: !!validateReceiptBase,
          ajv_setup_error: ajvSetupError,
          curl: curlBlocks.join("\n\n"),
        },
      });
    }

    const receipt = r.data;

    // Demo-safe validation: never hard fail. Report result per-step.
    let validation = { ok: null, errors: null };
    if (validateReceiptBase) {
      const ok = validateReceiptBase(receipt);
      validation = { ok: !!ok, errors: ok ? null : validateReceiptBase.errors };
    } else {
      validation = { ok: null, errors: [{ message: "Ajv not initialized", detail: ajvSetupError }] };
    }

    responseSteps.push({
      index: step.index,
      verb: step.verb,
      runtime_url: runtimeUrl,
      request: runtimeReq,
      curl,
      validation,
      receipt,
    });
  }

  return res.status(200).json({
    trace_id,
    steps: responseSteps,
    meta: {
      mode: "runtime-backed",
      runtime_base: RUNTIME_BASE,
      runtime_health: health,
      receipt_base_validated: !!validateReceiptBase,
      ajv_setup_error: ajvSetupError,
      curl: curlBlocks.join("\n\n"),
    },
  });
};
