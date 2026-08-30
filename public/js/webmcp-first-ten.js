(() => {
  "use strict";

  const modelContext = document?.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return;

  const state = {
    registered: false,
    tools: [],
  };

  function safeDescription(service) {
    const text = String(service?.service?.description || "Prepare a CommandLayer machine-service quote.").trim();
    return `${text} This browser tool only prepares a quote; it does not spend funds or claim execution occurred.`;
  }

  function toolName(serviceId) {
    return `commandlayer_quote_${serviceId}`;
  }

  async function quote(serviceId, input, signal) {
    const response = await fetch("/api/webmcp/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ service_id: serviceId, input }),
      signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error?.code || `CommandLayer quote HTTP ${response.status}`);
      error.code = payload?.error?.code || "QUOTE_FAILED";
      throw error;
    }
    return {
      service_id: serviceId,
      channel: "webmcp_browser",
      paid_execution: false,
      quote: payload?.quote || payload,
    };
  }

  async function register() {
    if (state.registered) return;
    const response = await fetch("/api/webmcp/catalog", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const catalog = await response.json();
    if (catalog?.schema_version !== "commandlayer.service-catalog.v1" || !Array.isArray(catalog?.services)) return;

    for (const service of catalog.services) {
      const serviceId = String(service?.service?.id || "");
      const inputSchema = service?.contract?.request_schema;
      if (!/^[a-z0-9-]{1,64}$/.test(serviceId) || !inputSchema || typeof inputSchema !== "object") continue;
      const tool = {
        name: toolName(serviceId),
        title: `CommandLayer ${serviceId} — Quote`,
        description: safeDescription(service),
        inputSchema,
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true,
        },
        execute: async (input, client = {}) => quote(serviceId, input, client?.signal),
      };
      await modelContext.registerTool(tool);
      state.tools.push(tool.name);
    }
    state.registered = state.tools.length > 0;
    window.__COMMANDLAYER_WEBMCP__ = Object.freeze({
      schema: "commandlayer.webmcp-browser.v1",
      status: "experimental",
      mode: "quote",
      registered: state.tools.length,
      tools: Object.freeze([...state.tools]),
      counts_as_organic_machine_traction: false,
    });
  }

  register().catch(() => {
    // Progressive enhancement: WebMCP failure must never break the human site.
  });
})();
