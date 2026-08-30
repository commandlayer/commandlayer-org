"use strict";

function factoryBase() {
  const raw = String(process.env.COMMANDLAYER_FACTORY_API_BASE || "https://api.commandlayer.org").trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("COMMANDLAYER_FACTORY_API_BASE must be an absolute URL"); }
  if (parsed.protocol !== "https:") throw new Error("COMMANDLAYER_FACTORY_API_BASE must use HTTPS");
  return parsed.origin;
}

function validServiceId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.status(405);
    return res.end(JSON.stringify({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }));
  }

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const serviceId = body.service_id;
  if (!validServiceId(serviceId)) {
    res.status(400);
    return res.end(JSON.stringify({ ok: false, error: { code: "INVALID_SERVICE_ID" } }));
  }
  if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
    res.status(400);
    return res.end(JSON.stringify({ ok: false, error: { code: "INVALID_INPUT" } }));
  }

  try {
    const upstream = await fetch(`${factoryBase()}/v1/services/${encodeURIComponent(serviceId)}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        input: body.input,
        attribution: {
          source: "webmcp_browser",
          organic_eligible: false,
          exclusion_reason: "human_in_loop_browser",
        },
      }),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    if (!text) return res.end(JSON.stringify({ ok: upstream.ok }));
    try {
      JSON.parse(text);
      return res.end(text);
    } catch {
      return res.end(JSON.stringify({ ok: false, error: { code: "FACTORY_QUOTE_INVALID_RESPONSE", upstream_status: upstream.status } }));
    }
  } catch (error) {
    res.status(502);
    return res.end(JSON.stringify({
      ok: false,
      error: { code: "FACTORY_QUOTE_UNAVAILABLE", message: String(error?.message || "quote unavailable").slice(0, 240) },
    }));
  }
};
