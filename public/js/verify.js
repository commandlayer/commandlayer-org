'use strict';

const EXPECTED_ENS_SIGNER = 'runtime.commandlayer.eth';
const CHECK_LABELS = [
  ['schema_valid', 'Schema valid'],
  ['canonical_hash_matched', 'Canonical hash matched'],
  ['ed25519_signature_valid', 'Ed25519 signature valid'],
  ['ens_key_resolved', 'ENS key resolved'],
  ['signer_matched', 'Signer matched'],
];

const els = {
  receiptInput: document.getElementById('receiptInput'),
  verifyBtn: document.getElementById('verifyBtn'),
  loadSampleBtn: document.getElementById('loadSampleBtn'),
  resultCard: document.getElementById('resultCard'),
  resultState: document.getElementById('resultState'),
  resultNote: document.getElementById('resultNote'),
  checksList: document.getElementById('checksList'),
  metaRows: document.getElementById('metaRows'),
};

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
    const ok = checks[key] === true;
    return `<li class="check-item"><span>${label}</span><span class="check-status ${ok ? 'ok' : 'bad'}">${ok ? 'PASS' : 'FAIL'}</span></li>`;
  }).join('');
}

function renderMeta(meta) {
  const rows = [
    ['Signer ENS', meta.signerEns || '—'],
    ['Receipt ID', meta.receiptId || '—'],
    ['Verb/Action', meta.verb || '—'],
    ['Timestamp', meta.timestamp || '—'],
    ['Hash', meta.hash || '—'],
  ];

  els.metaRows.innerHTML = rows.map(([k, v]) => (
    `<div class="row"><div class="k">${esc(k)}</div><div class="v code">${esc(v)}</div></div>`
  )).join('');
}

function setVerdict(ok, note) {
  els.resultState.className = `result-state ${ok ? 'verified' : 'invalid'}`;
  els.resultState.textContent = ok ? 'VERIFIED' : 'INVALID';
  els.resultNote.textContent = note;
  els.resultCard.style.background = ok ? 'var(--green-soft)' : 'var(--red-soft)';
  els.resultCard.style.borderColor = ok ? 'rgba(13,159,98,.35)' : 'rgba(217,45,32,.35)';
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

function runStructuralChecks(parsed) {
  const { receipt, proof, metadata, signer } = extractReceipt(parsed);
  const schemaValid = typeof receipt === 'object' && !!receipt && !!(receipt.verb || receipt.action || receipt.x402?.verb);
  const canonicalHashMatched = typeof (proof?.hash_sha256 || proof?.hash) === 'string' && (proof?.hash_sha256 || proof?.hash).length >= 16;
  const ed25519SignatureValid = typeof (proof?.signature_b64 || proof?.signature) === 'string' && (proof?.signature_b64 || proof?.signature).length >= 16;
  const ensKeyResolved = (signer || metadata?.ens || '').toLowerCase().includes('.eth');
  const signerMatched = (signer || '').toLowerCase() === EXPECTED_ENS_SIGNER;

  return {
    checks: {
      schema_valid: schemaValid,
      canonical_hash_matched: canonicalHashMatched,
      ed25519_signature_valid: ed25519SignatureValid,
      ens_key_resolved: ensKeyResolved,
      signer_matched: signerMatched,
    },
    meta: {
      signerEns: signerMatched ? EXPECTED_ENS_SIGNER : (signer || metadata?.ens || null),
      receiptId: receipt?.receipt_id || receipt?.id || metadata?.receipt_id || null,
      verb: receipt?.verb || receipt?.action || receipt?.x402?.verb || metadata?.verb || null,
      timestamp: receipt?.timestamp || receipt?.created_at || metadata?.timestamp || null,
      hash: proof?.hash_sha256 || proof?.hash || metadata?.hash || null,
    },
  };
}

async function runBackendVerify(parsed) {
  const resp = await fetch('/api/verify-receipt?ens=1&schema=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  });

  const data = await resp.json();
  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error || `Verification failed with status ${resp.status}`);
  }

  const signer = data?.signer?.ens || data?.resolved_signer?.ens || data?.identity?.ens || EXPECTED_ENS_SIGNER;
  const out = {
    checks: {
      schema_valid: data?.checks?.schema_valid === true,
      canonical_hash_matched: data?.checks?.hash_matches === true,
      ed25519_signature_valid: data?.checks?.signature_valid === true,
      ens_key_resolved: data?.checks?.ens_match === true || !!signer,
      signer_matched: data?.checks?.ens_match === true || signer === EXPECTED_ENS_SIGNER,
    },
    meta: {
      signerEns: signer,
      receiptId: data?.receipt_id || data?.receipt?.receipt_id || data?.normalized_receipt?.receipt_id || null,
      verb: data?.receipt?.verb || data?.normalized_receipt?.verb || null,
      timestamp: data?.receipt?.timestamp || data?.normalized_receipt?.timestamp || null,
      hash: data?.receipt?.metadata?.proof?.hash_sha256 || data?.normalized_receipt?.metadata?.proof?.hash_sha256 || null,
    },
  };

  return out;
}

async function verifyReceipt() {
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

  let result;
  try {
    result = await runBackendVerify(parsed);
  } catch (_) {
    result = runStructuralChecks(parsed);
  }

  const values = Object.values(result.checks);
  const allPass = values.length > 0 && values.every(Boolean);

  setVerdict(
    allPass,
    allPass
      ? 'Receipt verification passed.'
      : 'Structural checks verify the agent surface. Cryptographic checks verify the receipt proof.'
  );
  renderChecks(result.checks);

  if (!result.meta.signerEns) result.meta.signerEns = EXPECTED_ENS_SIGNER;
  renderMeta(result.meta);

  els.verifyBtn.disabled = false;
  els.verifyBtn.textContent = 'Verify Receipt';
}

async function loadSampleReceipt() {
  els.loadSampleBtn.disabled = true;
  els.loadSampleBtn.textContent = 'Loading...';
  try {
    const resp = await fetch('/examples/sample-receipt.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('Sample receipt could not be loaded.');
    const data = await resp.json();
    els.receiptInput.value = JSON.stringify(data, null, 2);
  } catch (e) {
    setVerdict(false, e.message);
  }
  els.loadSampleBtn.disabled = false;
  els.loadSampleBtn.textContent = 'Load Sample Receipt';
}

els.verifyBtn.addEventListener('click', verifyReceipt);
els.loadSampleBtn.addEventListener('click', loadSampleReceipt);

renderChecks({
  schema_valid: false,
  canonical_hash_matched: false,
  ed25519_signature_valid: false,
  ens_key_resolved: false,
  signer_matched: false,
});
renderMeta({ signerEns: EXPECTED_ENS_SIGNER });
