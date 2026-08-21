(() => {
  'use strict';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'VERIFYAGENT_GET_CONTEXT') return false;

    const selection = String(window.getSelection ? window.getSelection() : '').trim().slice(0, 200000);
    const pageText = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 500000);
    const detected = globalThis.VerifyAgentAdapters
      ? globalThis.VerifyAgentAdapters.scanText(pageText)
      : { receiptIds: [], ensNames: [], txHashes: [] };

    sendResponse({ selection, detected, url: location.href, title: document.title });
    return false;
  });
})();
