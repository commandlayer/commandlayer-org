'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../lib/db');
const handler = require('../api/admin/pin-agent-cards');

function makeRes() { return { statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } }; }

test('unpaid claims rejected', async () => {
  process.env.ADMIN_API_KEY = 'k';
  db.query = async (q) => (q.includes('from claim_requests') ? { rows: [{ claim_id: 'c1', status: 'created' }] } : { rows: [] });
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c1' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, 'CLAIM_NOT_PAID');
});

test('paid claim with no agent_cards populates and pins cards', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'jwt';
  const calls = [];
  let firstCardsLookup = true;
  global.fetch = async () => ({ ok: true, json: async () => ({ IpfsHash: 'bafy123' }) });
  db.query = async (q) => {
    calls.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c2', status: 'paid' }] };
    if (q.includes('from agent_cards') && firstCardsLookup) {
      firstCardsLookup = false;
      return { rows: [] };
    }
    if (q.includes('from claim_agents')) return { rows: [{ ens: 'x.eth', status: 'published', published_card_json: { a: 1 } }] };
    if (q.includes('select id from agent_cards')) return { rows: [] };
    if (q.includes('from agent_cards')) return { rows: [{ id: 'a1', ens: 'x.eth', claim_id: 'c2', card_json: { a: 1 }, status: 'published' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c2' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CARDS_PINNED');
  assert.ok(calls.some((q) => q.includes('insert into agent_cards')));
  assert.ok(calls.some((q) => q.includes('select id from agent_cards')));
});

test('backfills only missing agent_cards rows for paid claim', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'jwt';
  const calls = [];
  let lookupCount = 0;
  global.fetch = async () => ({ ok: true, json: async () => ({ IpfsHash: 'bafybackfill' }) });
  db.query = async (q, values) => {
    calls.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c7', status: 'paid' }] };
    if (q.includes('from agent_cards') && lookupCount++ === 0) return { rows: [] };
    if (q.includes('from claim_agents')) {
      return {
        rows: [
          { ens: 'a.eth', status: 'published', published_card_json: { a: 1 } },
          { ens: 'b.eth', status: 'published', source_json: JSON.stringify({ b: 2 }) },
          { ens: 'c.eth', status: 'published' },
        ],
      };
    }
    if (q.includes('select id from agent_cards')) return values[1] === 'a.eth' ? { rows: [{ id: 'existing' }] } : { rows: [] };
    if (q.includes('from agent_cards')) {
      return { rows: [{ id: 'b1', ens: 'b.eth', claim_id: 'c7', card_json: { b: 2 }, status: 'published' }] };
    }
    return { rows: [] };
  };
  const warns = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warns.push(args);
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c7' } }, res);
  console.warn = prevWarn;
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CARDS_PINNED');
  assert.equal(calls.filter((q) => q.includes('insert into agent_cards')).length, 1);
  assert.ok(warns.some((args) => String(args[0]).includes('CARD_JSON_MISSING')));
});

test('already pinned claim returns existing CID', async () => {
  process.env.ADMIN_API_KEY = 'k';
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c3', status: 'cards_pinned' }] };
    if (q.includes('from agent_cards')) return { rows: [{ id: 'a1', card_cid: 'bafy', card_ipfs_uri: 'ipfs://bafy', card_sha256: 'h' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c3' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ALREADY_PINNED');
});

test('pinning populates ipfs fields and moves claim to cards_pinned', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'jwt';
  const queries = [];
  global.fetch = async () => ({ ok: true, json: async () => ({ IpfsHash: 'bafyxyz' }) });
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c4', status: 'paid' }] };
    if (q.includes('from agent_cards')) return { rows: [{ id: 'a1', ens: 'x.eth', card_json: { a: 1 }, status: 'published' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c4' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(queries.some((q) => q.includes('set card_cid = $2')));
  assert.ok(queries.some((q) => q.includes('update claim_requests set status')));
});

test('provider error records pin_error and does not mark cards_pinned', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'jwt';
  const queries = [];
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  db.query = async (q) => {
    queries.push(q);
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c5', status: 'paid' }] };
    if (q.includes('from agent_cards')) return { rows: [{ id: 'a1', card_json: { a: 1 }, status: 'published' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c5' } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.status, 'IPFS_PIN_FAILED');
  assert.ok(queries.some((q) => q.includes("set pin_status = 'error'")));
  assert.ok(!queries.some((q) => q.includes('update claim_requests set status')));
});

test('provider error logging remains secret-safe', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'super-secret-jwt';
  const errors = [];
  const prevError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  db.query = async (q) => {
    if (q.includes('from claim_requests')) return { rows: [{ claim_id: 'c8', status: 'paid' }] };
    if (q.includes('from agent_cards')) return { rows: [{ id: 'a1', ens: 'x.eth', card_json: { a: 1 }, status: 'published' }] };
    return { rows: [] };
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c8' } }, res);
  console.error = prevError;
  assert.equal(res.statusCode, 502);
  assert.equal(errors.join('\n').includes('super-secret-jwt'), false);
  assert.ok(errors.some((l) => l.includes('IPFS_PIN_FAILED')));
});

test('no secrets are logged', async () => {
  process.env.ADMIN_API_KEY = 'k';
  process.env.PINATA_JWT = 'super-secret-jwt';
  const logs = [];
  const oldLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  db.query = async (q) => (q.includes('from claim_requests') ? { rows: [{ claim_id: 'c6', status: 'paid' }] } : { rows: [] });
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-api-key': 'k' }, body: { claimId: 'c6' } }, res);
  console.log = oldLog;
  assert.equal(logs.join('\n').includes('super-secret-jwt'), false);
});
