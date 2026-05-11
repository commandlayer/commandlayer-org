'use strict';

(function initVerifyBadge() {
  const BADGE_CLASS = 'cl-verify-badge';

  const STYLE_ID = 'cl-verify-badge-style';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.${BADGE_CLASS}{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#24324a;background:#fff;border:1px solid #d6dee9;border-radius:10px;max-width:320px;padding:10px 12px;font-size:12px;line-height:1.35;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.${BADGE_CLASS} *{box-sizing:border-box}
.${BADGE_CLASS} .clvb-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.${BADGE_CLASS} .clvb-title{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#5a6a83;font-weight:600}
.${BADGE_CLASS} .clvb-status{font-weight:700;font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid #d6dee9;color:#1b2940;background:#f7f9fc}
.${BADGE_CLASS}[data-cl-state="VERIFIED"] .clvb-status{background:#edf9f1;color:#17673e;border-color:#bbe3ca}
.${BADGE_CLASS}[data-cl-state="INVALID"] .clvb-status,.${BADGE_CLASS}[data-cl-state="ERROR"] .clvb-status{background:#fff4f4;color:#8b1f1f;border-color:#f0c8c8}
.${BADGE_CLASS} .clvb-row{display:flex;justify-content:space-between;gap:8px;margin:4px 0}
.${BADGE_CLASS} .clvb-k{color:#6d7b92}
.${BADGE_CLASS} .clvb-v{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:right;word-break:break-all}
.${BADGE_CLASS} .clvb-foot{margin-top:8px;padding-top:8px;border-top:1px solid #e7ecf3}
.${BADGE_CLASS} .clvb-link{font-size:12px;color:#2752d8;text-decoration:underline;text-underline-offset:2px}
.${BADGE_CLASS} .clvb-note{display:block;margin-top:6px;color:#6b7890;font-size:10px;line-height:1.4}
`;
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value ?? '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inferReceiptIdFromUrl(receiptUrl) {
    if (!receiptUrl) return null;
    const withoutQuery = String(receiptUrl).split('#')[0].split('?')[0];
    const name = withoutQuery.split('/').pop();
    if (!name) return null;
    return name.replace(/\.json$/i, '').trim() || null;
  }

  function setState(el, status, rows, linkHref, loadingText) {
    const effectiveStatus = status || 'LOADING';
    el.setAttribute('data-cl-state', effectiveStatus);

    const statusText = loadingText || effectiveStatus;
    const detailRows = rows
      .map(([k, v]) => `<div class="clvb-row"><span class="clvb-k">${esc(k)}</span><span class="clvb-v">${esc(v)}</span></div>`)
      .join('');

    const linkHtml = linkHref
      ? `<a class="clvb-link" href="${esc(linkHref)}">View verification</a>`
      : '';

    el.innerHTML = `
      <div class="clvb-head">
        <span class="clvb-title">VerifyAgent badge</span>
        <span class="clvb-status">${esc(statusText)}</span>
      </div>
      ${detailRows}
      <div class="clvb-foot">
        ${linkHtml}
        <small class="clvb-note">Badge checks are computed from receipt data and VerifyAgent verification results.</small>
      </div>
    `;
  }

  async function verifyBadgeElement(el) {
    const receiptUrl = el.getAttribute('data-cl-receipt-url');
    if (!receiptUrl) {
      setState(el, 'ERROR', [['error', 'Missing data-cl-receipt-url']], null);
      return;
    }

    const receiptId = inferReceiptIdFromUrl(receiptUrl);
    const viewLink = receiptId ? `/verify/r/${encodeURIComponent(receiptId)}` : null;

    setState(el, 'LOADING', [['receipt', receiptUrl]], viewLink, 'Loading...');

    try {
      const receiptResp = await fetch(receiptUrl, { headers: { Accept: 'application/json' } });
      if (!receiptResp.ok) throw new Error(`Receipt fetch failed (${receiptResp.status})`);
      const receipt = await receiptResp.json();

      const verifyResp = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt }),
      });

      const raw = await verifyResp.json();
      const result = raw && typeof raw === 'object' && raw.receipt && raw.status == null ? raw.receipt : raw;

      const status = verifyResp.ok ? (result.status || 'ERROR') : 'ERROR';
      const rows = [
        ['signer', result.signer],
        ['verb', result.trust_verb || result.verb],
        ['schema_valid', result.schema_valid],
        ['hash_matched', result.hash_matched ?? result.hash_matches],
        ['signature_valid', result.signature_valid],
      ];
      setState(el, status, rows, viewLink);
    } catch (error) {
      setState(el, 'ERROR', [['error', error && error.message ? error.message : 'Unexpected error']], viewLink);
    }
  }

  function boot() {
    injectStyles();
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((el) => {
      verifyBadgeElement(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
