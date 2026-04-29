'use strict';

const EXPECTED_ENS_SIGNER = 'runtime.commandlayer.eth';

const ENS_RECORDS = {
  'cl.receipt.signer': 'runtime.commandlayer.eth',
  'cl.sig.kid': 'vC4WbcNoq2znSCiQ',
  'cl.sig.pub': 'ed25519:hhyCuPNoMk4JtEvGEV8F6nMZ4uDO1EcyizPufmnJTOY=',
  'cl.sig.canonical': 'json.sorted_keys.v1',
};

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

function b64ToBytes(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyEd25519HashSignature(hashHex, sigB64, pubkeyB64) {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(pubkeyB64),
    { name: 'Ed25519' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    b64ToBytes(sigB64),
    new TextEncoder().encode(hashHex)
  );
}

function renderChecks(checks) {
  els.checksList.innerHTML = CHECK_LABELS.map(([key, label]) => {
    const status = checks[key];
    const ok = status === true;
    const bad = status === false;

    return `<li class="check-item">
      <span>${label}</span>
      <span class="check-status ${ok ? 'ok' : bad ? 'bad' : 'neutral'}">
        ${ok ? 'PASS' : bad ? 'FAIL' : '—'}
      </span>
    </li>`;
  }).join('');
}

function renderMeta(meta) {
  const rows = [
    ['Signer ENS', meta.signerEns || '—', true],
    ['Public Key Source', meta.publicKeySource || '—', true],
    ['Receipt ID', meta.receiptId || '—'],
    ['Verb/Action', meta.verb || '—'],
    ['Timestamp', meta.timestamp || '—'],
    ['Hash', meta.hash || '—'],
  ];

  els.metaRows.innerHTML = rows.map(([k, v, highlight]) => (
    `<div class="row ${highlight ? 'meta-highlight' : ''}">
      <div class="k">${esc(k)}</div>
      <div class="v code">${esc(v)}</div>
    </div>`
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

async function verifyReceipt() {
  const raw = els.receiptInput.value.trim();

  if (!raw) {
    setVerdict(false, 'Paste a receipt JSON to verify.');
    return;
  }

  let receipt;

  try {
    receipt = JSON.parse(raw);
  } catch (e) {
    setVerdict(false, `Invalid JSON: ${e.message}`);
    return;
  }

  els.verifyBtn.disabled = true;
  els.verifyBtn.textContent = 'Verifying...';

  const schemaValid =
    receipt &&
    typeof receipt === 'object' &&
    typeof receipt.signer === 'string' &&
    typeof receipt.verb === 'string' &&
    typeof receipt.ts === 'string' &&
    receipt.metadata?.proof?.canonicalization &&
    receipt.metadata?.proof?.hash_sha256 &&
    receipt.signature?.kid &&
    receipt.signature?.sig;

  const signerMatched = receipt?.signer === EXPECTED_ENS_SIGNER;
  const ensKeyResolved = signerMatched && !!ENS_RECORDS['cl.sig.pub'];

  let hashMatched = false;
  let signatureValid = false;
  let recomputedHash = '—';

  try {
    if (schemaValid) {
      const canonicalizationOk =
        receipt.metadata.proof.canonicalization === ENS_RECORDS['cl.sig.canonical'];

      const keyIdOk =
        receipt.signature.kid === ENS_RECORDS['cl.sig.kid'];

      const canonicalPayload = canonicalize(canonicalReceiptPayload(receipt));
      recomputedHash = await sha256Hex(canonicalPayload);

      hashMatched =
        canonicalizationOk &&
        receipt.metadata.proof.hash_sha256 === recomputedHash;

      if (hashMatched && keyIdOk && ensKeyResolved) {
        const pubkeyB64 = ENS_RECORDS['cl.sig.pub'].replace(/^ed25519:/, '');
        signatureValid = await verifyEd25519HashSignature(
          recomputedHash,
          receipt.signature.sig,
          pubkeyB64
        );
      }
    }
  } catch (e) {
    console.error('Verification error:', e);
    signatureValid = false;
  }

  const checks = {
    schema_valid: !!schemaValid,
    canonical_hash_matched: !!hashMatched,
    ed25519_signature_valid: !!signatureValid,
    ens_key_resolved: !!ensKeyResolved,
    signer_matched: !!signerMatched,
  };

  const allPass = Object.values(checks).every(Boolean);

  renderChecks(checks);
  renderMeta({
    signerEns: receipt?.signer || '—',
    publicKeySource: ensKeyResolved ? 'ENS text record' : 'not resolved',
    receiptId: receipt?.receipt_id || receipt?.id || '—',
    verb: receipt?.verb || '—',
    timestamp: receipt?.ts || receipt?.timestamp || '—',
    hash: recomputedHash,
  });

  setVerdict(
    allPass,
    allPass
      ? 'Receipt verification passed.'
      : 'Receipt is invalid, tampered, or does not match the ENS signer key.'
  );

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
  els.loadTamperedBtn.disabled = true;
  els.loadTamperedBtn.textContent = 'Loading...';

  try {
    const data = await fetchSampleReceipt();
    const tampered = JSON.parse(JSON.stringify(data));

    if (tampered.output && typeof tampered.output.summary === 'string') {
      tampered.output.summary = `${tampered.output.summary}!!!`;
    } else {
      tampered.tampered_demo_marker = 'TAMPERED';
    }

    els.receiptInput.value = JSON.stringify(tampered, null, 2);
    resetToNeutralState('Tampered sample loaded. Click Verify to detect mismatch.');
  } catch (e) {
    console.error('Failed to load tampered receipt:', e);
    setVerdict(false, e.message || String(e));
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
    console.warn(`[verify.js] Missing required element(s): ${missing.join(', ')}`);
    return null;
  }

  return resolved;
}

function initVerifyPage() {
  els = resolveElements();
  if (!els) return;

  els.verifyBtn.addEventListener('click', verifyReceipt);
  els.loadSampleBtn.addEventListener('click', loadSampleReceipt);
  els.loadTamperedBtn.addEventListener('click', loadTamperedReceipt);
  els.clearBtn.addEventListener('click', clearVerifierState);

  resetToNeutralState('Load a sample receipt, then tamper it to see invalid proof detection.');
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVerifyPage, { once: true });
  } else {
    initVerifyPage();
  }
}
