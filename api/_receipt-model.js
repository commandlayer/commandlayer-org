const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const CANONICAL_PROOF_ID = 'json.sorted_keys.v1';
const COMMONS_ENTRY = 'https://runtime.commandlayer.org/execute';

const RUNTIME_ONLY_KEYS = new Set([
  'x402',
  'execution',
  'trace',
  'actor',
  'input',
  'payload',
  'metadata',
  'usage',
  'request',
  'response',
  'runtime_metadata',
  'runtime_url',
  'verification',
  'verify',
  'checks',
  'signer',
  'signature',
  'proof',
  'result',
  'receipt',
  'final_receipt',
  'steps',
  'trace_id',
  'class',
  'entry',
]);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validatorCache = new Map();

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(value) {
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function loadCanonicalReceiptSchema(verb, version) {
  if (!verb || !version) return null;
  const cacheKey = `${version}:${verb}`;
  if (validatorCache.has(cacheKey)) return validatorCache.get(cacheKey);

  const schemaPath = path.join(
    process.cwd(),
    'public',
    'schemas',
    `v${version}`,
    'commons',
    verb,
    `${verb}.receipt.schema.json`
  );

  if (!fs.existsSync(schemaPath)) {
    validatorCache.set(cacheKey, null);
    return null;
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);
  validatorCache.set(cacheKey, validate);
  return validate;
}

function unwrapRuntimeReceipt(payload) {
  if (isObject(payload?.final_receipt)) return payload.final_receipt;
  if (isObject(payload?.receipt)) return payload.receipt;
  if (Array.isArray(payload?.steps) && payload.steps.length) {
    const stepReceipt = payload.steps[payload.steps.length - 1]?.receipt;
    if (isObject(stepReceipt)) return stepReceipt;
  }
  return payload;
}

function getWrappedReceiptSource(input) {
  const source = unwrapRuntimeReceipt(input);
  return {
    wrapped: isObject(input) && source !== input ? input : null,
    source,
  };
}

function normalizeCanonicalReceipt(input) {
  const { wrapped, source } = getWrappedReceiptSource(input);
  if (!isObject(source)) {
    return {
      receipt: null,
      runtime_metadata: undefined,
      source,
      wrapped,
      trace_id: null,
      raw_receipt: source,
      unwrapped_receipt: source,
    };
  }

  const verb = source.verb || source?.execution?.verb || null;
  const schemaVersion =
    source.schema_version ||
    source.version ||
    source?.execution?.version ||
    null;
  const status = source.status || null;
  const result = isObject(source.result) ? source.result : {};

  const receipt = compactObject({
    verb,
    schema_version: schemaVersion,
    status,
    ...(source.class ? { class: source.class } : {}),
    ...(source.entry ? { entry: source.entry } : {}),
    ...(source.status === 'error' && isObject(source.error) ? { error: source.error } : {}),
    ...result,
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([key]) => !RUNTIME_ONLY_KEYS.has(key) && !['verb', 'schema_version', 'status', 'error'].includes(key)
      )
    ),
  });

  const runtimeMetadata = compactObject({
    ...(wrapped && isObject(wrapped.runtime_metadata) ? wrapped.runtime_metadata : {}),
    ...(isObject(source.trace) ? { trace: source.trace } : {}),
    ...(isObject(source.metadata) ? { metadata: source.metadata } : {}),
    ...(isObject(source.usage) ? { usage: source.usage } : {}),
    ...(isObject(source.delegation_result) ? { delegation_result: source.delegation_result } : {}),
    ...(source.runtime_url ? { runtime_url: source.runtime_url } : {}),
    ...(source.actor ? { actor: source.actor } : {}),
    ...(source.verify ? { verify: source.verify } : {}),
    ...(source.verification ? { verification: source.verification } : {}),
    ...(source.signature ? { signature: source.signature } : {}),
    ...(source.proof ? { proof: source.proof } : {}),
    ...(wrapped && wrapped.trace_id ? { trace_id: wrapped.trace_id } : {}),
    ...(source.trace_id ? { trace_id: source.trace_id } : {}),
  });

  const traceId = source.trace_id
    || source?.metadata?.trace_id
    || source?.metadata?.proof?.trace_id
    || source?.trace?.trace_id
    || runtimeMetadata.trace_id
    || runtimeMetadata?.trace?.trace_id
    || runtimeMetadata?.metadata?.trace_id
    || runtimeMetadata?.proof?.trace_id
    || null;

  return {
    receipt,
    runtime_metadata: Object.keys(runtimeMetadata).length ? runtimeMetadata : undefined,
    source,
    wrapped,
    trace_id: traceId,
    raw_receipt: source,
    unwrapped_receipt: source,
  };
}

