// /api/commons-flow.js
// Runtime-backed Commons flow: forwards steps to Railway runtime, returns receipts + per-step curl,
// validates minimal receipt.base shape (Ajv).

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

// Minimal receipt.base validator (fast + stable)
const receiptBaseSchema = {
  $id: "https://www.commandlayer.org/schemas/v1.0.0/_shared/receipt.base.schema.json",
  title: "receipt.base (minimal)",
  type: "object",
  additionalProperties: true, // runtime adds metadata/proof fields; do not block
  properties: {
    status: { type: "string" },
    x402: {
      type: "object",
      additionalProperties: true,
      properties: {
        verb: { type: "string" },
        version: { type: "string" },
      },
      required: ["verb", "version"],
    },
    trace: {
      type: "object",
      additionalProperties: true,
      properties: {
        trace_id: { type: "string" },
      },
      required: ["trace_id"],
    },
    result: { type: ["object", "array", "string", "number", "boolean", "null"] },
    error: { type: ["object", "null"] },
    metadata: { type: ["object", "null"] },
  },
  required: ["status", "x402", "trace"],
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

function makeTraceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(maybeJsonString) {
  if (typeof maybeJsonString !== "string") return { ok: false };
  const s = maybeJsonString.trim();
  if (!s) return { ok: false };
  if (!(s.startsWith("{") || s.startsWith("["))) return { ok: false };
  try {
    const val = JSON.parse(s);
    return { ok: true, value: val };
  } catch {
    return { ok: false };
  }
}

function normalizeInput(input) {
  // Option C: UI should send input as an object/array already.
  // But we still support legacy string input:
  //   "hello" => { content: "hello" }
  if (input == null) return null;

  if (typeof input === "string") {
    const parsed = safeJsonParse(input);
    if (parsed.ok) return parsed.value;
    const text = input.trim();
    if (!text) return null;
    return { content: text };
  }

  if (typeof input === "object") {
    // object or array: accept as-is
    return input;
  }

  // number/bool/etc: wrap
  return { content: String(input) };
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
        content_type: res.headers.get("content-type") || null,
      };
    }

    return { ok: true, status: res.status, data: json ?? text };
  } finally {
    clearTimeout(t);
  }
}

function buildRuntimeRequest(verb, trace_id, inputObj) {
  return {
    x402: {
      entry: `x402://${verb}agent.eth/${verb}/v${VERSION}`,
      verb,
      version: VERSION,
    },
    actor: "composer.commandlayer.org",
    trace: { trace_id },
    input: inputObj,
  };
}

// safer curl: single quotes around JSON, and escape any single quotes inside payload
function shellSingleQuote(str) {
  // wraps in single quotes, escapes any single quote by closing/opening: 'foo'"'"'bar'
  return `'${String(str).replace(/'/g, `'\"'\"'`)}'`;
}

function buildCurl(runtimeUrl, runtimeReq) {
  const bodyStr = JSON.stringify(runtimeReq);
  return [
    `curl -sS --max-time 20 -X POST ${shellSingleQuote(runtimeUrl)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  --data-binary ${shellSingleQuote(bodyStr)}`,
  ].join("\n");
}

async function checkRuntimeHealth(runtimeBase) {
  const url = runtimeBase.replace(/\/$/, "") + "/health";
  try {
    const res = await fetch(url, { method: "GET" });
    const txt = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, detail: (txt || "").slice(0, 100) || null };
  } catch (e) {
    return { ok: false, status: 0, detail: e?.message || String(e) };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Read env at request-time (avoids “baked empty string”)
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
    if (!verb || !COMMON_VERBS.includes(verb)) return;

    const inputObj = normalizeInput(s?.input);
    if (inputObj == null) return;

    steps.push({ index: idx, verb, input: inputObj });
  });

  if (!steps.length) {
    return res.status(400).json({
      error: "No valid steps provided. Each step needs a Commons verb and non-empty input (string or JSON).",
      expected: {
        steps: [
          { verb: "summarize", input: { content: "hello" } },
          { verb: "convert", input: { content: "hi", source_format: "text", target_format: "markdown" } },
        ],
      },
    });
  }

  const trace_id = body.trace_id ? String(body.trace_id).trim() : makeTraceId();

  const runtime_health = await checkRuntimeHealth(RUNTIME_BASE);

  const responseSteps = [];

  for (const step of steps) {
    const runtimeUrl = `${RUNTIME_BASE}/${step.verb}/v${VERSION}`;
    const runtimeReq = buildRuntimeRequest(step.verb, trace_id, step.input);

    const r = await postJson(runtimeUrl, runtimeReq, 20000);
    if (!r.ok) {
      return res.status(502).json({
        error: "Runtime call failed",
        status: 502,
        detail: r.data || { message: r.error, retryable: false, details: { verb: step.verb } },
        raw: r.raw,
        meta: {
          mode: "runtime-backed",
          runtime_base: RUNTIME_BASE,
          runtime_health,
          runtime_url: runtimeUrl,
          runtime_content_type: r.content_type || null,
          server_time: new Date().toISOString(),
        },
      });
    }

    const receipt = r.data;

    // validate minimal receipt.base shape
    let ok = true;
    let errors = null;
    if (validateReceiptBase) {
      ok = !!validateReceiptBase(receipt);
      if (!ok) errors = validateReceiptBase.errors || null;
    }

    if (!ok) {
      return res.status(500).json({
        error: "Runtime receipt failed receipt.base validation",
        verb: step.verb,
        runtime_url: runtimeUrl,
        details: errors,
        receipt,
        meta: {
          mode: "runtime-backed",
          runtime_base: RUNTIME_BASE,
          runtime_health,
          receipt_base_validated: !!validateReceiptBase,
          ajv_setup_error: ajvSetupError,
          server_time: new Date().toISOString(),
        },
      });
    }

    responseSteps.push({
      index: step.index,
      verb: step.verb,
      runtime_url: runtimeUrl,
      request: runtimeReq,
      curl: [
        `# ${step.verb.toUpperCase()} (real runtime)`,
        buildCurl(runtimeUrl, runtimeReq),
      ].join("\n"),
      validation: { ok: true, errors: null },
      receipt,
    });
  }

  const curlBlock = responseSteps.map((s) => s.curl).join("\n\n") + "\n";

  return res.status(200).json({
    trace_id,
    steps: responseSteps,
    meta: {
      mode: "runtime-backed",
      runtime_base: RUNTIME_BASE,
      runtime_health,
      receipt_base_validated: !!validateReceiptBase,
      ajv_setup_error: ajvSetupError,
      server_time: new Date().toISOString(),
      curl: curlBlock,
    },
  });
};
