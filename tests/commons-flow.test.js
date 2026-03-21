const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/commons-flow');
const {
  COMMONS_ENTRY,
  normalizeCanonicalReceipt,
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

function createReqRes(body) {
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

  return [{ method: 'POST', body }, res];
}

test('wrapped Commons runtime responses normalize and validate', () => {
  const wrapped = createRuntimeReceipt({
    verb: 'clean',
    traceId: 'trace-wrap-1',
    result: {
      cleaned_content: 'Normalized text',
      operations_applied: ['trim_whitespace'],
    },
  });

  const normalized = normalizeCanonicalReceipt(wrapped);
  assert.equal(normalized.receipt.entry, COMMONS_ENTRY);
  assert.equal(normalized.receipt.class, 'commons');
  assert.equal(normalized.receipt.cleaned_content, 'Normalized text');
  assert.equal(normalized.trace_id, 'trace-wrap-1');

  const receiptValidation = validateCanonicalReceipt(normalized.receipt, {
    allowEntryClass: true,
    expectedVerb: 'clean',
    expectedVersion: '1.1.0',
    expectedClass: 'commons',
    expectedEntry: COMMONS_ENTRY,
  });
  assert.equal(receiptValidation.ok, true);

  const metadataValidation = validateRuntimeMetadata(normalized.runtime_metadata, {
    requireProof: true,
    expectedTraceId: 'trace-wrap-1',
  });
  assert.equal(metadataValidation.ok, true);
});

test('legacy x402 Commons receipt assumptions are not required', () => {
  const wrapped = createRuntimeReceipt({
    verb: 'summarize',
    traceId: 'trace-sum-1',
    result: { summary: 'Short summary' },
  });

  const normalized = normalizeCanonicalReceipt(wrapped);
  assert.equal(normalized.receipt.x402, undefined);

  const receiptValidation = validateCanonicalReceipt(normalized.receipt, {
    allowEntryClass: true,
    expectedVerb: 'summarize',
    expectedVersion: '1.1.0',
    expectedClass: 'commons',
    expectedEntry: COMMONS_ENTRY,
  });
  assert.equal(receiptValidation.ok, true);
});

test('Commons flow posts each step to /execute with canonical execution metadata and preserves UI receipt fields', async () => {
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
  } finally {
    global.fetch = originalFetch;
  }
});
