#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { signReceipt } = require('../lib/receiptSigning');

const CANONICALIZATION = 'json.sorted_keys.v1';
const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), '.local', 'tenant-proof');
const PRIVATE_KEY_FILE = 'private-key.pkcs8.pem';
const ENS_RECORDS_FILE = 'ens-records.txt';
const IDENTITY_FILE = 'identity.json';
const SIGNED_RECEIPT_FILE = 'signed-approve-receipt.json';

function requireTenantEns(env = process.env) {
  const signer = String(env.TENANT_AGENT_ENS || '').trim();
  if (!signer) {
    throw new Error('TENANT_AGENT_ENS is required, for example TENANT_AGENT_ENS=proof.approveagent.eth');
  }
  if (signer.includes('/') || signer.includes('\\') || signer === '.' || signer === '..') {
    throw new Error('TENANT_AGENT_ENS must be an ENS name, not a path.');
  }
  return signer;
}

function outputDirForSigner(signer, outputRoot = DEFAULT_OUTPUT_ROOT) {
  return path.join(outputRoot, signer);
}

function publicKeyRawBase64FromPrivatePem(privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Private key must be an Ed25519 PKCS#8 PEM key.');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(spkiDer.subarray(-32)).toString('base64');
}

function normalizePemValue(value) {
  return String(value).replace(/\\n/g, '\n').trim();
}

function readExplicitPrivateKey(env = process.env) {
  if (env.TENANT_AGENT_PRIVATE_KEY_PKCS8_PEM) {
    return normalizePemValue(env.TENANT_AGENT_PRIVATE_KEY_PKCS8_PEM);
  }
  if (env.TENANT_AGENT_PRIVATE_KEY_PKCS8_PEM_B64) {
    return Buffer.from(env.TENANT_AGENT_PRIVATE_KEY_PKCS8_PEM_B64, 'base64').toString('utf8').trim();
  }
  if (env.TENANT_AGENT_PRIVATE_KEY_PKCS8_PEM_FILE) {
    return fs.readFileSync(env.TENANT_AGENT_PRIVATE_KEY_PKCS8_PEM_FILE, 'utf8').trim();
  }
  return null;
}

function generateKid() {
  return crypto.randomBytes(12).toString('base64url');
}

function makeEnsRecords({ signer, publicKeyBase64, kid }) {
  return {
    'cl.sig.pub': `ed25519:${publicKeyBase64}`,
    'cl.sig.kid': kid,
    'cl.sig.canonical': CANONICALIZATION,
    'cl.receipt.signer': signer,
  };
}

function formatEnsRecords(records) {
  return [
    `cl.sig.pub=${records['cl.sig.pub']}`,
    `cl.sig.kid=${records['cl.sig.kid']}`,
    `cl.sig.canonical=${records['cl.sig.canonical']}`,
    `cl.receipt.signer=${records['cl.receipt.signer']}`,
  ].join('\n');
}

function makeIdentity({ signer, publicKeyBase64, kid, privateKeyPath }) {
  const records = makeEnsRecords({ signer, publicKeyBase64, kid });
  return {
    signer,
    kid,
    public_key_alg: 'Ed25519',
    public_key_raw_base64: publicKeyBase64,
    canonicalization: CANONICALIZATION,
    private_key_path: privateKeyPath,
    ens_records: records,
  };
}

function generateKeyPackage({ signer = requireTenantEns(), outputRoot = DEFAULT_OUTPUT_ROOT, env = process.env } = {}) {
  let privateKeyPem = readExplicitPrivateKey(env);
  let publicKeyBase64;

  if (privateKeyPem) {
    publicKeyBase64 = publicKeyRawBase64FromPrivatePem(privateKeyPem);
  } else {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    publicKeyBase64 = publicKeyRawBase64FromPrivatePem(privateKeyPem);
  }

  const kid = generateKid();
  const outDir = outputDirForSigner(signer, outputRoot);
  const privateKeyPath = path.join(outDir, PRIVATE_KEY_FILE);
  const ensRecordsPath = path.join(outDir, ENS_RECORDS_FILE);
  const identityPath = path.join(outDir, IDENTITY_FILE);
  const identity = makeIdentity({ signer, publicKeyBase64, kid, privateKeyPath });
  const ensRecordsText = formatEnsRecords(identity.ens_records);

  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(privateKeyPath, privateKeyPem.trimEnd() + '\n', { mode: 0o600 });
  fs.writeFileSync(ensRecordsPath, ensRecordsText + '\n', 'utf8');
  fs.writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');

  return { signer, kid, publicKeyBase64, records: identity.ens_records, outDir, privateKeyPath, ensRecordsPath, identityPath };
}

