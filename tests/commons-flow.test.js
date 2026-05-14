'use strict';

// commons-flow.test.js
// Tests for the canonical verification helpers that are shared between the
// browser verify UI and the server-side verifyReceipt lib.
// These tests cover the pure functions (canonicalize, canonicalReceiptPayload,
// sha256Hex) without requiring a DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// ── Pure helpers under test (duplicated from browser context to avoid DOM) ──

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;  
}

function canonicalReceiptPayload(receipt) {
  return {
    signer: receipt?.signer,
    verb: receipt?.verb,
    input: receipt?.input,
    output: receipt?.output,
    execution: receipt?.execution,
    ts: receipt?.ts,
  };
}

function sha256HexSync(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ── Tests ──

test('canonicalize: null and primitives round-trip as JSON', () => {
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize(42), '42');
  assert.equal(canonicalize('hello'), '"hello"');
  assert.equal(canonicalize(true), 'true');
});

test('canonicalize: object keys are sorted', () => {
  const result = canonicalize({ z: 1, a: 2 });
  assert.equal(result, '{"a":2,"z":1}');
});

test('canonicalize: nested objects have sorted keys', () => {
  const result = canonicalize({ outer: { z: 9, a: 1 } });
  assert.equal(result, '{"outer":{"a":1,"z":9}}');
});

test('canonicalize: arrays preserve order', () => {
  const result = canonicalize([3, 1, 2]);
  assert.equal(result, '[3,1,2]');
});

test('canonicalize: produces same string for same data regardless of insertion order', () => {
  const a = canonicalize({ b: 1, a: 2 });
  const b = canonicalize({ a: 2, b: 1 });
  assert.equal(a, b);
});

test('canonicalReceiptPayload: extracts only the six canonical fields', () => {
  const receipt = {
    signer: 'runtime.commandlayer.eth',
    verb: 'summarize',
    input: { task: 'x' },
    output: { summary: 'y' },
    execution: { runtime: 'test' },
    ts: '2026-01-01T00:00:00.000Z',
    metadata: { proof: { hash_sha256: 'should-not-appear' } },
    signature: { alg: 'ed25519' },
  };
  const payload = canonicalReceiptPayload(receipt);
  assert.deepEqual(Object.keys(payload).sort(), ['execution', 'input', 'output', 'signer', 'ts', 'verb']);
  assert.equal(payload.signer, 'runtime.commandlayer.eth');
  assert.equal(payload.verb, 'summarize');
  assert.ok(!('metadata' in payload));
  assert.ok(!('signature' in payload));
});

test('sha256 of canonicalized payload matches known sample-receipt hash', () => {
  // These values are taken from examples/sample-receipt.json
  const receipt = {
    signer: 'runtime.commandlayer.eth',
    verb: 'agent.execute',
    ts: '2026-04-29T01:32:57.167Z',
    input: { task: 'summarize', content: 'hello world' },
    output: { summary: 'hello world', tokens_used: 12 },
    execution: { runtime: 'wrapped-agent-demo', run_id: 'run_1777426377167' },
  };
  const expectedHash = '4ff674e92434833a00a8f9aac6941a7962b19bf7472f6d4a184ae54168dfc379';
  const canonical = canonicalize(canonicalReceiptPayload(receipt));
  const hash = sha256HexSync(canonical);
  assert.equal(hash, expectedHash);
});

test('canonicalize: tampering output changes the canonical hash', () => {
  const base = {
    signer: 'runtime.commandlayer.eth',
    verb: 'agent.execute',
    ts: '2026-04-29T01:32:57.167Z',
    input: { task: 'summarize', content: 'hello world' },
    output: { summary: 'hello world', tokens_used: 12 },
    execution: { runtime: 'wrapped-agent-demo', run_id: 'run_1777426377167' },
  };
  const tampered = JSON.parse(JSON.stringify(base));
  tampered.output.summary = 'hello world!!!';

  const hashBase = sha256HexSync(canonicalize(canonicalReceiptPayload(base)));
  const hashTampered = sha256HexSync(canonicalize(canonicalReceiptPayload(tampered)));
  assert.notEqual(hashBase, hashTampered);
});

test('esc: HTML special characters are escaped', () => {
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('"quoted"'), '&quot;quoted&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
