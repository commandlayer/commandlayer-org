// /api/commons-flow.js
// Runtime-backed Commons flow: forwards steps to CommandLayer runtime, returns receipts + per-step curl,
// validates minimal receipt.base shape (Ajv).
//
// Patch: step index sequencing is now ALWAYS 0..N-1 in execution order.
// This prevents UI "use previous result" from breaking when steps are skipped.

const crypto = require("crypto");
const { normalizeCanonicalReceipt, validateCanonicalReceipt, validateRuntimeMetadata } = require("./_receipt-model");

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

const DEFAULT_VERSION = "1.1.0";
const SUPPORTED_VERSIONS = new Set(["1.1.0"]);

function nowIso() {
  return new Date().toISOString();
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
  // UI should send input as an object/array already, but support legacy string input:
  // "hello" => { content: "hello" }
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


function pickBestTextFromResult(result) {
  if (!result || typeof result !== "object") return "";

  const candidates = [
    result.summary,
    result.cleaned_content,
    result.formatted_content,
    result.description,
    result.explanation,
    result.converted_content,
    result.body_preview,
    result.analysis,
    result.content,
  ].filter(Boolean).map(String);

  if (candidates.length) return candidates[0];

  if (Array.isArray(result.items) && result.items[0] && result.items[0].body_preview) {
    return String(result.items[0].body_preview);
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function normalizeRuntimeBase(url) {
  // You want canonical runtime.commandlayer.org
  // - trim, remove trailing slash
  // - force https
  let s = String(url || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "");
  s = s.replace(/\/+$/, "");
  s = s.replace(/^http:\/\//i, "https://");
  return s;
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

function buildRuntimeRequest(verb, trace_id, inputObj, version) {
  return {
    x402: {
      entry: `x402://${verb}agent.eth/${verb}/v${version}`,
      verb,
      version,
    },
    actor: "composer.commandlayer.org",
    trace: { trace_id },
    input: inputObj,
  };
}

async function fetchTextWithTimeout(
  url,
  { method = "GET", headers = {}, body = null, timeoutMs = 20000 } = {}
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await res.text().catch(() => "");
    const contentType = res.headers.get("content-type") || null;

    return { ok: res.ok, status: res.status, contentType, text };
  } finally {
    clearTimeout(t);
  }
}

function tryParseJson(text) {
  const s = String(text || "").trim();
  if (!s) return { ok: false, value: null };
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, value: null };
  }
}

async function postJson(url, bodyObj, timeoutMs = 20000) {
  const payload = JSON.stringify(bodyObj);

  const r = await fetchTextWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    timeoutMs,
  });

  const parsed = tryParseJson(r.text);
  const data = parsed.ok ? parsed.value : null;

  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      content_type: r.contentType,
      error: (data && (data.error || data.message)) || r.text || `HTTP ${r.status}`,
      data,
      raw: parsed.ok ? null : r.text,
    };
  }

  return { ok: true, status: r.status, content_type: r.contentType, data: data ?? r.text };
}

async function checkRuntimeHealth(runtimeBase) {
  const url = runtimeBase.replace(/\/$/, "") + "/health";

  try {
    const r = await fetchTextWithTimeout(url, { method: "GET", timeoutMs: 8000 });

    const parsed = tryParseJson(r.text);
    const detail = parsed.ok ? parsed.value : { raw: String(r.text || "").slice(0, 400) };

    return {
      ok: r.ok,
      status: r.status,
      content_type: r.contentType,
      detail, // IMPORTANT: object, not string
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      content_type: null,
      detail: { error: e?.message || String(e) },
    };
  }
}

function respondNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
}

