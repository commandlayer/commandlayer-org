'use strict';

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

function renderChecks(result) {
  const checks = [
    ['Status', result.status],
    ['Hash Matches', result.hash_matches],
    ['Signature Valid', result.signature_valid],
    ['ENS Resolved', result.ens_resolved],
  ];

  els.checksList.innerHTML = checks.map(([label, value]) => {
    const ok = value === true || value === 'VERIFIED';
    const bad = value === false || value === 'INVALID';
    const display = value == null ? '—' : String(value);
    return `<li class="check-item"><span>${esc(label)}</span><span class="check-status ${ok ? 'ok' : bad ? 'bad' : 'neutral'}">${esc(display)}</span></li>`;
  }).join('');
}

function renderMeta(result) {
  const rows = [
    ['status', result.status],
    ['hash_matches', result.hash_matches],
    ['signature_valid', result.signature_valid],
    ['ens_resolved', result.ens_resolved],
    ['signer', result.signer],
    ['verb', result.verb],
    ['key_id', result.key_id],
  ];

  els.metaRows.innerHTML = rows.map(([k, v]) => (
    `<div class="row"><div class="k">${esc(k)}</div><div class="v code">${esc(v == null ? '—' : String(v))}</div></div>`
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
  renderChecks({ status: null, hash_matches: null, signature_valid: null, ens_resolved: null });
  renderMeta({ status: null, hash_matches: null, signature_valid: null, ens_resolved: null, signer: null, verb: null, key_id: null });
  setVerdict(false, note, true);
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

  let result;
  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    result = await response.json();
    if (!response.ok) {
      throw new Error(result?.reason || 'Verification request failed.');
    }
  } catch (e) {
    console.error('Verification failed:', e);
    setVerdict(false, e?.message || 'Verification failed.');
    els.verifyBtn.disabled = false;
    els.verifyBtn.textContent = 'Verify';
    return;
  }

  const verified = result?.status === 'VERIFIED';
  setVerdict(verified, result?.reason || (verified ? 'Receipt verification passed.' : 'Receipt verification failed.'));
  renderChecks(result || {});
  renderMeta(result || {});

  els.verifyBtn.disabled = false;
  els.verifyBtn.textContent = 'Verify';
}

async function fetchSampleReceipt() {
  const resp = await fetch(`/examples/sample-receipt.json?v=${Date.now()}`);
  if (!resp.ok) throw new Error('Sample receipt could not be loaded.');
  return resp.json();
}

async function loadSampleReceipt() {
  els.loadSampleBtn.disabled = true;
  els.loadSampleBtn.textContent = 'Loading...';
  try {
    const data = await fetchSampleReceipt();
    els.receiptInput.value = JSON.stringify(data, null, 2);
    resetToNeutralState('Sample loaded. Click Verify to validate via /api/verify.');
  } catch (e) {
    setVerdict(false, e.message);
  }
  els.loadSampleBtn.disabled = false;
  els.loadSampleBtn.textContent = 'Load Sample';
}

async function loadTamperedReceipt() {
  els.loadTamperedBtn.disabled = true;
  els.loadTamperedBtn.textContent = 'Loading...';
  try {
    const data = await fetchSampleReceipt();
    const tampered = JSON.parse(JSON.stringify(data));

    if (typeof tampered?.output?.summary !== 'string') {
      throw new Error('Sample receipt is missing output.summary string.');
    }

    tampered.output.summary = `${tampered.output.summary}!!!`;
    els.receiptInput.value = JSON.stringify(tampered, null, 2);
    resetToNeutralState('Tampered sample loaded. Click Verify to validate via /api/verify.');
  } catch (e) {
    const message = e?.message || String(e);
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

  resetToNeutralState('Load a sample receipt, then tamper it to see invalid proof detection via /api/verify.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVerifyPage, { once: true });
} else {
  initVerifyPage();
}
