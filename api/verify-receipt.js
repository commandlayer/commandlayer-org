// api/verify-receipt.js
// Proxy verifier: forwards receipt to Railway runtime /verify.
// Avoids frontend canonicalization mismatches.
// Default schema=0 so "verify" is cryptographic + hash check only.

module.exports = async function handler(req, res) {
  // CORS (safe for demo pages)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const RUNTIME_BASE = String(process.env.RUNTIME_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");

  if (!RUNTIME_BASE) {
    return res.status(500).json({
      ok: false,
      error: "Missing RUNTIME_BASE_URL on Vercel",
      hint: "Set env var RUNTIME_BASE_URL to your Railway runtime base URL and redeploy.",
    });
  }

  let receipt = req.body;

  // Some runtimes/frameworks pass body as string
  if (typeof receipt === "string") {
    try {
      receipt = JSON.parse(receipt);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON receipt body (string parse failed)" });
    }
  }

  if (!receipt || typeof receipt !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON receipt body" });
  }

  // query flags (safe defaults)
  const ens = String(req.query?.ens || "0") === "1" ? "1" : "0";
  const refresh = String(req.query?.refresh || "0") === "1" ? "1" : "0";

  // IMPORTANT: default schema=0 to avoid false “schema fail” noise
  const schema = String(req.query?.schema || "0") === "1" ? "1" : "0";

  const verifyUrl = `${RUNTIME_BASE}/verify?ens=${ens}&refresh=${refresh}&schema=${schema}`;

  try {
    const upstream = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Non-JSON response from runtime /verify", raw: text };
    }

    return res.status(upstream.status).json({
      ...data,
      meta: {
        proxy: "vercel",
        runtime_verify_url: verifyUrl,
        runtime_status: upstream.status,
      },
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "verify proxy failed",
      detail: e?.message || String(e),
      meta: { runtime_verify_url: verifyUrl },
    });
  }
};
