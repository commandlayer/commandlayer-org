const statusText = document.getElementById('statusText');
const resultCard = document.getElementById('resultCard');
const verdict = document.getElementById('verdict');
const checksList = document.getElementById('checks');
const rawReceipt = document.getElementById('rawReceipt');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const toggleRawBtn = document.getElementById('toggleRawBtn');
const receiptIdDisplay = document.getElementById('receiptIdDisplay');

const CHECK_KEYS = [
  'schema_valid',
  'hash_matched',
  'signature_valid',
  'signer_resolved',
  'signer_matched',
  'trust_verb_identified',
  'trust_verb',
];

function getReceiptId() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function setStatus(msg) {
  statusText.textContent = msg;
}

function checkVal(result, key) {
  if (key === 'hash_matched') return result.hash_matched ?? result.hash_matches;
  if (key === 'signer_resolved') return result.signer_resolved ?? result.ens_resolved;
  return result[key];
}

async function run() {
  const receiptId = getReceiptId();
  if (!receiptId || receiptId === 'r') {
    setStatus('error: Receipt not found');
    return;
  }
  receiptIdDisplay.textContent = receiptId;

  setStatus('loading');
  let receipt;
  try {
    const receiptRes = await fetch(`/receipts/${encodeURIComponent(receiptId)}.json`);
    if (receiptRes.status === 404) {
      setStatus('error: Receipt not found');
      return;
    }
    if (!receiptRes.ok) {
      setStatus(`error: Receipt fetch failed (${receiptRes.status})`);
      return;
    }
    receipt = await receiptRes.json();
  } catch (fetchErr) {
    setStatus(`error: ${fetchErr && fetchErr.message ? fetchErr.message : 'Could not load receipt'}`);
    return;
  }

  try {
    const verifyRes = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receipt }),
    });
    const payload = await verifyRes.json();
    const result = payload?.result ?? payload?.verification ?? payload;
    if (!verifyRes.ok || !result || typeof result !== 'object') {
      setStatus(`error: Verification failed (${verifyRes.status})`);
      return;
    }

    const isValid = Boolean(result.ok ?? result.valid ?? result.verified);
    verdict.innerHTML = `<span class="pill ${isValid ? 'ok' : 'bad'}">${isValid ? 'VERIFIED' : 'INVALID'}</span>`;

    checksList.innerHTML = CHECK_KEYS.map((key) => {
      const value = checkVal(result, key);
      const rendered = value === undefined ? 'n/a' : String(value);
      return `<li>${key}: <strong>${rendered}</strong></li>`;
    }).join('');

    rawReceipt.textContent = JSON.stringify(receipt, null, 2);
    resultCard.hidden = false;
    setStatus(isValid ? 'VERIFIED' : 'INVALID');
  } catch (verifyErr) {
    setStatus(`error: ${verifyErr && verifyErr.message ? verifyErr.message : 'Verification request failed'}`);
  }
}

copyUrlBtn?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copyUrlBtn.textContent = 'Copied';
    setTimeout(() => {
      copyUrlBtn.textContent = 'Copy verification URL';
    }, 1500);
  } catch {
    copyUrlBtn.textContent = 'Copy failed';
    setTimeout(() => {
      copyUrlBtn.textContent = 'Copy verification URL';
    }, 1500);
  }
});

toggleRawBtn?.addEventListener('click', () => {
  rawReceipt.hidden = !rawReceipt.hidden;
  toggleRawBtn.textContent = rawReceipt.hidden ? 'View raw receipt' : 'Hide raw receipt';
});

run();
