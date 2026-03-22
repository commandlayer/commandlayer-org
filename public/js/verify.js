const reportDefinitions = [
  {
    key: 'ens',
    title: 'ENS Resolution',
    description: 'Resolves the requested agent identity into local CommandLayer metadata bindings and checks that an agent card exists for the declared class/version.',
  },
  {
    key: 'agentCard',
    title: 'Agent Card',
    description: 'Confirms the resolved card matches the ENS name, verb implementation, class split, version, and expected CommandLayer entry target.',
  },
  {
    key: 'schema',
    title: 'Schema',
    description: 'Checks that the linked receipt schema exists and that the receipt verb/version align with the card metadata.',
  },
  {
    key: 'erc8004',
    title: 'ERC-8004 Registration',
    description: 'Verifies a local ERC-8004 registration record exists and stays consistent with the agent card and routing metadata.',
  },
  {
    key: 'signer',
    title: 'Signer Resolution',
    description: 'Compares the receipt proof signer against the ERC-8004 receipt signer and highlights the expected trust anchor.',
  },
  {
    key: 'signature',
    title: 'Receipt Signature',
    description: 'Performs structural signature checks now and leaves a visible hook for full cryptographic verification via backend services later.',
  },
  {
    key: 'verdict',
    title: 'Final Verdict',
    description: 'Summarizes whether the receipt is structurally consistent with resolved CommandLayer metadata.',
  },
];

const elements = {
  ensInput: document.getElementById('ensInput'),
  receiptInput: document.getElementById('receiptInput'),
  resolveAgentBtn: document.getElementById('resolveAgentBtn'),
  verifyReceiptBtn: document.getElementById('verifyReceiptBtn'),
  reportStack: document.getElementById('reportStack'),
  technicalDetails: document.getElementById('technicalDetails'),
};

const state = {
  metadata: null,
  lastReport: null,
};

const sampleCommercialReceipt = {
  x402: {
    verb: 'authorize',
    version: '1.1.0',
    entry: 'x402://authorizeagent.eth/authorize/v1.1.0',
    request_id: 'req_demo_authorize_001',
  },
  trace: {
    trace_id: 'trace_demo_authorize_001',
    started_at: '2026-03-22T12:00:00.000Z',
    completed_at: '2026-03-22T12:00:01.420Z',
    duration_ms: 1420,
    provider: 'commandlayer-runtime',
    region: 'global',
  },
  status: 'success',
  result: {
    authorization_id: 'auth_demo_01JQ0AUTHORIZE',
    status: 'authorized',
    amount: {
      value: '149.00',
      asset: 'USD',
      pricing_tier: 'premium',
    },
    settlement: {
      chain: 'eip155:8453',
      recipient: 'merchant.commandlayer.eth',
      merchant_id: 'cmd_demo_store',
    },
    metadata: {
      merchant: 'CommandLayer Demo Store',
      sku: 'cl-premium-plan',
    },
  },
  metadata: {
    ens: 'authorizeagent.eth',
    class: 'commercial',
    signer: 'runtime.commandlayer.eth',
  },
  proof: {
    signer_id: 'runtime.commandlayer.eth',
    signature_b64: 'QXV0aG9yaXplRGVtb1NpZ25hdHVyZVBsYWNlaG9sZGVyPT0=',
    verification_hook: '/api/verify-receipt',
  },
};

