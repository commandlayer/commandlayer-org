// /api/health.js
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const runtimeBase = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
  if (!runtimeBase) {
    return res.status(500).end(JSON.stringify({
      ok: false,
      site_ok: true,
      error: "Missing RUNTIME_BASE_URL",
      time: new Date().toISOString()
    }));
  }

  try {
    const r = await fetch(runtimeBase + "/health", { method: "GET" });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { json = { raw: txt }; }

    return res.status(200).end(JSON.stringify({
      ok: true,
      site_ok: true,
      runtime_ok: r.ok,
      runtime_base: runtimeBase,
      runtime_health: json,
      time: new Date().toISOString()
    }));
  } catch (e) {
    return res.status(200).end(JSON.stringify({
      ok: true,
      site_ok: true,
      runtime_ok: false,
      runtime_base: runtimeBase,
      runtime_health: null,
      runtime_error: e?.message || String(e),
      time: new Date().toISOString()
    }));
  }
};
