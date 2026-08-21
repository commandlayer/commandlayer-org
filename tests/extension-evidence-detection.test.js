'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adapters = require('../extension/chrome-receipt-inspector/adapters');

test('detects CommandLayer receipt IDs', () => {
  const result = adapters.detect('clrcpt_0123456789abcdef0123456789abcdef');
  assert.equal(result.type, 'commandlayer_receipt_id');
});

test('detects ENS names', () => {
  const result = adapters.detect('verifyagent.eth');
  assert.equal(result.type, 'ens_name');
  assert.equal(result.value, 'verifyagent.eth');
});

test('detects transaction hashes', () => {
  const result = adapters.detect(`0x${'a'.repeat(64)}`);
  assert.equal(result.type, 'transaction_hash');
});

test('detects CLAS receipts', () => {
  const result = adapters.detect({
    signer: 'runtime.commandlayer.eth',
    metadata: { proof: { signature: { alg: 'Ed25519' } } },
  });
  assert.equal(result.type, 'clas_receipt');
});

test('returns unsupported JSON separately from unknown text', () => {
  assert.equal(adapters.detect('{"hello":"world"}').type, 'json');
  assert.equal(adapters.detect('not evidence').type, 'unknown');
});

test('scans page text for receipt IDs, ENS names and tx hashes', () => {
  const tx = `0x${'b'.repeat(64)}`;
  const scan = adapters.scanText(`verifyagent.eth clrcpt_0123456789abcdef0123456789abcdef ${tx}`);
  assert.equal(scan.ensNames[0], 'verifyagent.eth');
  assert.equal(scan.receiptIds[0], 'clrcpt_0123456789abcdef0123456789abcdef');
  assert.equal(scan.txHashes[0], tx);
});
