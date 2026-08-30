"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const catalogHandler = require("../api/webmcp/catalog.js");
const quoteHandler = require("../api/webmcp/quote.js");

function responseHarness() {
  const state = { status: 200, headers: {}, body: "" };
  return {
    state,
    res: {
      setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
      status(code) { state.status = code; return this; },
      end(body = "") { state.body = String(body); return this; },
    },
  };
}

function sampleCatalog() {
  return {
    schema_version: "commandlayer.service-catalog.v1",
    generated_from: "canonical_first_ten_registry",
    services: [
      {
        service: { id: "researchagent", description: "Research a bounded question." },
        contract: { request_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
      },
      {
        service: { id: "parseagent", description: "Parse supplied content." },
        contract: { request_schema: { type: "object", properties: { content: {} }, required: ["content"] } },
      },
    ],
  };
}

test("WebMCP catalog bridge returns only a canonical factory catalog", async () => {
  const originalFetch = global.fetch;
  const originalBase = process.env.COMMANDLAYER_FACTORY_API_BASE;
  process.env.COMMANDLAYER_FACTORY_API_BASE = "https://factory.example";
  let requested;
  global.fetch = async (url, options) => {
    requested = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify(sampleCatalog()) };
  };
  try {
    const { state, res } = responseHarness();
    await catalogHandler({ method: "GET" }, res);
    assert.equal(state.status, 200);
    assert.equal(requested.url, "https://factory.example/catalog.json");
    const payload = JSON.parse(state.body);
    assert.equal(payload.schema_version, "commandlayer.service-catalog.v1");
    assert.equal(payload.services.length, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.COMMANDLAYER_FACTORY_API_BASE;
    else process.env.COMMANDLAYER_FACTORY_API_BASE = originalBase;
  }
});

test("WebMCP quote bridge injects non-organic browser attribution and never accepts a client payment payload", async () => {
  const originalFetch = global.fetch;
  const originalBase = process.env.COMMANDLAYER_FACTORY_API_BASE;
  process.env.COMMANDLAYER_FACTORY_API_BASE = "https://factory.example";
  let requested;
  global.fetch = async (url, options) => {
    requested = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ quote: { quote_id: "q-web-1", amount: "0.05", currency: "USD" } }),
    };
  };
  try {
    const { state, res } = responseHarness();
    await quoteHandler({
      method: "POST",
      body: {
        service_id: "parseagent",
        input: { content: "{}" },
        payment: { secret: "must-not-forward" },
        attribution: { organic_eligible: true },
      },
    }, res);
    assert.equal(state.status, 200);
    assert.equal(requested.url, "https://factory.example/v1/services/parseagent/quote");
    const forwarded = JSON.parse(requested.options.body);
    assert.deepEqual(forwarded, {
      input: { content: "{}" },
      attribution: {
        source: "webmcp_browser",
        organic_eligible: false,
        exclusion_reason: "human_in_loop_browser",
      },
    });
    assert.equal(JSON.stringify(forwarded).includes("must-not-forward"), false);
  } finally {
    global.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.COMMANDLAYER_FACTORY_API_BASE;
    else process.env.COMMANDLAYER_FACTORY_API_BASE = originalBase;
  }
});

test("WebMCP browser bootstrap dynamically registers catalog tools and remains quote-only", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "webmcp-first-ten.js"), "utf8");
  const registered = [];
  const requests = [];
  const catalog = sampleCatalog();
  const context = {
    document: {
      modelContext: {
        async registerTool(tool) { registered.push(tool); },
      },
    },
    window: {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === "/api/webmcp/catalog") {
        return { ok: true, status: 200, json: async () => catalog };
      }
      if (url === "/api/webmcp/quote") {
        return { ok: true, status: 200, json: async () => ({ quote: { quote_id: "q-browser-1" } }) };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(registered.length, 2);
  assert.deepEqual(registered.map((tool) => tool.name), ["commandlayer_quote_researchagent", "commandlayer_quote_parseagent"]);
  assert.equal(registered.every((tool) => tool.annotations.readOnlyHint === true), true);
  assert.equal(context.window.__COMMANDLAYER_WEBMCP__.mode, "quote");
  assert.equal(context.window.__COMMANDLAYER_WEBMCP__.counts_as_organic_machine_traction, false);

  const parse = registered.find((tool) => tool.name === "commandlayer_quote_parseagent");
  const result = await parse.execute({ content: "{}" }, { signal: "browser-abort-signal" });
  assert.equal(result.paid_execution, false);
  assert.equal(result.quote.quote_id, "q-browser-1");
  const quoteRequest = requests.find((request) => request.url === "/api/webmcp/quote");
  assert.equal(quoteRequest.options.signal, "browser-abort-signal");
  assert.deepEqual(JSON.parse(quoteRequest.options.body), { service_id: "parseagent", input: { content: "{}" } });
});

test("WebMCP bootstrap is a progressive no-op when the browser API is unavailable", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "webmcp-first-ten.js"), "utf8");
  let fetched = false;
  const context = {
    document: {},
    window: {},
    fetch: async () => { fetched = true; throw new Error("should not fetch"); },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetched, false);
});
