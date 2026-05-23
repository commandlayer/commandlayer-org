'use strict';

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const error = new Error('DATABASE_URL is not configured');
    error.code = 'DATABASE_URL_MISSING';
    throw error;
  }
  return databaseUrl;
}

function normalizeRows(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (result && Array.isArray(result.rows)) {
    return result.rows;
  }
  return [];
}

function normalizeQueryResult(result) {
  if (Array.isArray(result)) {
    return { rows: result };
  }
  if (result && Array.isArray(result.rows)) {
    return result;
  }
  return { rows: [] };
}

async function query(text, params = []) {
  // Lazy-load Neon so tests can mock this module without requiring installed drivers.
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(getDatabaseUrl());
  const result = await sql.query(text, params);
  return normalizeQueryResult(result);
}

module.exports = {
  query,
  getDatabaseUrl,
  normalizeRows,
  normalizeQueryResult
};
