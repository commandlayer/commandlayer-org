(function (root) {
  'use strict';

  const RECEIPT_ID_RE = /^clrcpt_[a-f0-9]{32}$/i;
  const ENS_RE = /^(?:[a-z0-9-]+\.)+eth$/i;
  const TX_HASH_RE = /^0x[a-f0-9]{64}$/i;

  function normalizeRaw(raw) {
    if (raw == null) return '';
    return typeof raw === 'string' ? raw.trim() : raw;
  }

  function looksLikeClasReceipt(value) {
    const receipt = value && typeof value === 'object' && value.receipt ? value.receipt : value;
    return Boolean(
      receipt &&
      typeof receipt === 'object' &&
      typeof receipt.signer === 'string' &&
      receipt.metadata &&
      receipt.metadata.proof,
    );
  }

  function detect(rawInput) {
    const raw = normalizeRaw(rawInput);
    if (!raw) return { type: 'empty', value: null, label: 'Nothing to verify' };

    if (typeof raw === 'object') {
      if (typeof raw.receipt_id === 'string' && RECEIPT_ID_RE.test(raw.receipt_id.trim())) {
        return { type: 'commandlayer_receipt_id', value: raw.receipt_id.trim(), label: 'CommandLayer receipt ID' };
      }
      if (looksLikeClasReceipt(raw)) {
        return { type: 'clas_receipt', value: raw.receipt || raw, label: 'CLAS receipt' };
      }
      return { type: 'json', value: raw, label: 'JSON evidence' };
    }

    if (RECEIPT_ID_RE.test(raw)) return { type: 'commandlayer_receipt_id', value: raw, label: 'CommandLayer receipt ID' };
    if (ENS_RE.test(raw)) return { type: 'ens_name', value: raw.toLowerCase(), label: 'ENS name' };
    if (TX_HASH_RE.test(raw)) return { type: 'transaction_hash', value: raw, label: 'Transaction hash' };

    try {
      return detect(JSON.parse(raw));
    } catch {
      return { type: 'unknown', value: raw, label: 'Unknown evidence' };
    }
  }

  function unverified(status, type, title, detail, extra) {
    return Object.assign({
      ok: false,
      status,
      evidence_type: type,
      title,
      detail,
      checks: [],
      unproven: [],
    }, extra || {});
  }

  function normalizeClasResult(result) {
    const verified = Boolean(result && result.ok && result.status === 'VERIFIED');
    const checks = [
      { label: 'Receipt hash matches', ok: Boolean(result && result.hash_matches) },
      { label: 'Signature valid', ok: Boolean(result && result.signature_valid) },
      { label: 'ENS signer resolved', ok: Boolean(result && result.ens_resolved) },
    ];
    return {
      ok: verified,
      status: verified ? 'VERIFIED' : 'INVALID',
      evidence_type: 'clas_receipt',
      title: verified ? 'Cryptographic receipt verified' : 'Receipt failed verification',
      detail: result && result.reason ? result.reason : (verified ? 'The covered receipt evidence verified.' : 'The receipt could not be verified.'),
      subject: result && (result.signer || result.receipt_id) ? (result.signer || result.receipt_id) : null,
      checks,
      unproven: ['Verification proves only the fields covered by this receipt; it does not prove unrelated claims or safety.'],
      raw: result,
    };
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !payload.status) {
      throw new Error(`Verification service returned HTTP ${response.status}`);
    }
    return payload;
  }

  async function verify(rawInput) {
    const evidence = detect(rawInput);

    if (evidence.type === 'clas_receipt') {
      const result = await postJson('https://www.commandlayer.org/api/verify', evidence.value);
      return normalizeClasResult(result);
    }

    if (evidence.type === 'commandlayer_receipt_id') {
      const result = await postJson('https://www.commandlayer.org/api/verify-id', { receipt_id: evidence.value });
      const verified = Boolean(result && result.ok && result.status === 'VERIFIED');
      return {
        ok: verified,
        status: verified ? 'VERIFIED' : (result.status === 'RECEIPT_NOT_FOUND' ? 'UNVERIFIABLE' : 'INVALID'),
        evidence_type: 'commandlayer_receipt_id',
        title: verified ? 'Stored receipt verified' : 'Receipt ID not verified',
        detail: result.reason || (verified ? 'Stored receipt was found and its cryptographic proof verified.' : 'The receipt could not be verified.'),
        subject: evidence.value,
        checks: result.verification ? [
          { label: 'Receipt hash matches', ok: Boolean(result.verification.hash_matches) },
          { label: 'Signature valid', ok: Boolean(result.verification.signature_valid) },
          { label: 'ENS signer resolved', ok: Boolean(result.verification.ens_resolved) },
        ] : [],
        unproven: ['A valid receipt does not by itself prove the agent or action was safe, authorized, or commercially successful.'],
        raw: result,
      };
    }

    if (evidence.type === 'ens_name') {
      return unverified(
        'PARTIAL',
        'ens_name',
        'ENS identity recognized',
        'VerifyAgent recognized this as an ENS identity, but the extension does not yet claim that an agent, wallet, or action is bound to it.',
        { subject: evidence.value, unproven: ['Agent binding', 'ERC-8004 registration', 'Action history', 'Wallet authorization'] },
      );
    }

    if (evidence.type === 'transaction_hash') {
      return unverified(
        'PARTIAL',
        'transaction_hash',
        'Transaction hash recognized',
        'The hash is structurally valid. A chain-aware transaction adapter is required before settlement or execution can be proven.',
        { subject: evidence.value, unproven: ['Network/chain', 'Transaction inclusion', 'Finality', 'Agent identity binding'] },
      );
    }

    if (evidence.type === 'json') {
      return unverified(
        'UNVERIFIABLE',
        'json',
        'Unsupported receipt format',
        'This is valid JSON, but VerifyAgent does not have an adapter for this receipt format yet.',
        { unproven: ['Issuer identity', 'Signature', 'Integrity', 'Settlement'] },
      );
    }

    return unverified(
      'UNVERIFIABLE',
      evidence.type,
      'No verifiable evidence detected',
      'VerifyAgent could not identify a supported cryptographic receipt, receipt ID, ENS name, or transaction hash.',
    );
  }

  function scanText(text) {
    const value = String(text || '');
    const receiptIds = [...new Set(value.match(/clrcpt_[a-f0-9]{32}/gi) || [])].slice(0, 20);
    const ensNames = [...new Set(value.match(/\b(?:[a-z0-9-]+\.)+eth\b/gi) || [])].slice(0, 20);
    const txHashes = [...new Set(value.match(/\b0x[a-f0-9]{64}\b/gi) || [])].slice(0, 20);
    return { receiptIds, ensNames, txHashes };
  }

  const api = { detect, verify, scanText, looksLikeClasReceipt };
  root.VerifyAgentAdapters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
