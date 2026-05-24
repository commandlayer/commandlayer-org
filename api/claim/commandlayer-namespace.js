'use strict';

const crypto = require('node:crypto');
const db = require('../../lib/db');

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
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  // TODO: add request rate limiting middleware for public intake.
  const { authenticatedAddress, tenant, activationMode, packId } = req.body || {};
  if (!authenticatedAddress || !ADDRESS_RE.test(authenticatedAddress)) return invalid(res, 'invalid_authenticated_address', 'authenticatedAddress must be a valid 0x Ethereum address.');
  if (activationMode !== 'cl') return invalid(res, 'invalid_activation_mode', 'activationMode must be "cl".');
  if (typeof tenant !== 'string' || !TENANT_RE.test(tenant) || tenant.startsWith('-') || tenant.endsWith('-') || tenant.includes('.eth')) return invalid(res, 'invalid_tenant', 'tenant must be 3-32 lowercase alphanumeric/hyphen chars.');
  if (packId !== 'trust') return invalid(res, 'unsupported_pack', 'Only trust pack intake is currently accepted.');
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, status: 'STORAGE_UNAVAILABLE' });

  const claimId = `clm_${crypto.randomUUID().replace(/-/g, '')}`;

  try {
    await db.query(
      `insert into claim_requests
      (claim_id, authenticated_address, tenant, activation_mode, pack_id, public_key, kid, runtime, verifier, schema_version, request_json)
      values ($1,$2,$3,$4,$5,'','', '', '', '1.1.0', $6::jsonb)`,
      [claimId, authenticatedAddress, tenant, activationMode, packId, JSON.stringify({ authenticatedAddress, tenant, activationMode, packId })]
    );
    await db.query(
      `insert into claim_events (claim_id, event_type, message, metadata_json)
       values ($1,$2,$3,$4::jsonb)`,
      [claimId, 'claim.created', 'Public claim request received.', JSON.stringify({ publicIntake: true })]
    );
  } catch (_error) {
    return res.status(500).json({ ok: false, status: 'CLAIM_REQUEST_PERSISTENCE_ERROR' });
  }

  return res.status(202).json({ ok: true, status: 'CLAIM_REQUEST_RECEIVED', claimId, message: 'Claim request received.' });
};
