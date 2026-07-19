import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountry, CalculationContextError } from '../js/engine/calculate-country.js';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { selectBestRoute } from '../js/engine/select-best-route.js';

const context = {
  calculation_date: '2026-07-19', engine_version: '1.0.0',
  fx: { base_currency: 'USD', rates: { EUR: 0.86, UYU: 39.7 }, source: 'test', as_of: '2026-07-19T00:00:00Z', max_age_hours: 48 },
};

const route = (routeId, routeStatus = 'SUITABLE', overrides = {}) => ({
  routeId, routeName: routeId, routeStatus, goalFit: 'MEETS', applicationFit: 'MEETS', familyFit: 'MEETS',
  incomeTypeFit: 'MEETS', incomeFit: 'MEETS', countryMissingCount: 0, clientMissingCount: 0,
  conditionsCount: 0, scenarioAffinity: 0, checks: [], blockers: [], conditions: [], missing: [], preliminary: [], review: [], ...overrides,
});

const adapter = {
  id: 'synthetic', normalizeProfile: (profile) => ({ ...profile }), validateContext() {}, buildIndexes: () => ({}),
  evaluateRoute: (item) => route(item.route_id, item.status, item.evaluation),
  evaluatePractical: () => ({ cities: [], recommendedCity: null }),
  determineCountryGroup: (best) => best?.routeStatus === 'UNSUITABLE' ? 'UNSUITABLE' : 'SUITABLE',
  collectSources: () => [], collectPracticalMissing: () => [],
};
const packageFor = (countryId, routes = [{ route_id: `${countryId}_A`, status: 'SUITABLE' }]) => ({
  schema_version: 'test', country: { country_id: countryId, name_ru: countryId }, routes,
});

test('calculateCountry supports a synthetic UY package', () => {
  const result = calculateCountry({}, packageFor('UY'), context, adapter);
  assert.equal(result.country.countryId, 'UY');
  assert.equal(result.bestRoute.routeId, 'UY_A');
});

test('an alternative suitable route beats the assumed unsuitable route', () => {
  const result = calculateCountry({}, packageFor('UY', [
    { route_id: 'UY_A', status: 'UNSUITABLE', evaluation: { scenarioAffinity: 1 } },
    { route_id: 'UY_B', status: 'SUITABLE' },
  ]), context, adapter);
  assert.equal(result.bestRoute.routeId, 'UY_B');
});

test('scenario affinity cannot beat a better legal status', () => {
  assert.equal(selectBestRoute([route('A', 'UNSUITABLE', { scenarioAffinity: 1 }), route('B', 'SUITABLE')]).routeId, 'B');
});

test('goal fit decides between otherwise equal statuses', () => {
  assert.equal(selectBestRoute([route('A', 'SUITABLE', { goalFit: 'DOES_NOT_MEET', scenarioAffinity: 1 }), route('B')]).routeId, 'B');
});

test('scenario affinity is used only on complete structural equality', () => {
  assert.equal(selectBestRoute([route('A'), route('B', 'SUITABLE', { scenarioAffinity: 1 })]).routeId, 'B');
});

test('missing exchange rate raises a typed context error', () => {
  const fxAdapter = { ...adapter, validateContext(profile, pkg, ctx) { if (!ctx.fx?.rates?.EUR) throw new CalculationContextError('missing EUR'); } };
  assert.throws(() => calculateCountry({}, packageFor('UY'), { ...context, fx: { ...context.fx, rates: {} } }, fxAdapter), { code: 'CALCULATION_CONTEXT_INCOMPLETE' });
});

test('calculateCountries returns two successful synthetic countries', () => {
  const result = calculateCountries({}, [packageFor('AA'), packageFor('BB')], context, () => adapter);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.errors, []);
});

test('one country error does not destroy another result', () => {
  const result = calculateCountries({}, [packageFor('OK'), packageFor('BAD')], context, (pkg) => pkg.country.country_id === 'BAD'
    ? { ...adapter, validateContext() { throw new CalculationContextError('missing context'); } } : adapter);
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.errors.map(({ countryId, code }) => ({ countryId, code })), [{ countryId: 'BAD', code: 'CALCULATION_CONTEXT_INCOMPLETE' }]);
});

test('runtime contains none of the removed route-forcing constructs', async () => {
  const files = ['../js/spain-calculator.js', '../js/countries/spain-adapter.js', '../js/countries/spain-rules.js', '../js/engine/calculate-country.js', '../js/engine/select-best-route.js'];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  const forbidden = ['BASIS' + '_ROUTE', 'basis' + '_mismatch', 'selection' + 'Score'];
  for (const token of forbidden) assert.equal(source.includes(token), false);
});

test('generic orchestrator contains no country-specific identifiers', async () => {
  const source = await readFile(new URL('../js/engine/calculate-country.js', import.meta.url), 'utf8');
  for (const token of ['ES_' + 'DNV', 'ES_' + 'NLV', 'Spain', 'Испания', 'Seguridad' + ' Social']) assert.equal(source.includes(token), false);
});