module.exports = async function handler(req, res) {
  respondNoStore(res);
  applyCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Read env at request-time (avoids “baked empty string”)
  const RUNTIME_BASE = normalizeRuntimeBase(process.env.RUNTIME_BASE_URL);

  if (!RUNTIME_BASE) {
    return res.status(500).json({
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your canonical runtime base URL (https://runtime.commandlayer.org).",
    });
  }

  const body = req.body || {};
  const incomingSteps = Array.isArray(body.steps) ? body.steps : [];
  const requestedVersion = String(body.version || DEFAULT_VERSION).trim();
  const version = SUPPORTED_VERSIONS.has(requestedVersion) ? requestedVersion : DEFAULT_VERSION;

  // Sequenced indices: 0..N-1 in actual execution order (after filtering invalid steps)
  const steps = [];
  for (const s of incomingSteps) {
    const verb = String(s?.verb || "").trim();
    if (!verb || !COMMON_VERBS.includes(verb)) continue;

    const use_previous_result = !!s?.use_previous_result;
    const inputObj = normalizeInput(s?.input);
    if (inputObj == null && !use_previous_result) continue;

    steps.push({ index: steps.length, verb, input: inputObj, use_previous_result });
  }

  if (!steps.length) {
    return res.status(400).json({
      error: "No valid steps provided. Each step needs a Commons verb and non-empty input (string or JSON).",
      expected: {
        version: DEFAULT_VERSION,
        steps: [
          { verb: "summarize", input: { content: "hello" } },
          { verb: "convert", input: { content: "hi", source_format: "text", target_format: "markdown" } },
        ],
      },
      supported_versions: Array.from(SUPPORTED_VERSIONS),
    });
  }

  const trace_id = body.trace_id ? String(body.trace_id).trim() : makeTraceId();
  const runtime_health = await checkRuntimeHealth(RUNTIME_BASE);
  const responseSteps = [];

  for (const step of steps) {
    const runtimeUrl = `${RUNTIME_BASE}/${step.verb}/v${version}`;
    let stepInput = step.input;

    if (step.use_previous_result) {
      const previousReceipt = responseSteps[responseSteps.length - 1]?.receipt;
      const previousText = pickBestTextFromResult(previousReceipt).trim();
      if (!previousText) {
        return res.status(400).json({
          error: "Previous step result unavailable for chained input",
          detail: { verb: step.verb, index: step.index },
          meta: {
            mode: "runtime-backed",
            runtime_base: RUNTIME_BASE,
            commons_default_version: DEFAULT_VERSION,
            requested_version: requestedVersion,
            resolved_version: version,
            supported_versions: Array.from(SUPPORTED_VERSIONS),
            runtime_health,
            server_time: nowIso(),
          },
        });
      }
      stepInput = { content: previousText };
    }

    const runtimeReq = buildRuntimeRequest(step.verb, trace_id, stepInput, version);
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
          commons_default_version: DEFAULT_VERSION,
          requested_version: requestedVersion,
          resolved_version: version,
          supported_versions: Array.from(SUPPORTED_VERSIONS),
          runtime_health,
          runtime_url: runtimeUrl,
          runtime_content_type: r.content_type || null,
          server_time: nowIso(),
        },
      });
    }

    const normalized = normalizeCanonicalReceipt(r.data);
    const receiptValidation = validateCanonicalReceipt(normalized.receipt);
    const runtimeMetadataValidation = validateRuntimeMetadata(normalized.runtime_metadata);

    if (!receiptValidation.ok) {
      return res.status(500).json({
        error: "Runtime receipt failed canonical validation",
        verb: step.verb,
        runtime_url: runtimeUrl,
        version,
        details: receiptValidation.errors,
        receipt: normalized.receipt,
        raw_response: r.data,
        meta: {
          mode: "runtime-backed",
          runtime_base: RUNTIME_BASE,
          commons_default_version: DEFAULT_VERSION,
          requested_version: requestedVersion,
          resolved_version: version,
          supported_versions: Array.from(SUPPORTED_VERSIONS),
          runtime_health,
          receipt_schema_found: receiptValidation.schema_found !== false,
          server_time: nowIso(),
        },
      });
    }

    if (!runtimeMetadataValidation.ok) {
      return res.status(500).json({
        error: "Runtime metadata failed validation",
        verb: step.verb,
        runtime_url: runtimeUrl,
        version,
        details: runtimeMetadataValidation.errors,
        runtime_metadata: normalized.runtime_metadata,
      });
    }

    responseSteps.push({
      index: step.index,
      verb: step.verb,
      runtime_url: runtimeUrl,
      version,
      request: runtimeReq,
      curl: [`# ${step.verb.toUpperCase()} (real runtime)`, buildCurl(runtimeUrl, runtimeReq)].join("\n"),
      validation: {
        ok: true,
        errors: null,
        canonical_receipt: receiptValidation,
        runtime_metadata: runtimeMetadataValidation,
      },
      receipt: normalized.receipt,
      ...(normalized.runtime_metadata ? { runtime_metadata: normalized.runtime_metadata } : {}),
    });
  }

  const curlBlock = responseSteps.map((s) => s.curl).join("\n\n") + "\n";

  return res.status(200).json({
    trace_id,
    steps: responseSteps,
    meta: {
      mode: "runtime-backed",
      runtime_base: RUNTIME_BASE,
      commons_default_version: DEFAULT_VERSION,
      requested_version: requestedVersion,
      resolved_version: version,
      supported_versions: Array.from(SUPPORTED_VERSIONS),
      runtime_health,
      receipt_model: "canonical-receipt-plus-optional-runtime-metadata",
      server_time: nowIso(),
      curl: curlBlock,
    },
  });
};
