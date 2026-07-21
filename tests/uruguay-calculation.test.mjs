import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { spainAdapter } from '../js/countries/spain-adapter.js';

const spain = JSON.parse(await readFile(new URL('../data/spain-research-v2.2.json', import.meta.url), 'utf8'));
const uruguay = JSON.parse(await readFile(new URL('../data/uruguay-research-v2.2.json', import.meta.url), 'utf8'));
const samples = JSON.parse(await readFile(new URL('./fixtures/universal-profile-samples-v1.json', import.meta.url), 'utf8'));
const context = { calculation_date: '2026-07-19T12:00:00Z', engine_version: '2.2.0', fx: { base_currency: 'USD', rates: { EUR: 0.86, RUB: 80, UYU: 39.7 }, source: 'test', as_of: '2026-07-19T00:00:00Z', max_age_hours: 96 } };

function remoteProfile() {
  const profile = structuredClone(samples[0]);
  profile.citizenships = ['RU'];
  profile.residence = { current_country: 'RU', current_status: 'CITIZENSHIP' };
  profile.application_preferences = { methods: ['IN_COUNTRY_AFTER_ENTRY'] };
  profile.family = { adults_count: 1, partner_included: false, relationship_type: null, children: [], school_needed: false };
  profile.lgbt = { enabled: false, consent_for_personalization: false };
  profile.income.primary.type = 'REMOTE_EMPLOYMENT';
  profile.income.primary.monthly_provable = { amount: 4000, currency: 'USD' };
  profile.goal = { long_term: 'TEMPORARY_RESIDENCE_SUFFICIENT', physical_presence: 'MOST_OF_YEAR', language_exam_readiness: null, keep_russian_citizenship: 'DESIRABLE' };
  profile.preferences.monthly_budget = { amount: 5000, currency: 'USD' };
  profile.preferences.city_size = 'ANY';
  profile.route_specific_answers = {};
  return profile;
}

test('one profile returns independent Spain and Uruguay calculations', () => {
  const result = calculateCountries(remoteProfile(), [spain, uruguay], context, () => spainAdapter);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.results.map(({ country }) => country.countryId), ['ES', 'UY']);
  assert.equal(result.results[1].bestRoute.routeId, 'UY_DIGITAL_NOMAD');
  assert.equal(result.results[1].bestRoute.routeStatus, 'SUITABLE_WITH_CONDITIONS');
});

test('Uruguay digital nomad does not invent a fixed minimum income', () => {
  const result = calculateCountries(remoteProfile(), [uruguay], context, () => spainAdapter).results[0];
  assert.equal(result.bestRoute.thresholdEur, null);
  assert.ok(result.bestRoute.conditions.some((item) => item.includes('декларацию')));
  assert.match(result.bestRoute.incomeGuidance, /25 383 UYU/);
  assert.match(result.bestRoute.incomeGuidance, /640 USD/);
  assert.match(result.bestRoute.incomeGuidance, /650 USD/);
  assert.match(result.bestRoute.incomeExampleSource.url, /expat\.com/);
});

test('Uruguay cards distinguish direct permanent, temporary, and nomad routes', () => {
  const result = calculateCountries(remoteProfile(), [uruguay], context, () => spainAdapter).results[0];
  const guidance = Object.fromEntries(result.routes.map((route) => [route.routeId, route.applicationGuidance]));
  assert.match(guidance.UY_PERMANENT, /временная резиденция перед ней не обязательна/);
  assert.match(guidance.UY_TEMPORARY, /не обязательная ступень/);
  assert.match(guidance.UY_DIGITAL_NOMAD, /автоматического перехода нет/);
});

test('Uruguay recognizes a same-sex concubine partner with judicial evidence', () => {
  const profile = remoteProfile();
  profile.family = { adults_count: 2, partner_included: true, relationship_type: 'UNREGISTERED_PARTNER', children: [], school_needed: false };
  profile.lgbt = { enabled: true, consent_for_personalization: true };
  const result = calculateCountries(profile, [uruguay], context, () => spainAdapter).results[0];
  const permanent = result.routes.find((route) => route.routeId === 'UY_PERMANENT');
  assert.equal(permanent.checks.some((check) => check.code === 'relationship_rule_unknown'), false);
  assert.equal(permanent.checks.some((check) => check.code === 'same_sex_family_rule_unknown'), false);
  assert.ok(permanent.conditions.some((condition) => condition.includes('судебного признания')));
});

test('Uruguay package contains only routes available to a Russian-citizenship MVP', () => {
  assert.deepEqual(uruguay.routes.map(({ route_id }) => route_id), ['UY_PERMANENT', 'UY_TEMPORARY', 'UY_DIGITAL_NOMAD']);
  assert.ok(uruguay.sources.filter(({ official }) => official === 'YES').length >= 5);
});
