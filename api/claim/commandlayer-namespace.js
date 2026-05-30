'use strict';

const crypto = require('node:crypto');
const db = require('../../lib/db');
const { CANONICALIZATION, buildSignerRecords, normalizeActivationMode } = require('../../lib/claims/signer-records');
const { generateClaimAccessToken, hashClaimAccessToken } = require('../../lib/claims/access-token');
const { requireRateLimit } = require('../../lib/rateLimit');

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TENANT_RE = /^[a-z0-9-]{3,32}$/;
const ENS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/;
const PUBLIC_KEY_RE = /^ed25519:[A-Za-z0-9+/]{43}=$/;
const KID_RE = /^[A-Za-z0-9+/=_:-]{6,128}$/;

function invalid(res, error, reason) {
  return res.status(400).json({ ok: false, status: 'CLAIM_REQUEST_INVALID', error, reason });
}

function hasPrivateKeyMaterial(value) {
  const serialized = JSON.stringify(value || {}).toLowerCase();
  return serialized.includes('privatekey') || serialized.includes('private_key') || serialized.includes('private key') || serialized.includes('begin private key') || serialized.includes('privkey') || serialized.includes('priv_key');
}

function safeAgent(agent) {
  const cardJson = agent && agent.cardJson && typeof agent.cardJson === 'object' && !Array.isArray(agent.cardJson) ? agent.cardJson : null;
  const sanitizedCard = cardJson ? JSON.parse(JSON.stringify(cardJson)) : null;
  if (sanitizedCard) {
    delete sanitizedCard.privateKey;
    delete sanitizedCard.private_key;
    delete sanitizedCard.privateKeyPem;
    delete sanitizedCard.private_key_pem;
    delete sanitizedCard.claimAccessToken;
    delete sanitizedCard.claim_access_token;
    delete sanitizedCard.accessToken;
    delete sanitizedCard.access_token;
  }
  return {
    ens: String(agent.ens || '').toLowerCase().trim(),
    capability: String(agent.capability || '').toLowerCase().trim(),
    canonicalParent: String(agent.canonicalParent || agent.canonical_parent || '').toLowerCase().trim(),
    skill: String(agent.skill || '').trim(),
    skillFamily: String(agent.skillFamily || agent.skill_family || '').trim(),
    cardJson: sanitizedCard,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireRateLimit(req, res, { bucket: 'claim-intake', max: 20, windowMs: 60_000 })) return;

  if (hasPrivateKeyMaterial(req.body)) return invalid(res, 'private_key_material_rejected', 'Private signing keys must stay local and must not be submitted.');

  const body = req.body || {};
  const { authenticatedAddress, tenant, packId } = body;
  const activationMode = normalizeActivationMode(body.activationMode);
  const tenantSignerEns = String(body.tenantSignerEns || body.tenant_signer_ens || '').toLowerCase().trim();
  const tenantSignerPublicKey = String(body.tenantSignerPublicKey || body.tenant_signer_public_key || body.publicKey || '').trim();
  const tenantSignerKid = String(body.tenantSignerKid || body.tenant_signer_kid || body.kid || '').trim();
  const tenantSignerCanonicalization = String(body.tenantSignerCanonicalization || body.tenant_signer_canonicalization || CANONICALIZATION).trim();
  const agents = Array.isArray(body.agents) ? body.agents.map(safeAgent) : [];

  if (!authenticatedAddress || !ADDRESS_RE.test(authenticatedAddress)) return invalid(res, 'invalid_authenticated_address', 'authenticatedAddress must be a valid 0x Ethereum address.');
  if (!activationMode) return invalid(res, 'invalid_activation_mode', 'activationMode must be managed_namespace or bring_your_own_ens.');
  if (typeof tenant !== 'string' || !TENANT_RE.test(tenant) || tenant.startsWith('-') || tenant.endsWith('-') || tenant.includes('.eth')) return invalid(res, 'invalid_tenant', 'tenant must be 3-32 lowercase alphanumeric/hyphen chars.');
  if (packId !== 'trust') return invalid(res, 'unsupported_pack', 'Only trust pack intake is currently accepted.');
  if (!ENS_RE.test(tenantSignerEns)) return invalid(res, 'invalid_tenant_signer_ens', 'tenantSignerEns must be a valid .eth ENS name.');
  if (!PUBLIC_KEY_RE.test(tenantSignerPublicKey)) return invalid(res, 'invalid_public_key', 'tenantSignerPublicKey must be ed25519:<base64 raw 32-byte public key>.');
  if (!KID_RE.test(tenantSignerKid)) return invalid(res, 'invalid_kid', 'tenantSignerKid is invalid.');
  if (tenantSignerCanonicalization !== CANONICALIZATION) return invalid(res, 'invalid_canonicalization', `canonicalization must be ${CANONICALIZATION}.`);
  if (!agents.length || agents.length > 10) return invalid(res, 'invalid_agents', 'At least one and at most ten generated agents are required.');
  if (agents.some((a) => !ENS_RE.test(a.ens) || !a.capability || !a.canonicalParent || !a.skill || !a.skillFamily)) return invalid(res, 'invalid_agent', 'Every agent requires ens, capability, canonicalParent, skill, and skillFamily.');
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, status: 'STORAGE_UNAVAILABLE' });

  const claimId = `clm_${crypto.randomUUID().replace(/-/g, '')}`;
  const claimAccessToken = generateClaimAccessToken();
  const claimAccessTokenHash = hashClaimAccessToken(claimAccessToken);
  const txtRecords = buildSignerRecords({ publicKey: tenantSignerPublicKey, kid: tenantSignerKid, canonicalization: tenantSignerCanonicalization, signerEns: tenantSignerEns });
  const recordStatus = 'records_generated';
  const managedStatus = activationMode === 'managed_namespace' ? 'not_started' : null;
  const managedParent = activationMode === 'managed_namespace' ? tenantSignerEns.split('.').slice(1).join('.') : null;
  const safeRequest = {
    authenticatedAddress,
    tenant,
    activationMode,
    packId,
    tenantSignerEns,
    tenantSignerPublicKey,
    tenantSignerKid,
    tenantSignerCanonicalization,
    tenantSignerTxtRecords: txtRecords,
    agents,
    verifier: body.verifier || 'https://runtime.commandlayer.org/verify',
    runtime: body.runtime || 'https://runtime.commandlayer.org',
    schemaVersion: body.schemaVersion || '1.1.0',
  };

  try {
    await db.query(
      `insert into claim_requests
      (claim_id, authenticated_address, tenant, activation_mode, pack_id, public_key, kid, runtime, verifier, schema_version, status,
       tenant_signer_ens, tenant_signer_public_key, tenant_signer_kid, tenant_signer_canonicalization,
       tenant_signer_record_status, tenant_signer_txt_records, managed_ens_publication_status,
       managed_ens_parent_namespace, managed_ens_parent_authority_audited, tenant_proof_status, claim_access_token_hash, request_json)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created',$11,$12,$13,$14,$15,$16::jsonb,$17,$18,false,'not_submitted',$19,$20::jsonb)`,
      [claimId, authenticatedAddress, tenant, activationMode, packId, tenantSignerPublicKey, tenantSignerKid, safeRequest.runtime, safeRequest.verifier, safeRequest.schemaVersion,
        tenantSignerEns, tenantSignerPublicKey, tenantSignerKid, tenantSignerCanonicalization, recordStatus, JSON.stringify(txtRecords), managedStatus, managedParent, claimAccessTokenHash, JSON.stringify(safeRequest)]
    );
    for (const agent of agents) {
      await db.query(
        `insert into claim_agents (claim_id, ens, capability, canonical_parent, skill, skill_family, status, card_json, published_card_json, source_json)
         values ($1,$2,$3,$4,$5,$6,'published',$7::jsonb,$7::jsonb,$7::jsonb)`,
        [claimId, agent.ens, agent.capability, agent.canonicalParent, agent.skill, agent.skillFamily, JSON.stringify(agent.cardJson || {})]
      );
    }
    await db.query(
      `insert into claim_events (claim_id, event_type, message, metadata_json)
       values ($1,$2,$3,$4::jsonb)`,
      [claimId, 'claim.created', 'Public claim request received with tenant signer identity.', JSON.stringify({ publicIntake: true, activationMode, tenantSignerEns })]
    );
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'CLAIM_REQUEST_PERSISTENCE_ERROR' });
  }

  return res.status(202).json({
    ok: true,
    status: 'CLAIM_REQUEST_RECEIVED',
    claimId,
    authenticatedAddress,
    activationMode,
    tenantSignerEns,
    tenantSignerRecordStatus: recordStatus,
    managedEnsPublicationStatus: managedStatus,
    claimAccessToken,
    agents: agents.map((a) => ({ ens: a.ens, capability: a.capability })),
    message: 'Claim request received.',
  });
};
