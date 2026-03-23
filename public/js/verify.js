// CommandLayer Receipt Verifier — verify.js
// commons v1.1.0 · structural + ENS/ERC-8004 checks · Ed25519 hook ready
'use strict';

const COMMONS_ENTRY   = 'https://runtime.commandlayer.org/execute';
const EXPECTED_SIGNER = 'runtime.commandlayer.eth';
const EXPECTED_ALG    = 'ed25519';

const SECTIONS = [
  { key: 'ens',       title: 'ENS Resolution',        desc: 'Resolves the agent ENS name into local CommandLayer ERC-8004 metadata.' },
  { key: 'agentCard', title: 'Agent Card',             desc: 'Confirms verb, version, class, and entry target against the agent card.' },
  { key: 'schema',    title: 'Schema',                 desc: 'Checks that receipt schema URLs are declared in the ERC-8004 record.' },
  { key: 'erc8004',   title: 'ERC-8004 Registration',  desc: 'Verifies the ERC-8004 record is consistent with the expected execution surface.' },
  { key: 'signer',    title: 'Signer Resolution',      desc: 'Compares proof.signer_id against the expected runtime.commandlayer.eth signer.' },
  { key: 'signature', title: 'Receipt Signature',      desc: 'Checks signature material presence. Full Ed25519 crypto requires backend attachment.' },
  { key: 'verdict',   title: 'Final Verdict',          desc: 'Summarises structural consistency across the full trust chain.' },
];

// ── ELEMENT REFS ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  agentSelect:   $('agentSelect'),
  agentMetaPills:$('agentMetaPills'),
  resolveBtn:    $('resolveBtn'),
  receiptInput:  $('receiptInput'),
  verifyBtn:     $('verifyBtn'),
  clearBtn:      $('clearBtn'),
  reportBody:    $('reportBody'),
  modeBadge:     $('modeBadge'),
  techPre:       $('techPre'),
};

