// /api/commons-flow.js
// Runtime-backed Commons flow. Always returns receipts.
// If receipt.base validation fails, we include validation errors instead of 500.

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

// --- Inline receipt.base (MINIMAL) ---
// IMPORTANT: This should match what your runtime emits, or you’ll see validation warnings.
// We will NOT hard-fail; we’ll return errors in `validation`.
const receiptBaseSchema = {
  $id: "https://commandlayer.org/schemas/v1.0.0/_shared/receipt.base.schema.json",
  title: "receipt.base (demo-minimal)",
  type: "object",
  additionalProperties: true, // <-- don’t block unknown fields in demo
  properties: {
    x402: { type: "object" },
    trace: { type: "object" },
    trace_id: { type: "string" }, // <-- support top-level trace_id too
    status: { type: "string" },   // <-- don’t restrict enum in demo
    result: { type: "object" },
    usage: { type: "object" },
    error: { type: "object" },
    metadata: { type: "object" },
  },
  required: ["x402", "status"], // keep light requirements
};

let validateReceiptBase = null;
let ajvSetupError = null;

try {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
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

function makeTraceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const RUNTIME_BASE = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
  if (!RUNTIME_BASE) {
    return res.status(500).json({
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your Railway runtime base URL and redeploy.",
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

  const responseSteps = [];

  for (const step of steps) {
    const runtimeUrl = `${RUNTIME_BASE}/${step.verb}/v${VERSION}`;

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

    const r = await postJson(runtimeUrl, runtimeReq, 20000);

    if (!r.ok) {
      return res.status(502).json({
        error: "Runtime call failed",
        verb: step.verb,
        runtime_url: runtimeUrl,
        status: r.status,
        detail: r.error,
        data: r.data,
        raw: r.raw,
      });
    }

    const receipt = r.data;

    // Validate, but never block demo
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
      receipt,
      validation,
    });
  }

  return res.status(200).json({
    trace_id,
    steps: responseSteps,
    meta: {
      mode: "runtime-backed",
      runtime_base: RUNTIME_BASE,
      receipt_base_validated: !!validateReceiptBase,
      ajv_setup_error: ajvSetupError,
    },
  });
};
