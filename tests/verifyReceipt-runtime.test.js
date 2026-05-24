'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const { verifyReceipt } = require('../lib/verifyReceipt');

const subtle = webcrypto.subtle;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function canonicalReceiptPayload(receipt) {
  return {
    signer: receipt.signer,
    verb: receipt.verb,
    input: receipt.input,
    output: receipt.output,
    execution: receipt.execution,
    ts: receipt.ts,
  };
}

async function makeRuntimeReceipt() {
  const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = Buffer.from(await subtle.exportKey('raw', keyPair.publicKey)).toString('base64');

  const receipt = {
    signer: 'runtime.commandlayer.eth',
    verb: 'agent.execute',
    ts: '2026-05-20T00:00:00.000Z',
    input: { task: 'verify', content: 'canonical' },
    output: { ok: true },
    execution: { runtime: 'prod', run_id: 'run_1' },
  };
  const canonicalStr = canonicalize(canonicalReceiptPayload(receipt));
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalStr));
  const hashHex = Buffer.from(digest).toString('hex');
  const sigBytes = await subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, new TextEncoder().encode(hashHex));

  receipt.metadata = {
    proof: {
      canonicalization: 'json.sorted_keys.v1',
      hash: { alg: 'SHA-256', value: hashHex },
      signature: { alg: 'Ed25519', kid: 'vC4WbcNoq2znSCiQ', value: Buffer.from(sigBytes).toString('base64') },
      signer_id: 'runtime.commandlayer.eth',
    },
  };

  return { receipt, rawPub };
}


function isSingleProofSignature(signature) {
  return Boolean(signature) && !Array.isArray(signature) && typeof signature === 'object';
}

function isMultiProofSignature(signature) {
  return Array.isArray(signature);
}

function getPrimaryProofSignature(proof) {
  const signature = proof?.signature;
  if (isSingleProofSignature(signature)) return signature;
  if (isMultiProofSignature(signature)) return signature[0] || null;
  return null;
}

function makeTextResolver(pub) {
  return async (_ens, key) => ({
    'cl.sig.pub': `ed25519:${pub}`,
    'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
    'cl.sig.canonical': 'json.sorted_keys.v1',
    'cl.receipt.signer': 'runtime.commandlayer.eth',
  }[key] || null);
}

test('valid runtime-style receipt verifies', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'VERIFIED');
  assert.equal(out.public_key_source, 'ens_txt');
});

test('fails when ENS key is unavailable and fallback is disabled', async () => {
  const { receipt } = await makeRuntimeReceipt();
  const out = await verifyReceipt(receipt, {
    ens: {
      textResolver: async () => null,
      allowLocalFallback: false,
    },
  });

  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ens_key_unavailable');
  assert.equal(out.public_key_source, 'ens_txt');
});

test('allows explicit local fallback for test/demo mode only when enabled', async () => {
  const { receipt } = await makeRuntimeReceipt();
  const out = await verifyReceipt(receipt, {
    ens: {
      textResolver: async () => null,
      allowLocalFallback: true,
    },
  });

  assert.equal(out.status, 'INVALID');
  assert.equal(out.public_key_source, 'local_test_fallback');
  assert.equal(out.reason, 'Receipt is invalid, tampered, or does not match the signer key metadata.');
});


test('fails with key_resolution_failed when ENS resolver throws', async () => {
  const { receipt } = await makeRuntimeReceipt();
  const out = await verifyReceipt(receipt, {
    ens: {
      textResolver: async () => {
        throw new Error('resolver offline');
      },
      allowLocalFallback: false,
    },
  });

  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'key_resolution_failed');
  assert.equal(out.debug.key_resolution_error, 'key_resolution_failed');
  assert.equal(out.public_key_source, 'ens_txt');
});

test('allows env-flag local fallback only when COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK=true', async () => {
  const previous = process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'production';
    process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK = 'false';

    const { receipt } = await makeRuntimeReceipt();
    const withoutFlag = await verifyReceipt(receipt, {
      ens: { textResolver: async () => null },
    });

    assert.equal(withoutFlag.status, 'INVALID');
    assert.equal(withoutFlag.reason, 'ens_key_unavailable');
    assert.equal(withoutFlag.public_key_source, 'ens_txt');

    process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK = 'true';
    const withFlag = await verifyReceipt(receipt, {
      ens: { textResolver: async () => null },
    });

    assert.equal(withFlag.status, 'INVALID');
    assert.equal(withFlag.public_key_source, 'local_test_fallback');
  } finally {
    if (previous === undefined) delete process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK;
    else process.env.COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK = previous;

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('tampered receipt invalidates', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  receipt.output.ok = false;
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'INVALID');
});

test('missing metadata.proof rejects', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  delete receipt.metadata.proof;
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'INVALID');
});

test('wrong canonicalization rejects', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  receipt.metadata.proof.canonicalization = 'json.v1';
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'INVALID');
});

test('wrong kid rejects', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  const primarySignature = getPrimaryProofSignature(receipt.metadata.proof);
  assert.ok(primarySignature);
  primarySignature.kid = 'wrong';
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'INVALID');
});

test('legacy top-level proof does not verify', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  const primarySignature = getPrimaryProofSignature(receipt.metadata.proof);
  assert.ok(primarySignature);
  receipt.signature = { kid: 'vC4WbcNoq2znSCiQ', sig: primarySignature.value };
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'INVALID');
});


test('multi-signature proof shape does not crash runtime verifier', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  const original = receipt.metadata.proof.signature;
  receipt.metadata.proof.signature = [
    { role: 'runtime', ...original },
    { role: 'relayer', alg: 'Ed25519', kid: 'other', value: original.value },
  ];
  assert.equal(isMultiProofSignature(receipt.metadata.proof.signature), true);
  const primarySignature = getPrimaryProofSignature(receipt.metadata.proof);
  assert.ok(primarySignature);
  const out = await verifyReceipt(receipt, { ens: { textResolver: makeTextResolver(rawPub) } });
  assert.equal(out.status, 'INVALID');
});


test('uses configured provider path for ENS TXT resolution when no textResolver injected', async () => {
  const { receipt, rawPub } = await makeRuntimeReceipt();
  const calls = [];
  const provider = {
    async getResolver(name) {
      calls.push(name);
      return {
        async getText(key) {
          return ({
            'cl.sig.pub': `ed25519:${rawPub}`,
            'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
            'cl.sig.canonical': 'json.sorted_keys.v1',
            'cl.receipt.signer': 'runtime.commandlayer.eth',
          })[key] || null;
        },
      };
    },
  };

  const out = await verifyReceipt(receipt, { ens: { provider } });
  assert.equal(out.status, 'VERIFIED');
  assert.equal(calls.length > 0, true);
  assert.equal(out.public_key_source, 'ens_txt');
});
