'use strict';

const crypto = require('node:crypto');

const TRUST_VERIFICATION_MAP = {
  sign: 'signagent.eth',
  attest: 'attestagent.eth',
  authorize: 'authorizeagent.eth',
  approve: 'approveagent.eth',
  reject: 'rejectagent.eth',
  permit: 'permitagent.eth',
  grant: 'grantagent.eth',
  authenticate: 'authenticateagent.eth',
  endorse: 'endorseagent.eth',
  verify: 'verifyagent.eth'
};

const RUNTIME_URL = 'https://runtime.commandlayer.org';
const VERIFIER_URL = 'https://runtime.commandlayer.org/verify';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TENANT_RE = /^[a-z0-9-]{3,32}$/;

function invalid(res, error, reason) {
  return res.status(400).json({ ok: false, status: 'CLAIM_REQUEST_INVALID', error, reason });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'CLAIM_REQUEST_INVALID', error: 'method_not_allowed', reason: 'Method not allowed. Use POST.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return invalid(res, 'invalid_body', 'Missing or invalid JSON body.');
  }

  const { authenticatedAddress, tenant, activationMode, packId, capabilities, agents, publicKey, kid, verifier, runtime } = body;
  if (!authenticatedAddress || !ADDRESS_RE.test(authenticatedAddress)) return invalid(res, 'invalid_authenticated_address', 'authenticatedAddress must be a valid 0x Ethereum address.');
  if (activationMode !== 'cl') return invalid(res, 'invalid_activation_mode', 'activationMode must be "cl".');
  if (typeof tenant !== 'string' || !tenant.trim()) return invalid(res, 'invalid_tenant', 'tenant is required.');
  if (tenant.includes('.eth')) return invalid(res, 'invalid_tenant', 'tenant must not include ".eth".');
  if (!TENANT_RE.test(tenant) || tenant.startsWith('-') || tenant.endsWith('-')) {
    return invalid(res, 'invalid_tenant', 'tenant must be 3-32 chars of lowercase letters, numbers, hyphen, and cannot start or end with hyphen.');
  }

  if (packId !== 'trust') {
    return invalid(res, 'unsupported_pack', 'Only Trust Verification activation requests are supported in this first backend flow.');
  }
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > 10) return invalid(res, 'invalid_capabilities', 'capabilities must contain between 1 and 10 items.');
  if (typeof publicKey !== 'string' || !publicKey.startsWith('ed25519:')) return invalid(res, 'invalid_public_key', 'publicKey must start with "ed25519:".');
  if (typeof kid !== 'string' || !kid.trim()) return invalid(res, 'invalid_kid', 'kid is required.');
  if (!Array.isArray(agents) || agents.length === 0) return invalid(res, 'invalid_agents', 'agents is required.');
  if (runtime !== RUNTIME_URL) return invalid(res, 'invalid_runtime', `runtime must be ${RUNTIME_URL}.`);
  if (verifier !== VERIFIER_URL) return invalid(res, 'invalid_verifier', `verifier must be ${VERIFIER_URL}.`);

  for (const capability of capabilities) {
    const canonicalParent = TRUST_VERIFICATION_MAP[capability];
    if (!canonicalParent) return invalid(res, 'invalid_capability', `Unsupported capability "${capability}" for Trust Verification pack.`);
  }

  for (const agent of agents) {
    if (!agent || typeof agent !== 'object') return invalid(res, 'invalid_agents', 'Each agent must be an object.');
    const { ens, capability, canonicalParent } = agent;
    if (!TRUST_VERIFICATION_MAP[capability]) return invalid(res, 'invalid_agent_capability', `Unsupported agent capability "${capability}".`);
    if (TRUST_VERIFICATION_MAP[capability] !== canonicalParent) return invalid(res, 'invalid_agent_mapping', `Capability "${capability}" must map to canonical parent "${TRUST_VERIFICATION_MAP[capability]}".`);
    if (!Object.values(TRUST_VERIFICATION_MAP).includes(canonicalParent)) return invalid(res, 'invalid_canonical_parent', `Unsupported canonical parent "${canonicalParent}".`);
    if (ens !== `${tenant}.${canonicalParent}`) return invalid(res, 'invalid_agent_ens', `Agent ENS must equal "${tenant}.${canonicalParent}".`);
  }

  const nowIso = new Date().toISOString();
  const digest = crypto.createHash('sha256').update(`${tenant}${authenticatedAddress}${kid}${nowIso}`).digest('hex');
  const claimId = `clm_${digest.slice(0, 24)}`;

  return res.status(200).json({
    ok: true,
    status: 'CLAIM_REQUEST_VALIDATED',
    claimId,
    activationMode: 'cl',
    tenant,
    authenticatedAddress,
    agents,
    next: {
      operatorReview: true,
      ensProvisioning: 'not_started',
      agentCards: 'not_started',
      erc8004: 'not_started'
    }
  });
};
