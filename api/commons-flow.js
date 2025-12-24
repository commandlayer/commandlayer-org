// /api/commons-flow.js
// REAL Commons flow: forwards steps to Railway runtime and returns real receipts.

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

const VERSION = "1.0.0";

// IMPORTANT: set this in Vercel env
// e.g. https://runtime-production-214f.up.railway.app
const RUNTIME_BASE = process.env.RUNTIME_BASE_URL || "";

// --- Inline receipt.base + x402 minimal (same idea as your mock) ---
const receiptBaseSchema = {
  $id: "https://commandlayer.org/schemas/v1.0.0/_shared/receipt.base.schema.json",
  title: "receipt.base",
  type: "object",
  additionalProperties: false,
  properties: {
    x402: {
      allOf: [{ $ref: "https://commandlayer.org/schemas/v1.0.0/_shared/x402.schema.json" }],
    },
    trace: {
      type: "object",
      additionalProperties: false,
      properties: { trace_id: { type: "string", minLength: 1, maxLength: 128 } },
      required: ["trace_id"],
    },
    status: { type: "string", enum: ["success", "error", "delegated"] },
    error: { type: "object", additionalProperties: true },
    result: { type: "object" },
    usage: { type: "object" },
    metadata: { type: "object", additionalProperties: true },
  },
  required: ["x402", "trace", "status"],
};

const x402Schema = {
  $id: "https://commandlayer.org/schemas/v1.0.0/_shared/x402.schema.json",
  title: "x402.envelope.minimal",
  type: "object",
  additionalProperties: true,
  properties: {
    verb: { type: "string", minLength: 1, maxLength: 128 },
    version: { type: "string", minLength: 1, maxLength: 32 },
  },
  required: ["verb", "version"],
};

let validateReceiptBase = null;
let ajvSetupError = null;

try {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(x402Schema);
  validateReceiptBase = ajv.compile(receiptBaseSchema);
} catch (e) {
  ajvSetupError = e?.message || String(e);
}

function normalizeText(input) {
  if (typeof input === "string") return input.trim();
  if (input && typeof input.text === "string") return input.text.trim();
  if (input && typeof input.content === "string") return input.content.trim();
  return "";
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
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error || text || `HTTP ${res.status}`,
        data: json || null,
      };
    }

    return { ok: true, status: res.status, data: json ?? text };
  } finally {
    clearTimeout(t);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!RUNTIME_BASE) {
    return res.status(500).json({
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your Railway runtime base URL.",
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
      received_shape_hint: 'UI should send: { steps: [{ verb: "summarize", input: "text..." }] }',
    });
  }

  // Single trace_id across the flow (your runtime may generate its own too; we pass ours as actor metadata)
  const trace_id =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const responseSteps = [];

  for (const step of steps) {
    const url = `${RUNTIME_BASE.replace(/\/$/, "")}/${step.verb}/v${VERSION}`;

    // This shape should match your real runtime request schemas.
    // If your runtime expects input.content (not input.text), we send content.
    const runtimeReq = {
      x402: {
        entry: `x402://${step.verb}agent.eth/${step.verb}/v${VERSION}`,
        verb: step.verb,
        version: VERSION,
      },
      actor: "composer.commandlayer.org",
      trace: { trace_id }, // if your runtime ignores this, fine
      input: { content: step.text }, // <- adjust to match your runtime (content vs text)
    };

    const r = await postJson(url, runtimeReq, 20000);

    if (!r.ok) {
      return res.status(502).json({
        error: "Runtime call failed",
        verb: step.verb,
        runtime_url: url,
        status: r.status,
        detail: r.error,
        data: r.data,
      });
    }

    const receipt = r.data;

    if (validateReceiptBase) {
      const ok = validateReceiptBase(receipt);
      if (!ok) {
        return res.status(500).json({
          error: "Runtime receipt failed receipt.base validation",
          verb: step.verb,
          details: validateReceiptBase.errors,
          receipt,
          meta: { ajv_setup_error: ajvSetupError },
        });
      }
    }

    responseSteps.push({
      index: step.index,
      verb: step.verb,
      request: { input: { text: step.text } },
      receipt,
    });
  }

  return res.status(200).json({
    trace_id,
    steps: responseSteps,
    meta: {
      demo: true,
      mode: "runtime-backed",
      runtime_base: RUNTIME_BASE,
      receipt_base_validated: !!validateReceiptBase,
      ajv_setup_error: ajvSetupError,
    },
  });
};
