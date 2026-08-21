(() => {
  'use strict';

  const evidenceEl = document.getElementById('evidence');
  const verifyButton = document.getElementById('verify');
  const selectionButton = document.getElementById('useSelection');
  const contextBox = document.getElementById('context');
  const contextText = document.getElementById('contextText');
  const useContextButton = document.getElementById('useContext');
  const resultEl = document.getElementById('result');
  const detailsEl = document.getElementById('details');

  let pageContext = null;
  let detectedCandidate = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function stateClass(status) {
    if (status === 'VERIFIED') return 'verified';
    if (status === 'PARTIAL') return 'partial';
    if (status === 'INVALID') return 'invalid';
    return 'unverifiable';
  }

  function render(result) {
    const status = result && result.status ? result.status : 'UNVERIFIABLE';
    resultEl.className = `result ${stateClass(status)}`;
    resultEl.innerHTML = `<div class="status-dot"></div><div><strong>${escapeHtml(status)} — ${escapeHtml(result.title || 'Verification result')}</strong><p>${escapeHtml(result.detail || '')}</p>${result.subject ? `<div class="subject">${escapeHtml(result.subject)}</div>` : ''}</div>`;

    const checks = Array.isArray(result.checks) ? result.checks : [];
    const unproven = Array.isArray(result.unproven) ? result.unproven : [];
    let html = '';
    if (checks.length) {
      html += `<div class="checks">${checks.map((check) => `<div class="check"><span>${escapeHtml(check.label)}</span><span class="${check.ok ? 'yes' : 'no'}">${check.ok ? 'PASS' : 'FAIL'}</span></div>`).join('')}</div>`;
    }
    if (unproven.length) {
      html += `<div class="unproven"><strong>Not proven</strong>${unproven.map(escapeHtml).join(' · ')}</div>`;
    }
    detailsEl.innerHTML = html;
  }

  async function verifyCurrent() {
    const raw = evidenceEl.value.trim();
    if (!raw) {
      render({ status: 'UNVERIFIABLE', title: 'Nothing to verify', detail: 'Paste evidence or use the current page selection.' });
      return;
    }

    verifyButton.classList.add('loading');
    verifyButton.textContent = 'Verifying…';
    try {
      const result = await globalThis.VerifyAgentAdapters.verify(raw);
      render(result);
    } catch (error) {
      render({
        status: 'UNVERIFIABLE',
        title: 'Verification service unavailable',
        detail: error && error.message ? error.message : 'VerifyAgent could not complete the request.',
      });
    } finally {
      verifyButton.classList.remove('loading');
      verifyButton.textContent = 'Verify evidence';
    }
  }

  function chooseDetected(context) {
    if (!context) return null;
    if (context.selection) return context.selection;
    const detected = context.detected || {};
    return (detected.receiptIds && detected.receiptIds[0]) ||
      (detected.ensNames && detected.ensNames[0]) ||
      (detected.txHashes && detected.txHashes[0]) || null;
  }

  function summarizeDetected(context) {
    const d = context && context.detected ? context.detected : {};
    const parts = [];
    if (d.receiptIds && d.receiptIds.length) parts.push(`${d.receiptIds.length} receipt ID${d.receiptIds.length === 1 ? '' : 's'}`);
    if (d.ensNames && d.ensNames.length) parts.push(`${d.ensNames.length} ENS name${d.ensNames.length === 1 ? '' : 's'}`);
    if (d.txHashes && d.txHashes.length) parts.push(`${d.txHashes.length} transaction hash${d.txHashes.length === 1 ? '' : 'es'}`);
    return parts.join(', ');
  }

  async function loadPageContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      pageContext = await chrome.tabs.sendMessage(tab.id, { type: 'VERIFYAGENT_GET_CONTEXT' });
      detectedCandidate = chooseDetected(pageContext);
      const summary = summarizeDetected(pageContext);
      if (pageContext.selection || summary) {
        contextBox.hidden = false;
        contextText.textContent = pageContext.selection
          ? 'Selected text is available on this page.'
          : `Detected on this page: ${summary}.`;
      }
    } catch {
      // Some protected browser pages do not allow content scripts. Paste still works.
    }
  }

  verifyButton.addEventListener('click', verifyCurrent);
  evidenceEl.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') verifyCurrent();
  });

  selectionButton.addEventListener('click', () => {
    if (!pageContext || !pageContext.selection) {
      render({ status: 'UNVERIFIABLE', title: 'No page selection', detail: 'Highlight receipt JSON, a receipt ID, ENS name, or transaction hash on the current page first.' });
      return;
    }
    evidenceEl.value = pageContext.selection;
  });

  useContextButton.addEventListener('click', () => {
    if (detectedCandidate) evidenceEl.value = detectedCandidate;
  });

  loadPageContext();
})();
