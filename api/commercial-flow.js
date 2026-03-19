// /api/commercial-flow.js
// Runtime-backed Commercial flow: forwards steps to Commercial Runtime, returns receipts + per-step curl.
// NOTE: This is orchestration for the demo UI (belongs in website repo).

const crypto = require("crypto");
const { normalizeCanonicalReceipt, validateCanonicalReceipt, validateRuntimeMetadata } = require("./_receipt-model");

const COMMERCIAL_VERBS = ["authorize", "checkout", "purchase", "ship", "verify"];
const VERSION = "1.1.0";

function nowIso() {
  return new Date().toISOString();
}

function makeTraceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function respondNoStore(res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
}

function normalizeBase(url) {
  let s = String(url || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "");
  s = s.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  s = s.replace(/^http:\/\//i, "https://");
  return s;
}

// safer curl: single quotes around JSON, and escape any single quotes inside payload
function shellSingleQuote(str) {
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

function normalizeInput(input) {
  if (input == null) return null;

  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return null;
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return JSON.parse(text); } catch {}
    }
    return { content: text };
  }

  if (typeof input === "object") return input;

  return { content: String(input) };
}

/**
 * IMPORTANT:
 * Commercial request schemas use `payload`, not `input`.
 * Keep UI using step.input, but map to payload on the runtime request.
 */
function buildRuntimeRequest(verb, trace_id, inputObj) {
  return {
    x402: {
      entry: `x402://${verb}agent.eth/${verb}/v${VERSION}`,
      verb,
      version: VERSION,
    },
    actor: "commerce-demo.commandlayer.org",
    trace: { trace_id },
    payload: inputObj, // <-- FIX
  };
}

async function fetchTextWithTimeout(url, { method = "GET", headers = {}, body = null, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "follow" });
    const text = await r.text().catch(() => "");
    const contentType = r.headers.get("content-type") || null;
    return { ok: r.ok, status: r.status, contentType, text };
  } finally {
    clearTimeout(t);
  }
}

function tryParseJson(text) {
  const s = String(text || "").trim();
  if (!s) return { ok: false, value: null };
  try { return { ok: true, value: JSON.parse(s) }; } catch { return { ok: false, value: null }; }
}

async function postJson(url, bodyObj, timeoutMs = 20000) {
  const r = await fetchTextWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
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

async function checkRuntimeHealth(base) {
  const url = base.replace(/\/$/, "") + "/health";
  try {
    const r = await fetchTextWithTimeout(url, { method: "GET", timeoutMs: 8000 });
    const parsed = tryParseJson(r.text);
    return {
      ok: r.ok,
      status: r.status,
      content_type: r.contentType,
      detail: parsed.ok ? parsed.value : { raw: String(r.text || "").slice(0, 400) },
    };
  } catch (e) {
    return { ok: false, status: 0, content_type: null, detail: { error: e?.message || String(e) } };
  }
}

module.exports = async function handler(req, res) {
  respondNoStore(res);

  // Basic CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).end(JSON.stringify({ ok: false, error: "Method not allowed" }, null, 2));
  }

  const COMMERCIAL_BASE = normalizeBase(process.env.COMMERCIAL_RUNTIME_BASE_URL);
  if (!COMMERCIAL_BASE) {
    return res.status(500).end(
      JSON.stringify(
        {
          ok: false,
          error: "Missing COMMERCIAL_RUNTIME_BASE_URL on Vercel",
          hint: "Set COMMERCIAL_RUNTIME_BASE_URL to your commercial runtime base URL (e.g. https://commercial-runtime.commandlayer.org).",
        },
        null,
        2
      )
    );
  }

  const body = req.body || {};
  const incomingSteps = Array.isArray(body.steps) ? body.steps : [];

  const steps = [];
  incomingSteps.forEach((s, idx) => {
    const verb = String(s?.verb || "").trim();
    if (!verb || !COMMERCIAL_VERBS.includes(verb)) return;

    const inputObj = normalizeInput(s?.input);
    if (inputObj == null) return;

    steps.push({ index: idx, verb, input: inputObj });
  });

  if (!steps.length) {
    return res.status(400).end(
      JSON.stringify(
        {
          ok: false,
          error: "No valid steps provided. Each step needs a Commercial verb and non-empty input.",
          expected: {
            steps: [
              { verb: "authorize", input: { checkout_id: "01J...", metadata: { demo: true } } },
              { verb: "checkout", input: { cart_id: "cart_123" } },
            ],
          },
          note: "Orchestrator uses steps[].input, but runtime request field is payload (schema-correct).",
        },
        null,
        2
      )
    );
  }

  const trace_id = body.trace_id ? String(body.trace_id).trim() : makeTraceId();
  const runtime_health = await checkRuntimeHealth(COMMERCIAL_BASE);

  const responseSteps = [];

  for (const step of steps) {
    const runtimeUrl = `${COMMERCIAL_BASE}/${step.verb}/v${VERSION}`;
    const runtimeReq = buildRuntimeRequest(step.verb, trace_id, step.input);

    const r = await postJson(runtimeUrl, runtimeReq, 20000);

    if (!r.ok) {
      return res.status(502).end(
        JSON.stringify(
          {
            ok: false,
            error: "Commercial runtime call failed",
            detail: r.data || { message: r.error, details: { verb: step.verb } },
            raw: r.raw,
            meta: {
              mode: "commercial-runtime-backed",
              runtime_base: COMMERCIAL_BASE,
              runtime_health,
              runtime_url: runtimeUrl,
              runtime_content_type: r.content_type || null,
              server_time: nowIso(),
            },
          },
          null,
          2
        )
      );
    }

    const normalized = normalizeCanonicalReceipt(r.data);
    const receiptValidation = validateCanonicalReceipt(normalized.receipt);
    const runtimeMetadataValidation = validateRuntimeMetadata(normalized.runtime_metadata);

    if (!receiptValidation.ok) {
      return res.status(500).end(JSON.stringify({
        ok: false,
        error: "Commercial runtime receipt failed canonical validation",
        verb: step.verb,
        details: receiptValidation.errors,
        receipt: normalized.receipt,
        raw_response: r.data,
      }, null, 2));
    }

    if (!runtimeMetadataValidation.ok) {
      return res.status(500).end(JSON.stringify({
        ok: false,
        error: "Commercial runtime metadata failed validation",
        verb: step.verb,
        details: runtimeMetadataValidation.errors,
        runtime_metadata: normalized.runtime_metadata,
      }, null, 2));
    }

    responseSteps.push({
      index: step.index,
      verb: step.verb,
      runtime_url: runtimeUrl,
      request: runtimeReq,
      curl: [`# ${step.verb.toUpperCase()} (commercial runtime)`, buildCurl(runtimeUrl, runtimeReq)].join("\n"),
      receipt: normalized.receipt,
      ...(normalized.runtime_metadata ? { runtime_metadata: normalized.runtime_metadata } : {}),
      validation: { canonical_receipt: receiptValidation, runtime_metadata: runtimeMetadataValidation },
    });
  }

  const curlBlock = responseSteps.map((s) => s.curl).join("\n\n") + "\n";

  return res.status(200).end(
    JSON.stringify(
      {
        ok: true,
        trace_id,
        steps: responseSteps,
        meta: {
          mode: "commercial-runtime-backed",
          runtime_base: COMMERCIAL_BASE,
          runtime_health,
          server_time: nowIso(),
          curl: curlBlock,
          receipt_model: "canonical-receipt-plus-optional-runtime-metadata",
        },
      },
      null,
      2
    )
  );
};
