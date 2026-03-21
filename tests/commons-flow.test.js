const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/commons-flow');
const verifyReceiptHandler = require('../api/verify-receipt');
const {
  COMMONS_ENTRY,
  normalizeCanonicalReceipt,
  unwrapRuntimeReceipt,
  validateCanonicalReceipt,
  validateRuntimeMetadata,
} = require('../api/_receipt-model');

function createRuntimeReceipt({ verb, traceId, result, status = 'success' }) {
  return {
    trace_id: traceId,
    steps: [
      {
        step: 1,
        receipt: {
          verb,
          schema_version: '1.1.0',
          status,
          entry: COMMONS_ENTRY,
          class: 'commons',
          trace_id: traceId,
          result,
          metadata: {
            receipt_id: `rcpt_${verb}_${traceId}`,
            trace_id: traceId,
            proof: {
              alg: 'ed25519-sha256',
              canonical: 'json.sorted_keys.v1',
              signature_b64: 'abc123',
              hash_sha256: `hash-${verb}`,
              trace_id: traceId,
              signer_id: 'runtime.commandlayer.eth',
            },
          },
        },
      },
    ],
    final_receipt: {
      verb,
      schema_version: '1.1.0',
      status,
      entry: COMMONS_ENTRY,
      class: 'commons',
      trace_id: traceId,
      result,
      metadata: {
        receipt_id: `rcpt_${verb}_${traceId}`,
        trace_id: traceId,
        proof: {
          alg: 'ed25519-sha256',
          canonical_id: 'json.sorted_keys.v1',
          signature_b64: 'abc123',
          hash_sha256: `hash-${verb}`,
          trace_id: traceId,
          signer_id: 'runtime.commandlayer.eth',
        },
      },
    },
    receipt: {
      verb,
      schema_version: '1.1.0',
      status,
      entry: COMMONS_ENTRY,
      class: 'commons',
      trace_id: traceId,
      result,
      metadata: {
        receipt_id: `rcpt_${verb}_${traceId}`,
        trace_id: traceId,
        proof: {
          alg: 'ed25519-sha256',
          canonical: 'json.sorted_keys.v1',
          signature_b64: 'abc123',
          hash_sha256: `hash-${verb}`,
          trace_id: traceId,
          signer_id: 'runtime.commandlayer.eth',
        },
      },
    },
    runtime_metadata: {
      trace_id: traceId,
      trace: { trace_id: traceId },
      metadata: {
        receipt_id: `rcpt_${verb}_${traceId}`,
        trace_id: traceId,
      },
      proof: {
        alg: 'ed25519-sha256',
        canonical: 'json.sorted_keys.v1',
        signature_b64: 'abc123',
        hash_sha256: `hash-${verb}`,
        trace_id: traceId,
        signer_id: 'runtime.commandlayer.eth',
      },
    },
  };
}

function createReqRes(body, extras = {}) {
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    body: undefined,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };

  return [{ method: 'POST', body, query: {}, ...extras }, res];
}

test('wrapped runtime response normalizes correctly across final_receipt, receipt, and steps receipt', () => {
  const wrapped = createRuntimeReceipt({
    verb: 'clean',
    traceId: 'trace-wrap-1',
    result: {
      cleaned_content: 'Normalized text',
      operations_applied: ['trim_whitespace'],
    },
  });

  assert.equal(unwrapRuntimeReceipt(wrapped).cleaned_content, undefined);
  assert.equal(unwrapRuntimeReceipt(wrapped).verb, 'clean');
  assert.equal(unwrapRuntimeReceipt({ receipt: wrapped.receipt }).verb, 'clean');
  assert.equal(unwrapRuntimeReceipt({ steps: wrapped.steps }).verb, 'clean');

  const normalized = normalizeCanonicalReceipt(wrapped);
  assert.equal(normalized.receipt.entry, COMMONS_ENTRY);
  assert.equal(normalized.receipt.class, 'commons');
  assert.equal(normalized.receipt.cleaned_content, 'Normalized text');
  assert.equal(normalized.trace_id, 'trace-wrap-1');
});

test('canonical validation passes for wrapped Commons receipt with canonical or canonical_id proof', () => {
  const wrapped = createRuntimeReceipt({
    verb: 'clean',
    traceId: 'trace-wrap-2',
    result: {
      cleaned_content: 'Normalized text',
      operations_applied: ['trim_whitespace'],
    },
  });

  const receiptValidation = validateCanonicalReceipt(wrapped, {
    allowEntryClass: true,
    expectedVerb: 'clean',
    expectedVersion: '1.1.0',
    expectedClass: 'commons',
    expectedEntry: COMMONS_ENTRY,
  });
  assert.equal(receiptValidation.ok, true);

  const metadataValidation = validateRuntimeMetadata(receiptValidation.normalized.runtime_metadata, {
    requireProof: true,
    expectedTraceId: 'trace-wrap-2',
  });
  assert.equal(metadataValidation.ok, true);
});

