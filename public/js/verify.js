'use strict';

import { verifyReceipt as verifyReceiptWithAgent } from 'https://cdn.jsdelivr.net/gh/commandlayer/verifyagent@main/src/index.js';

const EXPECTED_ENS_SIGNER = 'runtime.commandlayer.eth';
const CHECK_LABELS = [
  ['schema_valid', '1) Parse receipt schema'],
  ['canonical_hash_matched', '2) Recompute canonical hash'],
  ['ed25519_signature_valid', '3) Verify Ed25519 signature'],
  ['ens_key_resolved', '4) Resolve signer public key from ENS'],
  ['signer_matched', '5) Match signer identity'],
];

const REQUIRED_ELEMENT_IDS = [
  'receiptInput',
  'verifyBtn',
  'loadSampleBtn',
  'loadTamperedBtn',
  'clearBtn',
  'resultCard',
  'resultState',
  'resultNote',
  'checksList',
  'metaRows',
];
let els = null;

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderChecks(checks) {
  els.checksList.innerHTML = CHECK_LABELS.map(([key, label]) => {
    const status = checks[key];
    const ok = status === true;
    const bad = status === false;
    return `<li class="check-item"><span>${label}</span><span class="check-status ${ok ? 'ok' : bad ? 'bad' : 'neutral'}">${ok ? 'PASS' : bad ? 'FAIL' : '—'}</span></li>`;
  }).join('');
}

function renderMeta(meta) {
  const rows = [
    ['Signer ENS', meta.signerEns || '—', true],
    ['Public Key Source', meta.publicKeySource || 'ENS text record', true],
    ['Receipt ID', meta.receiptId || '—'],
    ['Verb/Action', meta.verb || '—'],
    ['Timestamp', meta.timestamp || '—'],
    ['Hash', meta.hash || '—'],
  ];

  els.metaRows.innerHTML = rows.map(([k, v, highlight]) => (
    `<div class="row ${highlight ? 'meta-highlight' : ''}"><div class="k">${esc(k)}</div><div class="v code">${esc(v)}</div></div>`
  )).join('');
}

function setVerdict(ok, note, isIdle = false) {
  if (isIdle) {
    els.resultState.className = 'result-state idle';
    els.resultState.textContent = '—';
    els.resultCard.style.background = '#f9fbff';
    els.resultCard.style.borderColor = 'var(--line)';
    els.resultNote.textContent = note;
    return;
  }
  els.resultState.className = `result-state ${ok ? 'verified' : 'invalid'}`;
  els.resultState.textContent = ok ? 'VERIFIED' : 'INVALID';
  els.resultNote.textContent = note;
  els.resultCard.style.background = ok ? 'var(--green-soft)' : 'var(--red-soft)';
  els.resultCard.style.borderColor = ok ? 'rgba(13,159,98,.35)' : 'rgba(217,45,32,.35)';
}

function resetToNeutralState(note = 'Run verification to see verdict.') {
  renderChecks({
    schema_valid: null,
    canonical_hash_matched: null,
    ed25519_signature_valid: null,
    ens_key_resolved: null,
    signer_matched: null,
  });
  renderMeta({
    signerEns: null,
    publicKeySource: null,
    receiptId: null,
    verb: null,
    timestamp: null,
    hash: null,
  });
  setVerdict(false, note, true);
}

function extractReceipt(raw) {
  const receipt = raw?.receipt && typeof raw.receipt === 'object'
    ? raw.receipt
    : raw?.final_receipt && typeof raw.final_receipt === 'object'
      ? raw.final_receipt
      : raw;

  const proof = receipt?.metadata?.proof || receipt?.proof || raw?.proof || {};
  const metadata = receipt?.metadata || {};

  const verb = receipt?.verb || receipt?.action || receipt?.x402?.verb || metadata?.verb || null;
  const timestamp = receipt?.timestamp || receipt?.created_at || metadata?.timestamp || null;
  const hash = proof?.hash_sha256 || proof?.hash || metadata?.hash || null;
  const signer = proof?.signer_id || metadata?.signer_id || metadata?.signer || null;

  return { receipt, proof, metadata, verb, timestamp, hash, signer };
}

function mapVerifyResult(parsed, result) {
  const { receipt, metadata } = extractReceipt(parsed);
  const signerEns = result?.signerEns || result?.signer?.ens || result?.resolved_signer?.ens || null;
  return {
    checks: {
      schema_valid: result?.schema_valid === true,
      canonical_hash_matched: result?.hash_matched === true,
      ed25519_signature_valid: result?.signature_valid === true,
      ens_key_resolved: Boolean(signerEns),
      signer_matched: typeof signerEns === 'string' && signerEns.toLowerCase() === EXPECTED_ENS_SIGNER,
    },
    meta: {
      signerEns,
      publicKeySource: 'ENS text record',
      receiptId: receipt?.receipt_id || receipt?.id || metadata?.receipt_id || result?.receipt_id || null,
      verb: receipt?.verb || receipt?.action || receipt?.x402?.verb || metadata?.verb || null,
      timestamp: receipt?.timestamp || receipt?.created_at || metadata?.timestamp || null,
      hash: result?.debug?.recomputed_hash_sha256 || null,
    },
  };
}

