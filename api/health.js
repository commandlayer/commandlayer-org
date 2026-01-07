// /api/health.js
// Site health aggregator: confirms site is up and can reach the runtime /health.
// Lives in the website repo (Vercel) on purpose.

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  // Normalize runtime base from env (supports: runtime.commandlayer.org OR https://runtime.commandlayer.org)
  let runtimeBase = String(process.env.RUNTIME_BASE_URL || "").trim();

  // strip trailing slashes
  runtimeBase = runtimeBase.replace(/\/+$/, "");

  // add scheme if missing
  if (runtimeBase && !/^https?:\/\//i.test(runtimeBase)) {
    runtimeBase = "https://" + runtimeBase;
  }

  // force https
  runtimeBase = runtimeBase.replace(/^http:\/\//i, "https://");

  if (!runtimeBase) {
    res.status(500);
    return res.end(
      JSON.stringify(
        {
          ok: false,
          site_ok: true,
          runtime_ok: false,
          error: "Missing RUNTIME_BASE_URL",
          hint: "Set env var RUNTIME_BASE_URL to https://runtime.commandlayer.org",
          time: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  const runtimeHealthUrl = runtimeBase + "/health";

  try {
    const r = await fetch(runtimeHealthUrl, { method: "GET" });
    const txt = await r.text().catch(() => "");

    let runtimeHealth = null;
    try {
      runtimeHealth = JSON.parse(txt);
    } catch {
      runtimeHealth = { raw: String(txt || "").slice(0, 2000) };
    }

    const payload = {
      ok: !!r.ok,
      site_ok: true,
      runtime_ok: !!r.ok,
      runtime_status: r.status,
      runtime_base: runtimeBase,
      runtime_health: runtimeHealth,
      time: new Date().toISOString(),
    };

    // If runtime is failing, surface it via status for monitoring.
    res.status(r.ok ? 200 : 502);
    return res.end(JSON.stringify(payload, null, 2));
  } catch (e) {
    const payload = {
      ok: false,
      site_ok: true,
      runtime_ok: false,
      runtime_status: 0,
      runtime_base: runtimeBase,
      runtime_health: null,
      runtime_error: e?.message || String(e),
      time: new Date().toISOString(),
    };

    res.status(502);
    return res.end(JSON.stringify(payload, null, 2));
  }
};
