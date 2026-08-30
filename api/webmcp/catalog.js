"use strict";

function factoryBase() {
  const raw = String(process.env.COMMANDLAYER_FACTORY_API_BASE || "https://api.commandlayer.org").trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("COMMANDLAYER_FACTORY_API_BASE must be an absolute URL"); }
  if (parsed.protocol !== "https:") throw new Error("COMMANDLAYER_FACTORY_API_BASE must use HTTPS");
  return parsed.origin;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  if (req.method !== "GET") {
    res.status(405);
    return res.end(JSON.stringify({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }));
  }

  try {
    const upstream = await fetch(`${factoryBase()}/catalog.json`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const text = await upstream.text();
    res.status(upstream.ok ? 200 : 502);
    if (!upstream.ok) {
      return res.end(JSON.stringify({ ok: false, error: { code: "FACTORY_CATALOG_UNAVAILABLE", upstream_status: upstream.status } }));
    }
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error("factory catalog was not valid JSON"); }
    if (payload?.schema_version !== "commandlayer.service-catalog.v1" || !Array.isArray(payload?.services)) {
      throw new Error("factory catalog schema mismatch");
    }
    return res.end(JSON.stringify(payload));
  } catch (error) {
    res.status(502);
    return res.end(JSON.stringify({
      ok: false,
      error: { code: "FACTORY_CATALOG_UNAVAILABLE", message: String(error?.message || "catalog unavailable").slice(0, 240) },
    }));
  }
};