async function verifyReceiptAction() {
  const raw = els.receiptInput.value.trim();
  if (!raw) {
    setVerdict(false, 'Paste a receipt JSON to verify.');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    setVerdict(false, `Invalid JSON: ${e.message}`);
    return;
  }

  els.verifyBtn.disabled = true;
  els.verifyBtn.textContent = 'Verifying...';

  const verification = await verifyReceiptWithAgent(parsed);
  const result = mapVerifyResult(parsed, verification);

  const values = Object.values(result.checks);
  const allPass = values.length > 0 && values.every(Boolean);

  setVerdict(
    allPass,
    allPass
      ? 'Receipt verification passed.'
      : 'Receipt verification failed: signature and/or canonical hash mismatch.'
  );
  renderChecks(result.checks);

  if (!result.meta.signerEns) result.meta.signerEns = EXPECTED_ENS_SIGNER;
  renderMeta(result.meta);

  els.verifyBtn.disabled = false;
  els.verifyBtn.textContent = 'Verify';
}

async function fetchSampleReceipt() {
  const resp = await fetch('/examples/sample-receipt.json', { cache: 'no-store' });
  if (!resp.ok) throw new Error('Sample receipt could not be loaded.');
  return resp.json();
}

async function loadSampleReceipt() {
  els.loadSampleBtn.disabled = true;
  els.loadSampleBtn.textContent = 'Loading...';
  try {
    const data = await fetchSampleReceipt();
    els.receiptInput.value = JSON.stringify(data, null, 2);
    resetToNeutralState('Sample loaded. Click Verify to validate.');
  } catch (e) {
    setVerdict(false, e.message);
  }
  els.loadSampleBtn.disabled = false;
  els.loadSampleBtn.textContent = 'Load Sample';
}

async function loadTamperedReceipt() {
  console.log('Load Tampered clicked');
  els.loadTamperedBtn.disabled = true;
  els.loadTamperedBtn.textContent = 'Loading...';
  try {
    const data = await fetchSampleReceipt();
    const tampered = JSON.parse(JSON.stringify(data));
    const target = tampered?.receipt && typeof tampered.receipt === 'object'
      ? tampered.receipt
      : tampered?.final_receipt && typeof tampered.final_receipt === 'object'
        ? tampered.final_receipt
        : tampered;

    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error('Sample receipt format is not supported.');
    }

    if (typeof target.verb === 'string') {
      target.verb = `${target.verb}-tampered`;
    } else {
      target.tampered_demo_marker = 'TAMPERED';
    }

    const tamperedJson = JSON.stringify(tampered, null, 2);
    console.log('Assigning tampered receipt to textarea');
    els.receiptInput.value = tamperedJson;
    console.log('Tampered receipt assigned to textarea');

    resetToNeutralState('Tampered sample loaded. Click Verify to detect mismatch.');
  } catch (e) {
    console.error('Failed to load tampered receipt:', e);
    const message = e?.message || String(e);
    els.resultNote.textContent = message;
    setVerdict(false, message);
  }
  els.loadTamperedBtn.disabled = false;
  els.loadTamperedBtn.textContent = 'Load Tampered';
}

function clearVerifierState() {
  els.receiptInput.value = '';
  resetToNeutralState('Run verification to see verdict.');
}

function resolveElements() {
  const missing = [];
  const resolved = {};
  for (const id of REQUIRED_ELEMENT_IDS) {
    resolved[id] = document.getElementById(id);
    if (!resolved[id]) missing.push(id);
  }
  if (missing.length) {
    console.warn(`[verify.js] Missing required element(s): ${missing.join(', ')}. Verify page handlers were not attached.`);
    return null;
  }
  return resolved;
}

function initVerifyPage() {
  els = resolveElements();
  if (!els) return;

  els.verifyBtn.addEventListener('click', verifyReceiptAction);
  els.loadSampleBtn.addEventListener('click', loadSampleReceipt);
  els.loadTamperedBtn.addEventListener('click', loadTamperedReceipt);
  els.clearBtn.addEventListener('click', clearVerifierState);

  resetToNeutralState('Load a sample receipt, then tamper it to see invalid proof detection.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVerifyPage, { once: true });
} else {
  initVerifyPage();
}
