const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schemaPath = path.join(process.cwd(), 'public', 'schemas', 'execution', 'execution.receipt.schema.json');
const manifestPath = path.join(process.cwd(), 'public', 'schemas', 'execution', 'manifest.json');
const indexPath = path.join(process.cwd(), 'public', 'schemas', 'index.json');

test('execution receipt schema is published under public schemas', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  assert.equal(schema.properties.schema.const, 'clas.execution.receipt.v1');
  assert.equal(schema.$id, 'https://commandlayer.org/schemas/execution/execution.receipt.schema.json');
  assert.ok(schema.required.includes('proofs'));
});

test('execution manifest and schema index expose the execution family', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  assert.equal(manifest.family_id, 'execution');
  assert.equal(manifest.schemas[0].path, '/schemas/execution/execution.receipt.schema.json');
  assert.ok(index.families.some((family) => family.family_id === 'execution' && family.manifest_path === '/schemas/execution/manifest.json'));
});