function makeTenantApproveReceipt(signer, now = new Date()) {
  return {
    signer,
    verb: 'approve',
    input: {
      request_id: 'tenant-proof-001',
      action: 'approve quoted work',
    },
    output: {
      decision: 'approved',
    },
    execution: {
      status: 'ok',
      mode: 'tenant-signed-local-proof',
    },
    ts: now.toISOString(),
  };
}

function assertNoPrivateKeyMaterial(receiptJson) {
  if (/BEGIN PRIVATE KEY|END PRIVATE KEY|PRIVATE KEY/i.test(receiptJson)) {
    throw new Error('Refusing to emit signed receipt: private key material was detected in receipt JSON.');
  }
}

async function signTenantReceipt({ signer = requireTenantEns(), outputRoot = DEFAULT_OUTPUT_ROOT, now = new Date() } = {}) {
  const outDir = outputDirForSigner(signer, outputRoot);
  const privateKeyPath = path.join(outDir, PRIVATE_KEY_FILE);
  const identityPath = path.join(outDir, IDENTITY_FILE);
  const signedReceiptPath = path.join(outDir, SIGNED_RECEIPT_FILE);

  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  if (identity.signer !== signer) {
    throw new Error(`Identity package signer ${identity.signer} does not match TENANT_AGENT_ENS ${signer}.`);
  }

  const unsignedReceipt = makeTenantApproveReceipt(signer, now);
  const signedReceipt = await signReceipt(unsignedReceipt, {
    signerId: signer,
    kid: identity.kid,
    privateKeyPem,
  });

  if (signedReceipt.metadata?.proof?.signature?.role === 'runtime') {
    delete signedReceipt.metadata.proof.signature.role;
  }

  const receiptJson = `${JSON.stringify(signedReceipt, null, 2)}\n`;
  assertNoPrivateKeyMaterial(receiptJson);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(signedReceiptPath, receiptJson, 'utf8');

  return { signer, kid: identity.kid, signedReceipt, signedReceiptPath };
}

function printGenerated(result) {
  console.log(`Signer ENS: ${result.signer}`);
  console.log(`Key ID: ${result.kid}`);
  console.log(`Public key (raw base64): ${result.publicKeyBase64}`);
  console.log('ENS TXT records:');
  console.log(formatEnsRecords(result.records));
  console.log(`Private key written locally: ${result.privateKeyPath}`);
  console.log('Do not publish, upload, or commit the private key. Only publish the four TXT record values above.');
}

function printSigned(result) {
  console.log(JSON.stringify(result.signedReceipt, null, 2));
  console.error(`Signed receipt written locally: ${result.signedReceiptPath}`);
  console.error('No private key material is included in the signed receipt. Do not upload the private key.');
}

async function main(argv = process.argv.slice(2)) {
  const mode = argv[0];
  if (mode === 'generate') {
    printGenerated(generateKeyPackage());
    return;
  }
  if (mode === 'sign') {
    printSigned(await signTenantReceipt());
    return;
  }
  throw new Error('Usage: TENANT_AGENT_ENS=proof.approveagent.eth node scripts/manual-tenant-proof.cjs <generate|sign>');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CANONICALIZATION,
  PRIVATE_KEY_FILE,
  ENS_RECORDS_FILE,
  IDENTITY_FILE,
  SIGNED_RECEIPT_FILE,
  requireTenantEns,
  outputDirForSigner,
  publicKeyRawBase64FromPrivatePem,
  generateKeyPackage,
  signTenantReceipt,
  makeEnsRecords,
  formatEnsRecords,
  makeTenantApproveReceipt,
  assertNoPrivateKeyMaterial,
};
