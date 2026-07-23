import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountry } from '../js/engine/calculate-country.js';
import { loadCalculationContext } from '../pilot/fx-context.js';
import { selectBestVariant } from '../js/engine/select-best-route.js';

const context = { calculation_date: '2026-07-19T12:00:00Z', engine_version: '2.1.0', fx: { base_currency: 'USD', rates: { EUR: 0.87 }, source: 'test', as_of: '2026-07-19T00:00:00Z', max_age_hours: 96 } };
const variantAdapter = {
  normalizeProfile: (profile) => ({ ...profile }), validateContext() {}, buildIndexes: () => ({}),
  evaluateRoute: (route, indexes, profile) => ({ routeId: route.route_id, routeStatus: route.status[profile.applicationNationality], applicationNationality: profile.applicationNationality, viaSecondaryNationality: profile.applicationNationality !== 'RU', goalFit: 'MEETS', applicationFit: 'MEETS', familyFit: 'MEETS', incomeTypeFit: 'MEETS', incomeFit: 'MEETS', countryMissingCount: 0, clientMissingCount: 0, conditionsCount: 0 }),
  evaluatePractical: () => ({ cities: [], recommendedCity: null }), determineCountryGroup: () => 'SUITABLE', collectSources: () => [],
};
const pkg = { schema_version: 'test', country: { country_id: 'XX', name_ru: 'Test' }, routes: [{ route_id: 'R1', status: { RU: 'UNSUITABLE', AR: 'SUITABLE' } }, { route_id: 'R2', status: { RU: 'SUITABLE', AR: 'SUITABLE' } }] };

test('each route keeps one variant for every citizenship and secondary can win', () => {
  const result = calculateCountry({ citizenships: ['RU', 'AR'] }, pkg, context, variantAdapter);
  assert.equal(result.routes.every((route) => route.citizenshipVariants.length === 2), true);
  assert.equal(result.routes[0].applicationNationality, 'AR');
  assert.equal(result.routes[0].viaSecondaryNationality, true);
});

test('RU wins a fully equal citizenship tie', () => {
  const best = selectBestVariant([{ routeId: 'R', routeStatus: 'SUITABLE', applicationNationality: 'AR' }, { routeId: 'R', routeStatus: 'SUITABLE', applicationNationality: 'RU' }]);
  assert.equal(best.applicationNationality, 'RU');
});

test('strict profile without citizenships returns typed error', () => {
  assert.throws(() => calculateCountry({}, pkg, context, variantAdapter), { code: 'PROFILE_INCOMPLETE' });
});

test('valid mocked ECB response creates calculation context', async () => {
  const result = await loadCalculationContext({ now: new Date('2026-07-19T12:00:00Z'), fetchImpl: async () => ({ ok: true, json: async () => [{ date: '2026-07-19', base: 'USD', quote: 'EUR', rate: 0.87 }] }) });
  assert.equal(result.fx.rates.EUR, 0.87);
  assert.equal(result.fx.source, 'Frankfurter / ECB');
});

test('network failure is typed as incomplete calculation context', async () => {
  await assert.rejects(loadCalculationContext({ fetchImpl: async () => { throw new Error('offline'); } }), { code: 'CALCULATION_CONTEXT_INCOMPLETE' });
});

test('stale mocked rate is rejected', async () => {
  await assert.rejects(loadCalculationContext({ now: new Date('2026-07-19T12:00:00Z'), fetchImpl: async () => ({ ok: true, json: async () => [{ date: '2026-07-01', quote: 'EUR', rate: 0.87 }] }) }), { code: 'CALCULATION_CONTEXT_INCOMPLETE' });
});

test('runtime and current pilot contain no removed constructs or user FX field', async () => {
  const files = ['../js/spain-calculator.js', '../js/countries/spain-adapter.js', '../js/engine/calculate-country.js', '../js/engine/select-best-route.js', '../pilot/app.js', '../pilot/index.html'];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  for (const token of ['BASIS' + '_ROUTE', 'basis' + '_mismatch', 'selection' + 'Score', 'eur' + 'UsdRate']) assert.equal(source.includes(token), false);
});

test('main pilot contains no social-security route-specific question', async () => {
  const source = `${await readFile(new URL('../pilot/index.html', import.meta.url), 'utf8')}\n${await readFile(new URL('../pilot/app.js', import.meta.url), 'utf8')}`;
  assert.equal(source.includes('social' + 'SecurityPlan'), false);
  assert.equal(source.includes('Как планируете подтвердить социальное страхование'), false);
});

test('public matcher gates the questionnaire behind Russian citizenship confirmation', async () => {
  const html = await readFile(new URL('../matcher/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../matcher/app.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('У вас есть гражданство РФ?') < html.indexOf('id="matcherForm"'));
  assert.match(html, /id="questionnaireView"[^>]*hidden/);
  assert.ok(html.includes('Для других гражданств эти сведения неприменимы.'));
  assert.ok(app.includes("$('#gateYes').addEventListener('click'"));
  assert.ok(app.includes("$('#gateNo').addEventListener('click'"));
  assert.equal(/дополнительн(?:ое|ые) гражданств/i.test(html), false);
});


test('result view uses the full page width and keeps edit action in the hero', async () => {
  const html = await readFile(new URL('../matcher/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../matcher/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="resultView" class="result-layout result-layout-single"/);
  assert.ok(html.indexOf('id="editProfile"') < html.indexOf('id="resultView"'));
  assert.equal(html.includes('Что дальше'), false);
  assert.ok(app.includes("$('#editProfile').hidden = false"));
  assert.ok(app.includes("$('#editProfile').hidden = true"));
});