test('no x402 requirement remains for Commons receipts', () => {
  const wrapped = createRuntimeReceipt({
    verb: 'summarize',
    traceId: 'trace-sum-1',
    result: { summary: 'Short summary' },
  });

  const normalized = normalizeCanonicalReceipt(wrapped);
  assert.equal(normalized.receipt.x402, undefined);

  const receiptValidation = validateCanonicalReceipt(wrapped, {
    allowEntryClass: true,
    expectedVerb: 'summarize',
    expectedVersion: '1.1.0',
    expectedClass: 'commons',
    expectedEntry: COMMONS_ENTRY,
  });
  assert.equal(receiptValidation.ok, true);
});

test('commons-flow uses /execute with canonical execution metadata and preserves receipt fields', async () => {
  process.env.RUNTIME_BASE_URL = 'https://runtime.commandlayer.org';
  const traceId = 'trace-flow-1';
  const calls = [];
  const responses = [
    createRuntimeReceipt({
      verb: 'clean',
      traceId,
      result: {
        cleaned_content: 'Cleaned example',
        operations_applied: ['trim_whitespace'],
      },
    }),
    createRuntimeReceipt({
      verb: 'summarize',
      traceId,
      result: { summary: 'Cleaned example' },
    }),
    createRuntimeReceipt({
      verb: 'classify',
      traceId,
      result: { labels: ['demo'] },
    }),
  ];

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, version: '1.1.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const next = responses.shift();
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const [req, res] = createReqRes({
      version: '1.1.0',
      trace_id: traceId,
      steps: [
        { verb: 'clean', input: { content: ' Messy example ' } },
        { verb: 'summarize', use_previous_result: true },
        { verb: 'classify', use_previous_result: true },
      ],
    });

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.filter((call) => String(call.url).endsWith('/execute')).length, 3);
    assert.equal(calls.some((call) => /\/clean\/v1\.1\.0$/.test(String(call.url))), false);
    assert.equal(res.body.steps.length, 3);

    const postedBodies = calls
      .filter((call) => String(call.url).endsWith('/execute'))
      .map((call) => JSON.parse(call.options.body));

    assert.deepEqual(postedBodies.map((body) => body.execution.entry), [COMMONS_ENTRY, COMMONS_ENTRY, COMMONS_ENTRY]);
    assert.deepEqual(postedBodies.map((body) => body.execution.class), ['commons', 'commons', 'commons']);
    assert.deepEqual(postedBodies.map((body) => body.execution.verb), ['clean', 'summarize', 'classify']);
    assert.deepEqual(postedBodies.map((body) => body.execution.version), ['1.1.0', '1.1.0', '1.1.0']);
    assert.deepEqual(postedBodies[0].input, { content: ' Messy example ' });
    assert.deepEqual(postedBodies[1].input, { content: 'Cleaned example' });
    assert.deepEqual(postedBodies[2].input, { content: 'Cleaned example' });
    assert.equal(postedBodies.every((body) => body.actor === 'composer.commandlayer.org'), true);
    assert.equal(postedBodies.every((body) => body.trace.trace_id === traceId), true);

    assert.equal(res.body.final_receipt.verb, 'classify');
    assert.equal(res.body.receipt.verb, 'classify');
    assert.equal(res.body.final_signed_receipt.final_receipt.verb, 'classify');
    assert.equal(res.body.steps[2].runtime_metadata.proof.alg, 'ed25519-sha256');
    assert.equal(res.body.steps[2].signed_receipt.final_receipt.entry, COMMONS_ENTRY);
    assert.equal(res.body.steps[2].logs, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('verify route accepts wrapped response and bare receipt and forwards bare receipt to runtime /verify', async () => {
  process.env.RUNTIME_BASE_URL = 'https://runtime.commandlayer.org';
  const wrapped = createRuntimeReceipt({
    verb: 'clean',
    traceId: 'trace-verify-1',
    result: { cleaned_content: 'verified text' },
  });

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, checks: { hash_matches: true, signature_valid: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const [wrappedReq, wrappedRes] = createReqRes(wrapped, { query: { schema: '1' } });
    await verifyReceiptHandler(wrappedReq, wrappedRes);
    const wrappedPostedBody = JSON.parse(calls[0].options.body);
    assert.equal(calls[0].url, 'https://runtime.commandlayer.org/verify?ens=0&refresh=0&schema=1');
    assert.equal(wrappedPostedBody.verb, 'clean');
    assert.equal(wrappedPostedBody.entry, COMMONS_ENTRY);
    assert.equal(wrappedPostedBody.class, 'commons');
    assert.equal(wrappedPostedBody.cleaned_content, 'verified text');
    assert.equal(wrappedPostedBody.final_receipt, undefined);

    calls.length = 0;
    const [bareReq, bareRes] = createReqRes(wrapped.receipt, { query: { ens: '1' } });
    await verifyReceiptHandler(bareReq, bareRes);
    const barePostedBody = JSON.parse(calls[0].options.body);
    assert.equal(calls[0].url, 'https://runtime.commandlayer.org/verify?ens=1&refresh=0&schema=0');
    assert.deepEqual(barePostedBody, normalizeCanonicalReceipt(wrapped.receipt).receipt);

    const wrappedResponse = JSON.parse(wrappedRes.body);
    const bareResponse = JSON.parse(bareRes.body);
    assert.equal(wrappedResponse.meta.normalized_receipt_used.entry, COMMONS_ENTRY);
    assert.equal(bareResponse.meta.normalized_receipt_used.entry, COMMONS_ENTRY);
  } finally {
    global.fetch = originalFetch;
  }
});
