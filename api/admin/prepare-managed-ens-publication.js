'use strict';

const db = require('../../lib/db');
const { requireAdminAuth } = require('./_auth');
const { buildManagedEnsPublicationPackage } = require('../../lib/claims/managed-ens-publication');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' }); }
  if (!requireAdminAuth(req, res)) return;
  const claimId = req.body && (req.body.claim_id || req.body.claimId);
  if (!claimId) return res.status(400).json({ ok: false, status: 'CLAIM_ID_REQUIRED' });
  try {
    const result = await db.query('select * from claim_requests where claim_id = $1 limit 1', [claimId]);
    const claim = result.rows[0];
    if (!claim) return res.status(404).json({ ok: false, status: 'CLAIM_NOT_FOUND' });
    const publication = buildManagedEnsPublicationPackage(claim);
    await db.query(
      `update claim_requests
       set managed_ens_publication_status = 'ready_to_publish',
           managed_ens_required_txt_records = $2::jsonb,
           managed_ens_publication_instructions = $3::jsonb,
           managed_ens_parent_namespace = $4,
           managed_ens_publication_error = null,
           updated_at = now()
       where claim_id = $1`,
      [claimId, JSON.stringify(publication.required_txt_records), JSON.stringify(publication.instructions), publication.parent_namespace]
    );
    return res.status(200).json({ ok: true, claim_id: claimId, publication });
  } catch (error) {
    return res.status(400).json({ ok: false, status: error.status || 'MANAGED_ENS_PUBLICATION_PREPARE_FAILED', error: error.message });
  }
};
