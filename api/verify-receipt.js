// /api/verify-receipt.js
// Proxy verifier: forwards receipt to CommandLayer runtime /verify.
// This avoids frontend canonicalization mismatches.
// Default schema=0 so "verify" is cryptographic + hash check only.

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  const RUNTIME_BASE = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
  if (!RUNTIME_BASE) {
    return res.status(500).end(
      JSON.stringify({
        ok: false,
        error: "Missing RUNTIME_BASE_URL on Vercel",
        hint: "Set env var RUNTIME_BASE_URL to your canonical runtime base URL (https://runtime.commandlayer.org).",
      })
    );
  }

  const receipt = req.body;
  if (!receipt || typeof receipt !== "object") {
    return res.status(400).end(JSON.stringify({ ok: false, error: "Invalid JSON receipt body" }));
  }

  const ens = String(req.query.ens || "0") === "1" ? "1" : "0";
  const refresh = String(req.query.refresh || "0") === "1" ? "1" : "0";
  const schema = String(req.query.schema || "0") === "1" ? "1" : "0";

  const url = `${RUNTIME_BASE}/verify?ens=${ens}&refresh=${refresh}&schema=${schema}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
      signal: controller.signal,
    });

    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Non-JSON response from runtime /verify", raw: text };
    }

    return res.status(upstream.status).end(
      JSON.stringify({
        ...data,
        meta: {
          proxy: "vercel",
          runtime: `${RUNTIME_BASE}/verify`,
          verify: { ens, refresh, schema },
          runtime_status: upstream.status,
          runtime_content_type: upstream.headers.get("content-type"),
        },
      })
    );
  } catch (e) {
    return res.status(502).end(
      JSON.stringify({
        ok: false,
        error: "verify proxy failed",
        detail: e?.message || String(e),
        meta: {
          runtime: `${RUNTIME_BASE}/verify`,
          verify: { ens, refresh, schema },
        },
      })
    );
  } finally {
    clearTimeout(t);
  }
};
