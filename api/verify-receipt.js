// /api/verify-receipt.js
// Proxy verifier: forwards a receipt to CommandLayer runtime /verify.
// Purpose: avoid frontend canonicalization mismatches and keep verification logic server-side.
// Query params:
//   ens=1     -> resolve signer pubkey via ENS (optional)
//   refresh=1 -> bypass caches (optional)
//   schema=1  -> include schema validation (default 0 = crypto+hash only)

function respondNoStore(res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
}

function normalizeRuntimeBase(url) {
  let s = String(url || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "");
  s = s.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s; // ✅ add scheme if missing
  s = s.replace(/^http:\/\//i, "https://"); // ✅ force https
  return s;
}

function qflag(v, def = "0") {
  const s = String(v ?? def);
  return s === "1" ? "1" : "0";
}

async function fetchTextWithTimeout(url, { method = "GET", headers = {}, body = null, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: "follow",
    });

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
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, value: null };
  }
}

module.exports = async function handler(req, res) {
  respondNoStore(res);

  // Basic CORS (no dependency)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).end(JSON.stringify({ ok: false, error: "Method not allowed" }, null, 2));
  }

  const RUNTIME_BASE = normalizeRuntimeBase(process.env.RUNTIME_BASE_URL);
  if (!RUNTIME_BASE) {
    return res.status(500).end(
      JSON.stringify(
        {
          ok: false,
          error: "Missing RUNTIME_BASE_URL on Vercel",
          hint: "Set env var RUNTIME_BASE_URL to https://runtime.commandlayer.org",
        },
        null,
        2
      )
    );
  }

  const receipt = req.body;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return res.status(400).end(JSON.stringify({ ok: false, error: "Invalid JSON receipt body" }, null, 2));
  }

  const ens = qflag(req.query?.ens, "0");
  const refresh = qflag(req.query?.refresh, "0");
  const schema = qflag(req.query?.schema, "0");

  const verifyUrl = `${RUNTIME_BASE}/verify?ens=${ens}&refresh=${refresh}&schema=${schema}`;

  try {
    const upstream = await fetchTextWithTimeout(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
      timeoutMs: 15000,
    });

    const parsed = tryParseJson(upstream.text);
    const data = parsed.ok
      ? parsed.value
      : { ok: false, error: "Non-JSON response from runtime /verify", raw: String(upstream.text || "").slice(0, 2000) };

    // Preserve upstream status (200/4xx/5xx), but always include meta
    return res.status(upstream.status).end(
      JSON.stringify(
        {
          ...data,
          meta: {
            proxy: "vercel",
            runtime: `${RUNTIME_BASE}/verify`,
            verify: { ens, refresh, schema },
            runtime_status: upstream.status,
            runtime_content_type: upstream.contentType,
          },
        },
        null,
        2
      )
    );
  } catch (e) {
    return res.status(502).end(
      JSON.stringify(
        {
          ok: false,
          error: "verify proxy failed",
          detail: e?.message || String(e),
          meta: {
            proxy: "vercel",
            runtime: `${RUNTIME_BASE}/verify`,
            verify: { ens, refresh, schema },
          },
        },
        null,
        2
      )
    );
  }
};
