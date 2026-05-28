'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_ROOT = path.join(process.cwd(), 'public', 'schemas', 'trust-verification');
const CHAIN_FIELDS = ['chain_root', 'previous_receipt_hash', 'chain_index', 'parent_receipt_id'];

test('trust verification receipt schemas allow optional receipt chain fields', () => {
  for (const verb of fs.readdirSync(SCHEMA_ROOT)) {
    const schemaPath = path.join(SCHEMA_ROOT, verb, `${verb}.receipt.schema.json`);
    if (!fs.existsSync(schemaPath)) continue;

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.equal(schema.additionalProperties, false, `${verb} receipt schema remains closed`);
    for (const field of CHAIN_FIELDS) {
      assert.ok(schema.properties[field], `${verb} receipt schema defines ${field}`);
      assert.ok(schema.properties[field].type.includes('null'), `${verb} ${field} allows null`);
      assert.equal(schema.required.includes(field), false, `${verb} ${field} is optional`);
    }
  }
});

test('trust verification request schemas allow optional parent_receipt_id input', () => {
  for (const verb of fs.readdirSync(SCHEMA_ROOT)) {
    const schemaPath = path.join(SCHEMA_ROOT, verb, `${verb}.request.schema.json`);
    if (!fs.existsSync(schemaPath)) continue;

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.ok(schema.properties.parent_receipt_id, `${verb} request schema defines parent_receipt_id`);
    assert.ok(schema.properties.parent_receipt_id.type.includes('null'), `${verb} parent_receipt_id allows null`);
    assert.equal(schema.required.includes('parent_receipt_id'), false, `${verb} parent_receipt_id is optional`);
  }
});
