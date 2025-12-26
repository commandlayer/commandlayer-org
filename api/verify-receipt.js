// api/verify-receipt.js
// Vercel proxy -> forwards a receipt to Railway runtime /verify
// Use this from the UI so canonicalization/hashing happens in the runtime, not the browser.

module.exports = async function handler(req, res) {
  // Always JSON
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const RUNTIME_BASE = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
  if (!RUNTIME_BASE) {
    return res.status(500).json({
      ok: false,
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your Railway runtime base URL (e.g. https://runtime-production-214f.up.railway.app) and redeploy.",
    });
  }

  const receipt = req.body;
  if (!receipt || typeof receipt !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON receipt body" });
  }

  // flags
  const ens = String(req.query.ens || "0") === "1" ? "1" : "0";
  const refresh = String(req.query.refresh || "0") === "1" ? "1" : "0";
  const schema = String(req.query.schema || "0") === "1" ? "1" : "0";

  const url = `${RUNTIME_BASE}/verify?ens=${ens}&refresh=${refresh}&schema=${schema}`;

  // Hard timeout (keeps UI from “doing nothing” forever)
  const timeoutMs = Number(process.env.VERIFY_PROXY_TIMEOUT_MS || 12000);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  const started = Date.now();

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(receipt),
      signal: ac.signal,
    });

    const text = await upstream.text();
    const latency_ms = Date.now() - started;

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        ok: false,
        error: "Non-JSON response from runtime /verify",
        raw: text,
      };
    }

    return res.status(upstream.status).json({
      ...data,
      meta: {
        proxy: "vercel",
        runtime_verify_url: url,
        runtime_status: upstream.status,
        runtime_content_type: upstream.headers.get("content-type") || null,
        latency_ms,
      },
    });
  } catch (e) {
    const latency_ms = Date.now() - started;
    const aborted = e?.name === "AbortError";

    return res.status(502).json({
      ok: false,
      error: aborted ? "verify proxy timeout" : "verify proxy failed",
      detail: e?.message || String(e),
      meta: {
        runtime_verify_url: url,
        timeout_ms: timeoutMs,
        latency_ms,
      },
    });
  } finally {
    clearTimeout(t);
  }
};
