const statusText = document.getElementById('statusText');
const resultCard = document.getElementById('resultCard');
const verdict = document.getElementById('verdict');
const checksList = document.getElementById('checks');
const rawReceipt = document.getElementById('rawReceipt');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const toggleRawBtn = document.getElementById('toggleRawBtn');

const CHECK_KEYS = ['schema_valid','hash_matched','signature_valid','signer_resolved','signer_matched','trust_verb_identified','trust_verb'];

function getReceiptId() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function setStatus(msg) { statusText.textContent = msg; }
function checkVal(result, key) {
  if (key === 'hash_matched') return result.hash_matched ?? result.hash_matches;
  if (key === 'signer_resolved') return result.signer_resolved ?? result.ens_resolved;
  return result[key];
}

async function run() {
  const receiptId = getReceiptId();
  if (!receiptId || receiptId === 'r') {
    setStatus('Receipt not found');
    return;
  }

  setStatus('loading');
  let receipt;
  try {
    const res = await fetch(`/receipts/${encodeURIComponent(receiptId)}.json`);
    if (!res.ok) {
      setStatus('Receipt not found');
      return;
    }
    receipt = await res.json();
  } catch {
    setStatus('Receipt not found');
    return;
  }

  try {
    const verifyRes = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt }) });
    const payload = await verifyRes.json();
    if (!verifyRes.ok || !payload) {
      setStatus('verification failed');
      return;
    }

    const result = payload.result || payload;
    const isValid = Boolean(result?.valid || result?.ok || result?.verified);
    verdict.innerHTML = `<span class="pill ${isValid ? 'ok' : 'bad'}">${isValid ? 'VERIFIED' : 'INVALID'}</span>`;
    checksList.innerHTML = CHECK_KEYS.map((k) => `<li>${k}: <strong>${String(checkVal(result, k))}</strong></li>`).join('');
    rawReceipt.textContent = JSON.stringify(receipt, null, 2);
    resultCard.hidden = false;
    setStatus(isValid ? 'verification complete' : 'invalid receipt');
  } catch {
    setStatus('verification failed');
  }
}

copyUrlBtn?.addEventListener('click', async () => {
  await navigator.clipboard.writeText(window.location.href);
  copyUrlBtn.textContent = 'Copied';
  setTimeout(() => { copyUrlBtn.textContent = 'Copy verification URL'; }, 1500);
});

toggleRawBtn?.addEventListener('click', () => {
  rawReceipt.hidden = !rawReceipt.hidden;
  toggleRawBtn.textContent = rawReceipt.hidden ? 'View raw receipt' : 'Hide raw receipt';
});

run();
