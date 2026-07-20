import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dataDir = new URL('../data/', import.meta.url);
const schema = JSON.parse(await readFile(new URL('research-package-v2.2.schema.json', dataDir), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const packageFiles = (await readdir(dataDir)).filter((name) => name.endsWith('-research-v2.2.json')).sort();

test('every research package satisfies the strict v2.2 JSON Schema', async () => {
  assert.ok(packageFiles.length >= 2, 'Expected at least two country research packages');
  const failures = [];
  for (const file of packageFiles) {
    const data = JSON.parse(await readFile(new URL(file, dataDir), 'utf8'));
    if (!validate(data)) {
      failures.push(`${file}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n\n'));
});
