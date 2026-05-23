'use strict';

const db = require('../../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, status: 'METHOD_NOT_ALLOWED' });
  }

  const ens = typeof req.query?.ens === 'string' ? req.query.ens.trim() : '';
  const path = typeof req.query?.path === 'string' ? req.query.path.trim() : '';

  if (!ens && !path) return res.status(400).json({ ok: false, status: 'INVALID_CARD_LOOKUP' });

  try {
    const rows = db.normalizeRows(await db.query(
      'select card_json from agent_cards where ens = $1 or card_url like $2 limit 1',
      [ens, `%${path}`]
    ));
    if (!rows.length) return res.status(404).json({ ok: false, status: 'CARD_NOT_FOUND' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(rows[0].card_json);
  } catch (error) {
    console.error('PUBLIC_AGENT_CARD_LOOKUP_FAILED', { message: error.message, code: error.code });
    return res.status(500).json({ ok: false, status: 'PUBLIC_AGENT_CARD_LOOKUP_FAILED' });
  }
};
