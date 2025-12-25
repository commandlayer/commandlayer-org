// /api/verify-receipt.js
// Proxies verification to the runtime: /verify?schema=1&ens=1
// Uses RUNTIME_BASE_URL by default. Optionally accepts runtime_base in body.

async function postJson(url, body, timeoutMs = 12000) {
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
    try { json = JSON.parse(text); } catch { json = null; }

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
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const envBase = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
  const body = req.body || {};
  const runtimeBase = String(body.runtime_base || envBase || "").trim().replace(/\/$/, "");

  if (!runtimeBase) {
    return res.status(500).json({
      ok: false,
      error: "Missing runtime base",
      hint: "Set RUNTIME_BASE_URL on Vercel or pass { runtime_base } in the request body.",
    });
  }

  const receipt = body.receipt;
  if (!receipt || typeof receipt !== "object") {
    return res.status(400).json({ ok: false, error: "Missing receipt object" });
  }

  const url = `${runtimeBase}/verify?schema=1&ens=1`;

  const r = await postJson(url, receipt, 12000);
  if (!r.ok) {
    return res.status(502).json({
      ok: false,
      error: "Runtime verify failed",
      status: r.status,
      detail: r.error,
      data: r.data,
      raw: r.raw,
    });
  }

  return res.status(200).json(r.data);
};