function validateCanonicalReceipt(input, options = {}) {
  const normalized = normalizeCanonicalReceipt(input);
  const receipt = normalized.receipt;

  if (!isObject(receipt)) {
    return { ok: false, errors: [{ message: 'Canonical receipt must be an object.' }], normalized };
  }

  const { allowEntryClass = false, expectedVerb, expectedVersion, expectedClass, expectedEntry } = options;

  if (!receipt.verb || !receipt.schema_version || !receipt.status) {
    return {
      ok: false,
      errors: [{ message: 'Canonical receipt must include verb, schema_version, and status.' }],
      normalized,
    };
  }

  if (allowEntryClass) {
    if (expectedVerb && receipt.verb !== expectedVerb) {
      return { ok: false, errors: [{ message: `Receipt verb mismatch: expected ${expectedVerb}, got ${receipt.verb}.` }], normalized };
    }
    if (expectedVersion && receipt.schema_version !== expectedVersion) {
      return { ok: false, errors: [{ message: `Receipt version mismatch: expected ${expectedVersion}, got ${receipt.schema_version}.` }], normalized };
    }
    if (expectedClass && receipt.class !== expectedClass) {
      return { ok: false, errors: [{ message: `Receipt class mismatch: expected ${expectedClass}, got ${receipt.class || 'missing'}.` }], normalized };
    }
    if (expectedEntry && receipt.entry !== expectedEntry) {
      return { ok: false, errors: [{ message: `Receipt entry mismatch: expected ${expectedEntry}, got ${receipt.entry || 'missing'}.` }], normalized };
    }
  }

  const validate = loadCanonicalReceiptSchema(receipt.verb, receipt.schema_version);
  if (!validate) {
    return { ok: true, errors: null, schema_found: false, normalized };
  }

  const schemaReceipt = { ...receipt };
  if (allowEntryClass) {
    delete schemaReceipt.entry;
    delete schemaReceipt.class;
  }

  const ok = !!validate(schemaReceipt);
  return {
    ok,
    errors: ok ? null : validate.errors || null,
    schema_found: true,
    normalized,
  };
}

function validateRuntimeMetadata(runtimeMetadata, options = {}) {
  if (runtimeMetadata === undefined) return { ok: true, errors: null };
  if (!isObject(runtimeMetadata)) {
    return { ok: false, errors: [{ message: 'runtime_metadata must be an object when present.' }] };
  }

  const { requireProof = false, expectedTraceId } = options;
  const errors = [];
  const proof = isObject(runtimeMetadata.proof)
    ? runtimeMetadata.proof
    : isObject(runtimeMetadata.metadata?.proof)
      ? runtimeMetadata.metadata.proof
      : null;
  const metadata = isObject(runtimeMetadata.metadata) ? runtimeMetadata.metadata : null;
  const traceId = runtimeMetadata.trace_id
    || runtimeMetadata?.trace?.trace_id
    || metadata?.trace_id
    || proof?.trace_id
    || null;

  if (requireProof) {
    if (!proof) {
      errors.push({ message: 'runtime_metadata.proof is required.' });
    } else {
      if (proof.alg !== 'ed25519-sha256') {
        errors.push({ message: `runtime_metadata.proof.alg must be ed25519-sha256 (got ${proof.alg || 'missing'}).` });
      }
      const canonicalId = proof.canonical || proof.canonical_id || null;
      if (canonicalId !== CANONICAL_PROOF_ID) {
        errors.push({ message: `runtime_metadata.proof canonical id must be ${CANONICAL_PROOF_ID} (got ${canonicalId || 'missing'}).` });
      }
    }
  }

  if (expectedTraceId && traceId && traceId !== expectedTraceId) {
    errors.push({ message: `runtime_metadata trace mismatch: expected ${expectedTraceId}, got ${traceId}.` });
  }

  return { ok: errors.length === 0, errors: errors.length ? errors : null };
}

module.exports = {
  CANONICAL_PROOF_ID,
  COMMONS_ENTRY,
  normalizeCanonicalReceipt,
  unwrapRuntimeReceipt,
  validateCanonicalReceipt,
  validateRuntimeMetadata,
};
