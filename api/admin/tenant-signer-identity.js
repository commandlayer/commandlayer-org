'use strict';

const db = require('../../lib/db');
const {
  buildTenantSignerIdentity,
  buildTenantSignerRecordPackage,
  checkTenantSignerEnsRecords,
} = require('../../lib/tenantSignerIdentity');
const { requireAdminAuth } = require('./_auth');

function publicIdentity(row) {
  if (!row) return null;
  const identity = buildTenantSignerIdentity({
    agent_ens_name: row.agent_ens_name || row.ens,
    tenant_signer_kid: row.tenant_signer_kid,
    tenant_signer_public_key: row.tenant_signer_public_key,
    tenant_signer_canonicalization: row.tenant_signer_canonicalization,
    tenant_signer_status: row.tenant_signer_status || 'records_pending',
  });
  return {
    ...identity,
    tenant_signer_created_at: row.tenant_signer_created_at || null,
    record_package: buildTenantSignerRecordPackage(identity),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  if (!requireAdminAuth(req, res)) return;

  const claimId = req.body && String(req.body.claimId || '').trim();
  const action = req.body && String(req.body.action || 'upsert').trim();
  const agentEnsName = req.body && String(req.body.agentEnsName || req.body.agent_ens_name || '').trim();
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  if (!agentEnsName) return res.status(400).json({ ok: false, status: 'AGENT_ENS_NAME_REQUIRED' });

  const agentResult = await db.query(
    `select * from claim_agents where claim_id = $1 and (ens = $2 or agent_ens_name = $2) limit 1`,
    [claimId, agentEnsName.toLowerCase()]
  );
  const agent = agentResult.rows[0];
  if (!agent) return res.status(404).json({ ok: false, status: 'CLAIM_AGENT_NOT_FOUND' });

  if (action === 'check_records') {
    if (!agent.tenant_signer_public_key || !agent.tenant_signer_kid) {
      return res.status(400).json({ ok: false, status: 'TENANT_SIGNER_IDENTITY_MISSING' });
    }
    const identity = buildTenantSignerIdentity({
      agent_ens_name: agent.agent_ens_name || agent.ens,
      tenant_signer_kid: agent.tenant_signer_kid,
      tenant_signer_public_key: agent.tenant_signer_public_key,
      tenant_signer_canonicalization: agent.tenant_signer_canonicalization,
      tenant_signer_status: agent.tenant_signer_status,
    });
    const check = await checkTenantSignerEnsRecords(identity, req.verifyOptions && req.verifyOptions.ens ? req.verifyOptions.ens : {});
    await db.query(
      `update claim_agents
       set tenant_signer_status = $3, updated_at = coalesce(updated_at, now())
       where claim_id = $1 and (ens = $2 or agent_ens_name = $2)`,
      [claimId, identity.agent_ens_name, check.status]
    ).catch(async (error) => {
      if (error && error.code === '42703') {
        await db.query(
          `update claim_agents set tenant_signer_status = $3 where claim_id = $1 and (ens = $2 or agent_ens_name = $2)`,
          [claimId, identity.agent_ens_name, check.status]
        );
        return;
      }
      throw error;
    });
    return res.status(200).json({ ok: true, status: check.status, identity: { ...publicIdentity({ ...agent, tenant_signer_status: check.status }), tenant_signer_status: check.status }, check });
  }

  if (action !== 'upsert') return res.status(400).json({ ok: false, status: 'TENANT_SIGNER_ACTION_UNSUPPORTED' });

  let identity;
  try {
    identity = buildTenantSignerIdentity({
      agent_ens_name: agentEnsName,
      tenant_signer_kid: req.body.tenantSignerKid || req.body.tenant_signer_kid,
      tenant_signer_public_key: req.body.tenantSignerPublicKey || req.body.tenant_signer_public_key,
      tenant_signer_status: 'records_pending',
    });
  } catch (error) {
    return res.status(400).json({ ok: false, status: error.code || 'TENANT_SIGNER_IDENTITY_INVALID' });
  }

  const updateResult = await db.query(
    `update claim_agents
     set agent_ens_name = $3,
         tenant_signer_kid = $4,
         tenant_signer_public_key = $5,
         tenant_signer_canonicalization = $6,
         tenant_signer_created_at = coalesce(tenant_signer_created_at, now()),
         tenant_signer_status = 'records_pending'
     where claim_id = $1 and (ens = $2 or agent_ens_name = $2)
     returning *`,
    [claimId, identity.agent_ens_name, identity.agent_ens_name, identity.tenant_signer_kid, identity.tenant_signer_public_key, identity.tenant_signer_canonicalization]
  );

  const updated = updateResult.rows[0] || { ...agent, ...identity, tenant_signer_created_at: new Date().toISOString() };
  await db.query(
    `insert into claim_events (claim_id, event_type, message, metadata_json)
     values ($1, 'tenant_signer.records_pending', 'Tenant agent signer TXT records generated and awaiting ENS publication.', $2::jsonb)`,
    [claimId, JSON.stringify({ agent_ens_name: identity.agent_ens_name, tenant_signer_kid: identity.tenant_signer_kid })]
  ).catch((error) => {
    if (error && (error.code === '42P01' || error.code === '42703')) return;
    throw error;
  });

  return res.status(200).json({ ok: true, status: 'records_pending', identity: publicIdentity(updated) });
};
