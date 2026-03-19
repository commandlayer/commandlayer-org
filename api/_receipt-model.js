const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const RUNTIME_ONLY_KEYS = new Set([
  'x402',
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

function normalizeCanonicalReceipt(input) {
  const wrapped = isObject(input) && isObject(input.receipt) ? input : null;
  const source = wrapped ? wrapped.receipt : input;
  if (!isObject(source)) {
    return { receipt: null, runtime_metadata: undefined, source };
  }

  const verb = source.verb || source?.x402?.verb || null;
  const schemaVersion = source.schema_version || source?.x402?.version || null;
  const result = isObject(source.result) ? source.result : {};

  const receipt = compactObject({
    verb,
    schema_version: schemaVersion,
    status: source.status,
    ...(source.status === 'error' && isObject(source.error) ? { error: source.error } : {}),
    ...result,
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([key]) => !RUNTIME_ONLY_KEYS.has(key) && !['verb', 'schema_version', 'status', 'result', 'error'].includes(key)
      )
    ),
  });

  const runtimeMetadata = compactObject({
    ...(wrapped && isObject(wrapped.runtime_metadata) ? wrapped.runtime_metadata : {}),
    ...(isObject(source.x402) ? { x402: source.x402 } : {}),
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
  });

  return {
    receipt,
    runtime_metadata: Object.keys(runtimeMetadata).length ? runtimeMetadata : undefined,
    source,
  };
}

function validateCanonicalReceipt(receipt) {
  if (!isObject(receipt)) {
    return { ok: false, errors: [{ message: 'Canonical receipt must be an object.' }] };
  }

  if (!receipt.verb || !receipt.schema_version || !receipt.status) {
    return {
      ok: false,
      errors: [{ message: 'Canonical receipt must include verb, schema_version, and status.' }],
    };
  }

  const validate = loadCanonicalReceiptSchema(receipt.verb, receipt.schema_version);
  if (!validate) {
    return { ok: true, errors: null, schema_found: false };
  }

  const ok = !!validate(receipt);
  return {
    ok,
    errors: ok ? null : validate.errors || null,
    schema_found: true,
  };
}

function validateRuntimeMetadata(runtimeMetadata) {
  if (runtimeMetadata === undefined) return { ok: true, errors: null };
  if (!isObject(runtimeMetadata)) {
    return { ok: false, errors: [{ message: 'runtime_metadata must be an object when present.' }] };
  }
  return { ok: true, errors: null };
}

module.exports = {
  normalizeCanonicalReceipt,
  validateCanonicalReceipt,
  validateRuntimeMetadata,
};
