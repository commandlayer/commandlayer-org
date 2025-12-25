// api/verify-receipt.js
// Proxy verifier: forwards receipt to Railway runtime /verify.
// This avoids frontend canonicalization mismatches.
// Default schema=0 so "verify" is cryptographic + hash check only.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const RUNTIME_BASE = String(process.env.RUNTIME_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");

  if (!RUNTIME_BASE) {
    return res.status(500).json({
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your Railway runtime base URL and redeploy.",
    });
  }

  const receipt = req.body;
  if (!receipt || typeof receipt !== "object") {
    return res.status(400).json({ error: "Invalid JSON receipt body" });
  }

  // query flags (safe defaults)
  const ens = String(req.query.ens || "0") === "1" ? "1" : "0";
  const refresh = String(req.query.refresh || "0") === "1" ? "1" : "0";

  // IMPORTANT: default schema=0 (otherwise you'll see lots of 'schema fail'
  // unless your runtime receipts are *exactly* verb-schema compliant)
  const schema = String(req.query.schema || "0") === "1" ? "1" : "0";

  const url = `${RUNTIME_BASE}/verify?ens=${ens}&refresh=${refresh}&schema=${schema}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Non-JSON response from runtime verify", raw: text };
    }

    return res.status(upstream.status).json({
      ...data,
      meta: {
        proxy: "vercel",
        runtime_verify_url: url,
        runtime_status: upstream.status,
      },
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "verify proxy failed",
      detail: e?.message || String(e),
      meta: { runtime_verify_url: url },
    });
  }
};