// ── FETCH ────────────────────────────────────────────────────────────────────
async function fetchJson(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} — could not load ${path}`);
  return r.json();
}

// ── TRUST PILLS ──────────────────────────────────────────────────────────────
function resetPills() {
  SECTIONS.forEach(s => {
    const el = $(`tp-${s.key}`);
    if (el) el.className = 'trust-pill';
  });
}
function setPill(key, status) {
  const el = $(`tp-${key}`);
  if (el) el.className = `trust-pill ${status}`;
}

// ── ESCAPE HTML ──────────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── BADGE LABEL ──────────────────────────────────────────────────────────────
function badgeLabel(s) {
  return { pass:'Pass', fail:'Fail', warn:'Needs Live Proof', neutral:'Pending' }[s] || 'Pending';
}

// ── RENDER REPORT ─────────────────────────────────────────────────────────────
function renderReport(report, technical, mode) {
  // mode badge
  els.modeBadge.textContent = mode || 'resolved';
  els.modeBadge.className = `mode-badge${mode && mode !== 'idle' ? ' on' : ''}`;

  // trust pills
  resetPills();
  SECTIONS.forEach(s => {
    const sec = report[s.key];
    if (sec?.status) setPill(s.key, sec.status);
  });

  // build cards
  const html = SECTIONS.map(s => {
    const sec = report[s.key] || { status: 'neutral', summary: '', rows: [] };
    const rows = (sec.rows || []).map(r =>
      `<div class="kv-row"><div class="kv-k">${esc(r.key)}</div><div class="kv-v ${r.cls||''}">${esc(r.value)}</div></div>`
    ).join('');

    if (s.key === 'verdict') {
      const icon = { pass:'✓', fail:'✗', warn:'⚠' }[sec.status] || '○';
      return `
        <div class="verdict ${sec.status}">
          <div class="verdict-ico">${icon}</div>
          <div class="verdict-body">
            <h3>${s.title}</h3>
            <p>${esc(sec.summary || s.desc)}</p>
            ${rows ? `<div class="verdict-rows">${rows.replace(/kv-row/g,'kv-row').replace(/kv-k/g,'kv-k').replace(/kv-v/g,'kv-v')}</div>` : ''}
          </div>
        </div>`;
    }

    return `
      <div class="rc ${sec.status}">
        <div class="rc-head">
          <span class="rc-title">${s.title}</span>
          <span class="badge ${sec.status}">${badgeLabel(sec.status)}</span>
        </div>
        <div class="rc-desc">${esc(sec.summary || s.desc)}</div>
        <div class="rc-kv">${rows || '<div class="kv-row"><div class="kv-k">Status</div><div class="kv-v">—</div></div>'}</div>
      </div>`;
  }).join('');

  els.reportBody.innerHTML = html;
  els.techPre.textContent = JSON.stringify(technical, null, 2);
}

// ── LOADING ───────────────────────────────────────────────────────────────────
function renderLoading(msg) {
  els.reportBody.innerHTML = `<div class="loading-row"><span class="spin"></span><span>${esc(msg)}</span></div>`;
}

// ── ERROR REPORT ──────────────────────────────────────────────────────────────
function errorReport(msg) {
  const fail = { status:'fail', summary: msg, rows:[{ key:'Error', value: msg, cls:'red' }] };
  const report = {};
  SECTIONS.forEach(s => { report[s.key] = { ...fail }; });
  renderReport(report, { error: msg }, 'error');
}

// ── RESOLVE AGENT ─────────────────────────────────────────────────────────────
async function resolveAgent(ens) {
  const erc  = await fetchJson(`/erc8004/${ens}.json`);
  let card = null;
  try {
    const cls = erc.commandLayerClass || 'commons';
    card = await fetchJson(`/agent-cards/agents/v1.1.0/${cls}/${ens}.json`);
  } catch (_) {}
  return { ens, erc, card };
}

// ── BUILD AGENT REPORT ────────────────────────────────────────────────────────
function buildAgentReport({ ens, erc, card }) {
  const execSvc    = (erc.services || []).find(s => s.name === 'execution');
  const endpoint   = execSvc?.endpoint || null;
  const entryMatch = endpoint === COMMONS_ENTRY;
  const signerOk   = erc.receiptSigner === EXPECTED_SIGNER;
  const algOk      = (erc.receiptAlgorithm || '').toLowerCase() === EXPECTED_ALG;
  const verbOk     = Boolean(erc.commandLayerVerb);
  const versionOk  = erc.commandLayerVersion === '1.1.0';
  const schOk      = Boolean(erc.schemaReceipt && erc.schemaRequest);

  const cardEntryOk = card ? card.entry === COMMONS_ENTRY : null;
  const cardVerbOk  = card ? (card.implements || []).includes(erc.commandLayerVerb) : null;
  const cardEnsOk   = card ? (card.ens === ens || card.id === ens || card.name === ens) : null;
  const cardStatus  = card ? ((cardEntryOk && cardVerbOk && cardEnsOk) ? 'pass' : 'fail') : 'warn';

  const finalPass = entryMatch && signerOk && algOk && verbOk && versionOk && schOk;

  const report = {
    ens: {
      status: 'pass',
      summary: `Resolved ${ens} from local ERC-8004 registration record.`,
      rows: [
        { key:'ENS Name',  value: erc.ens || ens },
        { key:'Class',     value: erc.commandLayerClass || 'commons', cls:'accent' },
        { key:'Owner',     value: erc.owner || '—' },
        { key:'Registry',  value: erc.type ? 'ERC-8004 v1' : '—' },
      ],
    },
    agentCard: {
      status: cardStatus,
      summary: card
        ? (cardStatus === 'pass' ? 'Agent card matches ENS, verb, and entry target.' : 'Agent card has field mismatches against ERC-8004 record.')
        : 'Agent card not loaded — using ERC-8004 record only.',
      rows: [
        { key:'Verb',          value: erc.commandLayerVerb    || '—' },
        { key:'Version',       value: erc.commandLayerVersion || '—' },
        { key:'Declared Entry',value: endpoint || 'Missing',  cls: entryMatch ? 'green' : 'red' },
        { key:'Expected Entry',value: COMMONS_ENTRY,          cls: 'accent' },
        { key:'Entry Match',   value: entryMatch ? '✓ Yes' : '✗ No', cls: entryMatch ? 'green' : 'red' },
        ...(card ? [
          { key:'Card ENS Match',  value: cardEnsOk  ? '✓ Yes' : '✗ No', cls: cardEnsOk  ? 'green' : 'red' },
          { key:'Card Verb Match', value: cardVerbOk ? '✓ Yes' : '✗ No', cls: cardVerbOk ? 'green' : 'red' },
        ] : [{ key:'Agent Card', value: 'Not loaded' }]),
      ],
    },
    schema: {
      status: schOk ? 'pass' : 'fail',
      summary: schOk
        ? 'Request and receipt schema URLs declared in the ERC-8004 record.'
        : 'One or both schema URLs are missing from the ERC-8004 record.',
      rows: [
        { key:'Request Schema', value: erc.schemaRequest || 'Missing', cls: erc.schemaRequest ? '' : 'red' },
        { key:'Receipt Schema', value: erc.schemaReceipt || 'Missing', cls: erc.schemaReceipt ? '' : 'red' },
        { key:'Agent Card URL', value: erc.agentCard     || '—' },
      ],
    },
    erc8004: {
      status: entryMatch && verbOk && versionOk ? 'pass' : 'fail',
      summary: entryMatch && verbOk && versionOk
        ? `ERC-8004 registration for ${ens} is consistent with the expected execution surface.`
        : 'ERC-8004 registration has field issues — review rows below.',
      rows: [
        { key:'Registered Verb',    value: erc.commandLayerVerb    || 'Missing', cls: verbOk    ? '' : 'red' },
        { key:'Registered Version', value: erc.commandLayerVersion || 'Missing', cls: versionOk ? '' : 'amber' },
        { key:'Execution Endpoint', value: endpoint || 'Missing',                 cls: entryMatch ? 'green' : 'red' },
        { key:'Registration Type',  value: erc.type    || '—' },
        { key:'Website',            value: erc.website || '—' },
      ],
    },
    signer: {
      status: signerOk && algOk ? 'pass' : 'fail',
      summary: signerOk && algOk
        ? `Expected signer ${EXPECTED_SIGNER} confirmed with ${EXPECTED_ALG}.`
        : 'Signer or algorithm does not match expected values.',
      rows: [
        { key:'Receipt Signer',  value: erc.receiptSigner    || 'Missing', cls: signerOk ? 'green' : 'red' },
        { key:'Expected Signer', value: EXPECTED_SIGNER,                   cls: 'accent' },
        { key:'Algorithm',       value: erc.receiptAlgorithm || 'Missing', cls: algOk    ? 'green' : 'amber' },
        { key:'Signer Match',    value: signerOk ? '✓ Yes' : '✗ No',       cls: signerOk ? 'green' : 'red' },
        { key:'Pubkey Source',   value: 'runtime.commandlayer.eth → cl.sig.pub' },
        { key:'Kid Source',      value: 'runtime.commandlayer.eth → cl.sig.kid' },
      ],
    },
    signature: {
      status: 'warn',
      summary: 'No receipt payload provided. Paste a receipt JSON and click Verify Receipt to run structural signature checks.',
      rows: [
        { key:'Status',          value: 'Awaiting receipt JSON' },
        { key:'Canonical Form',  value: 'json.sorted_keys.v1' },
        { key:'Verify Hook',     value: 'POST /api/verify-receipt (future backend)' },
        { key:'Ed25519 Library', value: '@noble/ed25519 — import via esm.sh for full crypto' },
      ],
    },
    verdict: {
      status: finalPass ? 'pass' : 'fail',
      summary: finalPass
        ? `${ens} passes all local structural checks. ENS metadata, ERC-8004, and signer declarations are consistent.`
        : `${ens} failed one or more local structural checks. Review cards above.`,
      rows: [
        { key:'ENS → Entry',  value: entryMatch ? '✓ Pass' : '✗ Fail', cls: entryMatch ? 'green' : 'red' },
        { key:'Signer Match', value: signerOk   ? '✓ Pass' : '✗ Fail', cls: signerOk   ? 'green' : 'red' },
        { key:'Schema URLs',  value: schOk      ? '✓ Pass' : '✗ Fail', cls: schOk      ? 'green' : 'red' },
        { key:'Crypto Proof', value: 'Pending — attach receipt JSON',    cls: 'amber' },
      ],
    },
  };

  return report;
}

// ── PARSE RECEIPT ENVELOPE ────────────────────────────────────────────────────
function parseEnvelope(raw) {
  const body =
    raw?.receipt && typeof raw.receipt === 'object' ? raw.receipt :
    raw?.final_receipt && typeof raw.final_receipt === 'object' ? raw.final_receipt :
    raw;

  const metadata = body?.metadata || raw?.runtime_metadata?.metadata || {};
  const proof =
    body?.metadata?.proof ||
    body?.proof ||
    raw?.runtime_metadata?.proof ||
    raw?.proof ||
    {};
  const agentId = metadata?.agent_id;

  return {
    raw,
    body,
    metadata,
    proof,
    verb: body?.verb || body?.x402?.verb || metadata?.verb || null,
    version: body?.version || body?.schema_version || body?.x402?.version || metadata?.version || null,
    entry: body?.entry || body?.x402?.entry || null,
    ens:
      metadata?.ens ||
      body?.ens ||
      (typeof agentId === 'string' && agentId.endsWith('.eth') ? agentId : null),
    signer: proof?.signer_id || metadata?.signer_id || metadata?.signer || null,
    sigB64: proof?.signature_b64 || proof?.signature || null,
    sigKid: proof?.kid || null,
    hash: proof?.hash_sha256 || null,
  };
}

// ── BUILD RECEIPT REPORT ──────────────────────────────────────────────────────
function buildReceiptReport(env, { ens, erc, card }) {
  const execSvc        = (erc.services || []).find(s => s.name === 'execution');
  const expectedEntry  = execSvc?.endpoint || COMMONS_ENTRY;
  const expectedSigner = erc.receiptSigner || EXPECTED_SIGNER;

  const verbOk     = env.verb    === erc.commandLayerVerb;
  const versionOk  = env.version === erc.commandLayerVersion;
  const entryOk    = env.entry   === expectedEntry;
  const signerOk   = env.signer  === expectedSigner;
  const sigPresent = Boolean(env.sigB64 && env.signer);
  const structOk   = verbOk && versionOk && entryOk && signerOk;

  return {
    ens: {
      status: 'pass',
      summary: `Receipt anchored to ${ens} via resolved ERC-8004 metadata.`,
      rows: [
        { key:'Agent ENS',    value: ens },
        { key:'Receipt ENS',  value: env.ens || '(derived from selection)' },
        { key:'Class',        value: erc.commandLayerClass || 'commons', cls:'accent' },
      ],
    },
    agentCard: {
      status: verbOk && versionOk && entryOk ? 'pass' : 'fail',
      summary: verbOk && versionOk && entryOk
        ? 'Receipt verb, version, and entry match the registered agent card.'
        : 'Receipt verb, version, or entry do not match the registered agent.',
      rows: [
        { key:'Expected Verb',    value: erc.commandLayerVerb    || '—' },
        { key:'Receipt Verb',     value: env.verb    || 'Missing', cls: verbOk    ? 'green' : 'red' },
        { key:'Expected Version', value: erc.commandLayerVersion || '—' },
        { key:'Receipt Version',  value: env.version || 'Missing', cls: versionOk ? 'green' : 'red' },
        { key:'Expected Entry',   value: expectedEntry },
        { key:'Receipt Entry',    value: env.entry   || 'Missing', cls: entryOk   ? 'green' : 'red' },
      ],
    },
    schema: {
      status: erc.schemaReceipt ? 'pass' : 'fail',
      summary: erc.schemaReceipt ? 'Receipt schema URL declared in ERC-8004 record.' : 'Receipt schema URL missing.',
      rows: [
        { key:'Receipt Schema', value: erc.schemaReceipt || 'Missing' },
        { key:'Status Present', value: env.body?.status ? 'Yes' : 'No' },
        { key:'Trace Present',  value: env.body?.trace  ? 'Yes' : 'No' },
      ],
    },
    erc8004: {
      status: verbOk && versionOk ? 'pass' : 'fail',
      summary: verbOk && versionOk
        ? 'ERC-8004 registration is consistent with the receipt verb and version.'
        : 'ERC-8004 registration does not match the receipt verb or version.',
      rows: [
        { key:'Registered Verb',    value: erc.commandLayerVerb    || '—' },
        { key:'Registered Version', value: erc.commandLayerVersion || '—' },
        { key:'Execution Endpoint', value: expectedEntry, cls:'accent' },
        { key:'Verb Match',         value: verbOk    ? '✓ Yes' : '✗ No', cls: verbOk    ? 'green' : 'red' },
        { key:'Version Match',      value: versionOk ? '✓ Yes' : '✗ No', cls: versionOk ? 'green' : 'red' },
      ],
    },
    signer: {
      status: signerOk ? 'pass' : 'fail',
      summary: signerOk
        ? 'proof.signer_id matches the expected runtime.commandlayer.eth signer.'
        : 'proof.signer_id does not match the expected signer.',
      rows: [
        { key:'Expected Signer', value: expectedSigner,          cls:'accent' },
        { key:'proof.signer_id', value: env.signer || 'Missing', cls: signerOk ? 'green' : 'red' },
        { key:'Signer Match',    value: signerOk ? '✓ Yes' : '✗ No', cls: signerOk ? 'green' : 'red' },
        { key:'proof.kid',       value: env.sigKid || '—' },
        { key:'proof.hash',      value: env.hash   || '—' },
      ],
    },
    signature: {
      status: sigPresent ? 'warn' : 'fail',
      summary: sigPresent
        ? 'Signature material is present. Full Ed25519 verification requires backend or pubkey resolver.'
        : 'Receipt is missing proof.signature_b64 or proof.signer_id.',
      rows: [
        { key:'Signature Present', value: env.sigB64 ? 'Yes' : 'No', cls: env.sigB64 ? 'green' : 'red' },
        { key:'Signer Present',    value: env.signer ? 'Yes' : 'No', cls: env.signer ? 'green' : 'red' },
        { key:'Canonical Form',    value: 'json.sorted_keys.v1' },
        { key:'Sig Preview',       value: env.sigB64 ? env.sigB64.slice(0,32)+'…' : '—', cls:'accent' },
        { key:'Verify Hook',       value: 'POST /api/verify-receipt (future backend)' },
      ],
    },
    verdict: {
      status: structOk ? 'warn' : 'fail',
      summary: structOk
        ? 'Receipt is structurally consistent with the resolved trust chain. Full cryptographic proof is pending backend attachment.'
        : 'Receipt is NOT structurally consistent with the resolved CommandLayer trust chain.',
      rows: [
        { key:'Verb Match',    value: verbOk    ? '✓ Pass' : '✗ Fail', cls: verbOk    ? 'green' : 'red' },
        { key:'Version Match', value: versionOk ? '✓ Pass' : '✗ Fail', cls: versionOk ? 'green' : 'red' },
        { key:'Entry Match',   value: entryOk   ? '✓ Pass' : '✗ Fail', cls: entryOk   ? 'green' : 'red' },
        { key:'Signer Match',  value: signerOk  ? '✓ Pass' : '✗ Fail', cls: signerOk  ? 'green' : 'red' },
        { key:'Sig Material',  value: sigPresent ? '✓ Present' : '✗ Missing', cls: sigPresent ? 'green' : 'red' },
        { key:'Crypto Proof',  value: 'Pending — wire @noble/ed25519 to complete', cls:'amber' },
      ],
    },
  };
}

// ── HANDLERS ──────────────────────────────────────────────────────────────────
async function handleResolve() {
  const ens = els.agentSelect.value;
  if (!ens) return;
  els.resolveBtn.disabled = true;
  els.resolveBtn.innerHTML = '<span class="spin"></span> Resolving…';
  renderLoading(`Loading ${ens}…`);
  resetPills();
  try {
    const resolved = await resolveAgent(ens);
    const report   = buildAgentReport(resolved);
    renderReport(report, { mode:'agent-resolution', ens, erc: resolved.erc }, 'agent');
  } catch (e) {
    errorReport(e.message);
  }
  els.resolveBtn.disabled = false;
  els.resolveBtn.textContent = '▶ Resolve Agent';
}

async function handleVerify() {
  const raw = els.receiptInput.value.trim();
  if (!raw) { errorReport('Paste a receipt JSON into the textarea first.'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { errorReport(`Invalid JSON: ${e.message}`); return; }

  els.verifyBtn.disabled = true;
  els.verifyBtn.innerHTML = '<span class="spin"></span> Verifying…';
  renderLoading('Parsing receipt and resolving agent…');
  resetPills();

  const env = parseEnvelope(parsed);
  const ens = (env.ens || els.agentSelect.value || '').trim().toLowerCase();
  if (!ens) {
    errorReport('Cannot determine ENS from receipt — select an agent above or ensure the receipt includes metadata.ens.');
    els.verifyBtn.disabled = false;
    els.verifyBtn.textContent = '▶ Verify Receipt';
    return;
  }

  // sync dropdown
  const opt = [...els.agentSelect.options].find(o => o.value === ens);
  if (opt) els.agentSelect.value = ens;

  try {
    const resolved = await resolveAgent(ens);
    const report   = buildReceiptReport(env, resolved);
    renderReport(report, {
      mode: 'receipt-verification', ens,
      envelope: { verb: env.verb, version: env.version, entry: env.entry, signer: env.signer, sigPresent: Boolean(env.sigB64), kid: env.sigKid, hash: env.hash },
      notes: { cryptoVerification: 'Not executed. Wire @noble/ed25519 + runtime.commandlayer.eth pubkey to complete.', canonicalForm: 'json.sorted_keys.v1' },
    }, 'receipt');
  } catch (e) {
    errorReport(e.message);
  }

  els.verifyBtn.disabled = false;
  els.verifyBtn.textContent = '▶ Verify Receipt';
}

function updateMetaPills(ens) {
  els.agentMetaPills.innerHTML = `
    <span class="mpill commons">commons</span>
    <span class="mpill version">v1.1.0</span>
    <span class="mpill alg">ed25519</span>
  `;
}

// ── WIRE EVENTS ───────────────────────────────────────────────────────────────
els.resolveBtn.addEventListener('click', handleResolve);
els.verifyBtn.addEventListener('click', handleVerify);
els.clearBtn.addEventListener('click', () => { els.receiptInput.value = ''; });
els.agentSelect.addEventListener('change', () => updateMetaPills(els.agentSelect.value));

document.querySelectorAll('[data-quick]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const ens = btn.dataset.quick;
    const opt = [...els.agentSelect.options].find(o => o.value === ens);
    if (opt) els.agentSelect.value = ens;
    updateMetaPills(ens);
    await handleResolve();
  });
});

// auto-resolve on load
handleResolve().catch(e => errorReport(e.message));
