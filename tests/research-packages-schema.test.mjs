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

test('every country has large, medium, and small city budget coverage', async () => {
  for (const file of packageFiles) {
    const data = JSON.parse(await readFile(new URL(file, dataDir), 'utf8'));
    const categories = new Set(data.cities.map(({ population_category }) => population_category));
    assert.deepEqual([...['LARGE', 'MEDIUM', 'SMALL'].filter((category) => !categories.has(category))], [], `${file}: missing city-size coverage`);
    for (const city of data.cities) {
      assert.ok(city.estimated_monthly_cost_single_usd > 0, `${file}/${city.city_id}: single budget missing`);
      assert.ok(city.estimated_monthly_cost_couple_usd > 0, `${file}/${city.city_id}: couple budget missing`);
      assert.ok(city.estimated_monthly_cost_family_1_child_usd > 0, `${file}/${city.city_id}: family budget missing`);
      assert.ok(city.primary_source_id, `${file}/${city.city_id}: source missing`);
      assert.ok(city.last_verified_at, `${file}/${city.city_id}: verification date missing`);
    }
  }
});

test('every researched city has a public-school record', async () => {
  for (const file of packageFiles) {
    const data = JSON.parse(await readFile(new URL(file, dataDir), 'utf8'));
    for (const city of data.cities) {
      assert.ok(data.schools.some((school) => school.city_id === city.city_id && school.school_type === 'PUBLIC'), `${file}/${city.city_id}: public-school research missing`);
    }
  }
});

test('every country has concrete city temperatures and complete LGBT research', async () => {
  const requiredLgbtTopics = [
    'SAME_SEX_MARRIAGE', 'UNREGISTERED_PARTNER', 'PARENTHOOD_AND_CHILDREN', 'ANTI_DISCRIMINATION',
    'GENDER_IDENTITY', 'HATE_CRIME', 'CONVERSION_PRACTICES', 'PRACTICAL_SAFETY',
  ];
  for (const file of packageFiles) {
    const data = JSON.parse(await readFile(new URL(file, dataDir), 'utf8'));
    for (const city of data.cities) {
      assert.equal(typeof city.avg_temp_coldest_month_c, 'number', `${file}/${city.city_id}: coldest-month temperature missing`);
      assert.equal(typeof city.avg_temp_hottest_month_c, 'number', `${file}/${city.city_id}: hottest-month temperature missing`);
      assert.ok(city.avg_temp_hottest_month_c > city.avg_temp_coldest_month_c, `${file}/${city.city_id}: temperature range is invalid`);
      assert.ok(city.climate_source_id, `${file}/${city.city_id}: climate source missing`);
      assert.ok(data.sources.some(({ source_id }) => source_id === city.climate_source_id), `${file}/${city.city_id}: climate source does not exist`);
    }
    const topics = new Set(data.lgbt_rules.map(({ topic }) => topic));
    assert.deepEqual(requiredLgbtTopics.filter((topic) => !topics.has(topic)), [], `${file}: incomplete LGBT research`);
    for (const rule of data.lgbt_rules) {
      assert.ok(rule.notes, `${file}/${rule.lgbt_rule_id}: user-facing explanation missing`);
      assert.ok(rule.source_id, `${file}/${rule.lgbt_rule_id}: source missing`);
      assert.ok(data.sources.some(({ source_id }) => source_id === rule.source_id), `${file}/${rule.lgbt_rule_id}: source does not exist`);
      assert.ok(rule.last_verified_at, `${file}/${rule.lgbt_rule_id}: verification date missing`);
    }
  }
});
