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

async function query(text, params = []) {
  // Lazy-load Neon so tests can mock this module without requiring installed drivers.
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(getDatabaseUrl());
  return sql.query(text, params);
}

module.exports = {
  query,
  getDatabaseUrl
};