async function loadMetadata() {
  if (state.metadata) return state.metadata;

  const [commonsMeta, commercialMeta, commonsManifest, commercialManifest] = await Promise.all([
    fetchJson('/agent-cards/meta/commons-agent.json'),
    fetchJson('/agent-cards/meta/commercial-agent.json'),
    fetchJson('/schemas/v1.1.0/commons/manifest.json'),
    fetchJson('/schemas/v1.1.0/commercial/manifest.json'),
  ]);

  state.metadata = {
    registry: {
      commons: commonsMeta,
      commercial: commercialMeta,
    },
    manifests: {
      commons: commonsManifest,
      commercial: commercialManifest,
    },
  };
  return state.metadata;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

function getBadgeClass(status) {
  return status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : status === 'warn' ? 'warn' : 'neutral';
}

function renderInitialReport() {
  const report = {};
  for (const section of reportDefinitions) {
    report[section.key] = {
      status: 'neutral',
      summary: 'Awaiting input.',
      rows: [],
    };
  }
  renderReport(report, { mode: 'idle' });
}

function renderReport(report, technical) {
  state.lastReport = report;
  elements.reportStack.innerHTML = reportDefinitions.map((section) => {
    const sectionData = report[section.key] || { status: 'neutral', summary: 'No data.', rows: [] };
    const rows = (sectionData.rows || []).map((row) => `
      <div class="kv-row">
        <div class="kv-key">${escapeHtml(row.key)}</div>
        <div class="kv-value">${escapeHtml(row.value)}</div>
      </div>`).join('');

    return `
      <article class="report-card">
        <div class="report-head">
          <div>
            <h3>${section.title}</h3>
            <p>${sectionData.summary || section.description}</p>
          </div>
          <span class="badge ${getBadgeClass(sectionData.status)}">${escapeHtml(labelForStatus(sectionData.status))}</span>
        </div>
        <div class="kv">${rows || '<div class="kv-row"><div class="kv-key">Status</div><div class="kv-value">No data yet.</div></div>'}</div>
      </article>`;
  }).join('');

  elements.technicalDetails.textContent = JSON.stringify(technical, null, 2);
}

function labelForStatus(status) {
  switch (status) {
    case 'pass': return 'Pass';
    case 'fail': return 'Fail';
    case 'warn': return 'Needs Live Proof';
    default: return 'Pending';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inferClassFromEns(ens) {
  if (!ens) return null;
  const lower = ens.toLowerCase();
  if (['authorizeagent.eth', 'purchaseagent.eth', 'checkoutagent.eth', 'shipagent.eth', 'verifyagent.eth'].includes(lower)) {
    return 'commercial';
  }
  return 'commons';
}

function deriveExpectedEntry({ className, ens, verb, version, commonsMeta, commercialMeta }) {
  if (!className || !ens || !verb || !version) return null;
  if (className === 'commons') return commonsMeta?.bindings?.entry || 'https://runtime.commandlayer.org/execute';
  return commercialMeta?.bindings?.entry_pattern?.replace('<agent>', ens).replace('<verb>', verb) || `x402://${ens}/${verb}/${version}`;
}

async function resolveAgentByEns(ens) {
  const normalizedEns = (ens || '').trim().toLowerCase();
  if (!normalizedEns) throw new Error('Enter an ENS name to resolve.');

  const metadata = await loadMetadata();
  const className = inferClassFromEns(normalizedEns);
  const cardPath = `/agent-cards/agents/v1.1.0/${className}/${normalizedEns}.json`;
  const ercPath = `/erc8004/${normalizedEns}.json`;

  const [agentCard, erc8004] = await Promise.all([
    fetchJson(cardPath),
    fetchJson(ercPath),
  ]);

  const verb = agentCard.implements?.[0] || erc8004.commandLayerVerb || null;
  const expectedEntry = deriveExpectedEntry({
    className: agentCard.class || className,
    ens: normalizedEns,
    verb,
    version: agentCard.version || erc8004.commandLayerVersion,
    commonsMeta: metadata.registry.commons,
    commercialMeta: metadata.registry.commercial,
  });

  return {
    ens: normalizedEns,
    className: agentCard.class || className,
    agentCard,
    erc8004,
    verb,
    expectedEntry,
    schemaReceipt: agentCard.schemas?.receipt || erc8004.schemaReceipt,
    schemaRequest: agentCard.schemas?.request || erc8004.schemaRequest,
    metadata,
  };
}

function getReceiptEnvelope(receipt) {
  const nestedReceipt = receipt?.receipt && typeof receipt.receipt === 'object' ? receipt.receipt : receipt;
  const proof = nestedReceipt.proof || receipt.proof || receipt.runtime_metadata?.proof || {};
  const signer = nestedReceipt?.metadata?.signer || receipt.signer || receipt.runtime_metadata?.metadata?.signer_id || proof.signer_id || null;
  const ens = nestedReceipt?.metadata?.ens || receipt.ens || receipt.runtime_metadata?.metadata?.agent_id || null;
  const className = nestedReceipt?.metadata?.class || receipt.class || null;
  const verb = nestedReceipt?.x402?.verb || nestedReceipt?.verb || null;
  const version = nestedReceipt?.x402?.version || nestedReceipt?.schema_version || null;
  const entry = nestedReceipt?.x402?.entry || receipt.entry || null;

  return {
    raw: receipt,
    receipt: nestedReceipt,
    proof,
    signer,
    ens,
    className,
    verb,
    version,
    entry,
  };
}

async function verifyResolvedAgent(resolved) {
  const schemaUrl = resolved.schemaReceipt;
  let schemaOk = false;
  let schemaPath = null;
  try {
    schemaPath = new URL(schemaUrl).pathname;
    await fetchJson(schemaPath);
    schemaOk = true;
  } catch (error) {
    schemaOk = false;
  }

  const agentEntryMatches = resolved.agentCard.entry === resolved.expectedEntry;
  const ercService = resolved.erc8004.services?.find((service) => service.name === 'execution');
  const ercEntryMatches = ercService?.endpoint === resolved.expectedEntry;
  const signerExpected = resolved.erc8004.receiptSigner || 'runtime.commandlayer.eth';

  const finalPass = Boolean(
    resolved.agentCard.ens === resolved.ens &&
    resolved.agentCard.id === resolved.ens &&
    resolved.agentCard.class === resolved.className &&
    schemaOk &&
    agentEntryMatches &&
    ercEntryMatches
  );

  const report = {
    ens: {
      status: 'pass',
      summary: `Resolved ${resolved.ens} into local ${resolved.className} metadata bindings.`,
      rows: [
        { key: 'ENS Name', value: resolved.ens },
        { key: 'Class', value: resolved.className },
        { key: 'Agent Card', value: resolved.agentCard.$id },
      ],
    },
    agentCard: {
      status: agentEntryMatches ? 'pass' : 'fail',
      summary: agentEntryMatches
        ? 'Agent card matches the expected CommandLayer routing split.'
        : 'Agent card entry does not match the expected CommandLayer routing split.',
      rows: [
        { key: 'Implements', value: (resolved.agentCard.implements || []).join(', ') || 'Unknown' },
        { key: 'Version', value: resolved.agentCard.version || 'Unknown' },
        { key: 'Declared Entry', value: resolved.agentCard.entry || 'Missing' },
        { key: 'Expected Entry', value: resolved.expectedEntry || 'Missing' },
      ],
    },
    schema: {
      status: schemaOk ? 'pass' : 'fail',
      summary: schemaOk ? 'Linked receipt schema is available.' : 'Linked receipt schema could not be loaded.',
      rows: [
        { key: 'Receipt Schema', value: schemaUrl || 'Missing' },
        { key: 'Local Path', value: schemaPath || 'Unavailable' },
      ],
    },
    erc8004: {
      status: ercEntryMatches ? 'pass' : 'fail',
      summary: ercEntryMatches ? 'ERC-8004 registration matches the execution entry.' : 'ERC-8004 registration conflicts with the expected execution entry.',
      rows: [
        { key: 'Registration Type', value: resolved.erc8004.type || 'Missing' },
        { key: 'Registered Verb', value: resolved.erc8004.commandLayerVerb || 'Missing' },
        { key: 'Registered Version', value: resolved.erc8004.commandLayerVersion || 'Missing' },
        { key: 'Execution Endpoint', value: ercService?.endpoint || 'Missing' },
      ],
    },
    signer: {
      status: 'pass',
      summary: 'Resolved the expected signer from ERC-8004 metadata.',
      rows: [
        { key: 'Receipt Signer', value: signerExpected },
        { key: 'Algorithm', value: resolved.erc8004.receiptAlgorithm || 'Unknown' },
        { key: 'Owner', value: resolved.erc8004.owner || 'Unknown' },
      ],
    },
    signature: {
      status: 'warn',
      summary: 'No receipt payload provided yet, so cryptographic receipt validation remains pending.',
      rows: [
        { key: 'Status', value: 'Awaiting receipt JSON' },
        { key: 'Verification Hook', value: '/api/verify-receipt (future backend endpoint)' },
      ],
    },
    verdict: {
      status: finalPass ? 'pass' : 'fail',
      summary: finalPass
        ? `Agent metadata for ${resolved.ens} is internally consistent.`
        : `Agent metadata for ${resolved.ens} is not internally consistent.`,
      rows: [
        { key: 'Verdict', value: finalPass ? 'Metadata chain passes local consistency checks.' : 'Metadata chain failed local consistency checks.' },
      ],
    },
  };

  renderReport(report, {
    mode: 'agent-resolution',
    resolved,
    checks: {
      schemaOk,
      agentEntryMatches,
      ercEntryMatches,
      signerExpected,
      finalPass,
    },
  });
}

async function verifyReceiptInput() {
  let parsed;
  try {
    parsed = JSON.parse(elements.receiptInput.value);
  } catch (error) {
    renderReport(buildParseErrorReport(error.message), { mode: 'receipt-verification', error: error.message });
    return;
  }

  const envelope = getReceiptEnvelope(parsed);
  const ens = (envelope.ens || elements.ensInput.value || '').trim().toLowerCase();
  if (!ens) {
    renderReport(buildParseErrorReport('Receipt is missing metadata.ens and no ENS input was provided.'), { mode: 'receipt-verification', error: 'Missing ENS' });
    return;
  }

  try {
    const resolved = await resolveAgentByEns(ens);
    const report = await buildReceiptReport(envelope, resolved);
    renderReport(report, {
      mode: 'receipt-verification',
      resolved,
      envelope,
      notes: {
        cryptographicVerification: 'Not executed. The UI only performs structural checks and exposes verification hooks for backend integration.',
      },
    });
  } catch (error) {
    renderReport(buildParseErrorReport(error.message), { mode: 'receipt-verification', error: error.message, ens });
  }
}

function buildParseErrorReport(message) {
  return {
    ens: {
      status: 'fail',
      summary: 'Unable to establish an ENS trust root for this input.',
      rows: [{ key: 'Error', value: message }],
    },
    agentCard: { status: 'fail', summary: 'Agent metadata could not be resolved.', rows: [{ key: 'Reason', value: message }] },
    schema: { status: 'fail', summary: 'Schema validation could not run.', rows: [{ key: 'Reason', value: message }] },
    erc8004: { status: 'fail', summary: 'ERC-8004 verification could not run.', rows: [{ key: 'Reason', value: message }] },
    signer: { status: 'fail', summary: 'Signer resolution could not run.', rows: [{ key: 'Reason', value: message }] },
    signature: { status: 'fail', summary: 'Signature verification could not run.', rows: [{ key: 'Reason', value: message }] },
    verdict: { status: 'fail', summary: 'Verification failed before structural checks could complete.', rows: [{ key: 'Verdict', value: 'No trust verdict available.' }] },
  };
}

async function buildReceiptReport(envelope, resolved) {
  const schemaPath = new URL(resolved.schemaReceipt).pathname;
  let schema;
  try {
    schema = await fetchJson(schemaPath);
  } catch (error) {
    schema = null;
  }

  const expectedEntry = deriveExpectedEntry({
    className: resolved.className,
    ens: resolved.ens,
    verb: resolved.verb,
    version: resolved.agentCard.version,
    commonsMeta: resolved.metadata.registry.commons,
    commercialMeta: resolved.metadata.registry.commercial,
  });

  const receiptVerb = envelope.verb;
  const receiptVersion = envelope.version;
  const receiptEntry = envelope.entry;
  const proofSigner = envelope.proof?.signer_id || null;
  const declaredSigner = envelope.receipt?.metadata?.signer || envelope.signer || null;
  const expectedSigner = resolved.erc8004.receiptSigner || null;
  const signatureValue = envelope.proof?.signature_b64 || null;

  const structuralConsistency = [
    receiptVerb === resolved.verb,
    receiptVersion === resolved.agentCard.version,
    receiptEntry === expectedEntry,
    (envelope.className || resolved.className) === resolved.className,
    (!declaredSigner || declaredSigner === expectedSigner),
    proofSigner === expectedSigner,
  ].every(Boolean);

  const schemaChecks = schema ? {
    requiresX402: Boolean(schema.allOf || schema.properties?.x402),
    baseFieldsPresent: Boolean(envelope.receipt?.status && envelope.receipt?.trace),
  } : { requiresX402: false, baseFieldsPresent: false };

  const signatureStructurallyPresent = Boolean(signatureValue && proofSigner);

  const agentStatus = receiptVerb === resolved.verb && receiptVersion === resolved.agentCard.version && receiptEntry === expectedEntry ? 'pass' : 'fail';
  const schemaStatus = schema && schemaChecks.baseFieldsPresent ? 'pass' : 'fail';
  const ercStatus = resolved.erc8004.commandLayerVerb === resolved.verb && resolved.erc8004.commandLayerVersion === resolved.agentCard.version ? 'pass' : 'fail';
  const signerStatus = proofSigner === expectedSigner ? 'pass' : 'fail';
  const signatureStatus = signatureStructurallyPresent ? 'warn' : 'fail';
  const verdictStatus = structuralConsistency ? 'warn' : 'fail';

  return {
    ens: {
      status: 'pass',
      summary: `Receipt anchored to ${resolved.ens} and resolved through local ENS-bound metadata.`,
      rows: [
        { key: 'Resolved ENS', value: resolved.ens },
        { key: 'Receipt ENS', value: envelope.ens || 'Derived from ENS input' },
        { key: 'Class', value: resolved.className },
      ],
    },
    agentCard: {
      status: agentStatus,
      summary: agentStatus === 'pass'
        ? 'Receipt verb, version, and entry align with the resolved agent card.'
        : 'Receipt verb, version, or entry do not align with the resolved agent card.',
      rows: [
        { key: 'Card Implements', value: resolved.verb || 'Missing' },
        { key: 'Receipt Verb', value: receiptVerb || 'Missing' },
        { key: 'Card Version', value: resolved.agentCard.version || 'Missing' },
        { key: 'Receipt Version', value: receiptVersion || 'Missing' },
        { key: 'Expected Entry', value: expectedEntry || 'Missing' },
        { key: 'Receipt Entry', value: receiptEntry || 'Missing' },
      ],
    },
    schema: {
      status: schemaStatus,
      summary: schemaStatus === 'pass'
        ? 'Receipt includes the base fields expected by the linked schema.'
        : 'Receipt is missing fields expected by the linked schema or the schema could not be loaded.',
      rows: [
        { key: 'Schema URL', value: resolved.schemaReceipt || 'Missing' },
        { key: 'Schema Loaded', value: schema ? 'Yes' : 'No' },
        { key: 'Trace Present', value: envelope.receipt?.trace ? 'Yes' : 'No' },
        { key: 'Status Present', value: envelope.receipt?.status ? 'Yes' : 'No' },
      ],
    },
    erc8004: {
      status: ercStatus,
      summary: ercStatus === 'pass'
        ? 'ERC-8004 registration matches the resolved card metadata.'
        : 'ERC-8004 registration is inconsistent with the resolved card metadata.',
      rows: [
        { key: 'Registered ENS', value: resolved.erc8004.ens || 'Missing' },
        { key: 'Registered Verb', value: resolved.erc8004.commandLayerVerb || 'Missing' },
        { key: 'Registered Version', value: resolved.erc8004.commandLayerVersion || 'Missing' },
        { key: 'Registered Endpoint', value: resolved.erc8004.services?.find((service) => service.name === 'execution')?.endpoint || 'Missing' },
      ],
    },
    signer: {
      status: signerStatus,
      summary: signerStatus === 'pass'
        ? 'proof.signer_id matches cl.receipt.signer expectations from local metadata.'
        : 'proof.signer_id does not match the expected signer from local metadata.',
      rows: [
        { key: 'Expected Signer', value: expectedSigner || 'Missing' },
        { key: 'proof.signer_id', value: proofSigner || 'Missing' },
        { key: 'metadata.signer', value: declaredSigner || 'Missing' },
      ],
    },
    signature: {
      status: signatureStatus,
      summary: signatureStatus === 'warn'
        ? 'Signature material is present, but full cryptographic verification still requires a backend or signer-key service.'
        : 'Receipt is missing proof fields required even for structural signature checks.',
      rows: [
        { key: 'Signature Present', value: signatureValue ? 'Yes' : 'No' },
        { key: 'Signer Present', value: proofSigner ? 'Yes' : 'No' },
        { key: 'Verification Hook', value: envelope.proof?.verification_hook || '/api/verify-receipt (future backend endpoint)' },
      ],
    },
    verdict: {
      status: verdictStatus,
      summary: structuralConsistency
        ? 'Receipt is structurally consistent with resolved ENS, agent card, schema, ERC-8004, and signer metadata. Final cryptographic proof is still pending.'
        : 'Receipt is not structurally consistent with the resolved CommandLayer trust chain.',
      rows: [
        { key: 'Structural Consistency', value: structuralConsistency ? 'Pass' : 'Fail' },
        { key: 'Cryptographic Verification', value: 'Not executed in this standalone page' },
      ],
    },
  };
}

async function loadSample(sampleKey) {
  if (sampleKey === 'ens:parseagent.eth') {
    elements.ensInput.value = 'parseagent.eth';
    return verifyResolvedAgent(await resolveAgentByEns('parseagent.eth'));
  }

  if (sampleKey === 'ens:authorizeagent.eth') {
    elements.ensInput.value = 'authorizeagent.eth';
    return verifyResolvedAgent(await resolveAgentByEns('authorizeagent.eth'));
  }

  if (sampleKey === 'receipt:commons') {
    const sample = await fetchJson('/assets/receipts/clean.recorded-live-artifact.v1.1.0.json');
    const normalized = {
      x402: {
        verb: 'clean',
        version: '1.1.0',
        entry: 'https://runtime.commandlayer.org/execute',
        request_id: sample.runtime_metadata?.metadata?.receipt_id || 'clrcpt_sample_commons',
      },
      trace: sample.runtime_metadata?.trace || { trace_id: 'trace_demo_recorded_clean_001' },
      status: sample.receipt?.status || 'success',
      cleaned_content: sample.receipt?.cleaned_content,
      operations_applied: sample.receipt?.operations_applied,
      metadata: {
        ens: 'cleanagent.eth',
        class: 'commons',
        signer: sample.runtime_metadata?.metadata?.signer_id || sample.signer,
      },
      proof: {
        signer_id: sample.runtime_metadata?.proof?.signer_id || sample.signer,
        signature_b64: sample.runtime_metadata?.proof?.signature_b64,
        hash_sha256: sample.runtime_metadata?.proof?.hash_sha256 || sample.proof_hash,
        verification_hook: '/api/verify-receipt',
      },
    };
    elements.ensInput.value = 'cleanagent.eth';
    elements.receiptInput.value = JSON.stringify(normalized, null, 2);
    return verifyReceiptInput();
  }

  if (sampleKey === 'receipt:commercial') {
    elements.ensInput.value = 'authorizeagent.eth';
    elements.receiptInput.value = JSON.stringify(sampleCommercialReceipt, null, 2);
    return verifyReceiptInput();
  }
}

async function onResolveAgent() {
  try {
    const resolved = await resolveAgentByEns(elements.ensInput.value);
    await verifyResolvedAgent(resolved);
  } catch (error) {
    renderReport(buildParseErrorReport(error.message), { mode: 'agent-resolution', error: error.message });
  }
}

function wireEvents() {
  elements.resolveAgentBtn.addEventListener('click', onResolveAgent);
  elements.verifyReceiptBtn.addEventListener('click', verifyReceiptInput);
  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => loadSample(button.dataset.sample));
  });
}

renderInitialReport();
wireEvents();
loadSample('ens:parseagent.eth').catch((error) => {
  renderReport(buildParseErrorReport(error.message), { mode: 'initial-load', error: error.message });
});
