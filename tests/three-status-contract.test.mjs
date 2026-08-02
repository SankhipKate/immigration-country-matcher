import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { argentinaAdapter } from '../js/countries/argentina-adapter.js';
import { paraguayAdapter } from '../js/countries/paraguay-adapter.js';
import { portugalAdapter } from '../js/countries/portugal-adapter.js';
import { spainAdapter } from '../js/countries/spain-adapter.js';
import {
  COUNTRY_GROUP_LABELS_RU,
  ROUTE_STATUSES,
  STATUS_LABELS_RU,
  resolveStatusConflict,
} from '../js/engine/status-contract.js';

const [spain, uruguay, argentina, paraguay, portugal] = await Promise.all([
  readFile(new URL('../data/spain-research-v2.2.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/uruguay-research-v2.2.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/argentina-research-v3.0.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/paraguay-research-v3.0.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/portugal-research-v3.0.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const context = {
  calculation_date: '2026-07-24T12:00:00Z',
  engine_version: '7.0.2',
  fx: {
    base_currency: 'USD',
    rates: { EUR: 0.87, ARS: 1000, RUB: 80, UYU: 40 },
    source: 'test',
    as_of: '2026-07-24T00:00:00Z',
    max_age_hours: 96,
  },
};

function profile() {
  return {
    schema_version: 'user-profile-v1',
    citizenships: ['RU'],
    residence: { current_country: 'RU', current_status: 'CITIZENSHIP' },
    application_preferences: { methods: ['RUSSIA', 'IN_COUNTRY_AFTER_ENTRY'] },
    family: { adults_count: 1, partner_included: false, relationship_type: null, children: [], school_needed: false },
    lgbt: { enabled: false, consent_for_personalization: false, family_recognition_relevant: null, safety_relevant: null },
    income: {
      primary: {
        owner: 'APPLICANT',
        type: 'REMOTE_EMPLOYMENT',
        source_country: 'US',
        bank_country: 'GE',
        monthly_total: { amount: 4000, currency: 'USD' },
        monthly_provable: { amount: 4000, currency: 'USD' },
        evidence_level: 'FULL',
      },
      has_additional_sources: false,
      additional_sources: [],
      partner: { has_income: false, sources: [] },
      savings: null,
    },
    goal: {
      long_term: 'TEMPORARY_RESIDENCE_SUFFICIENT',
      physical_presence: 'DEPENDS_ON_COUNTRY',
      language_exam_readiness: 'DEPENDS_ON_LANGUAGE',
      keep_russian_citizenship: 'NOT_IMPORTANT',
    },
    preferences: { monthly_budget: { amount: 2500, currency: 'USD' }, city_size: 'ANY', climate: ['ANY'] },
    pets: { types: ['NONE'], dogs: [], other_pet_notes: null },
    special_circumstances: ['NONE'],
    route_specific_answers: {},
  };
}

const allowed = new Set(['SUITABLE', 'SUITABLE_WITH_CONDITIONS', 'UNSUITABLE']);

test('engine exports exactly the three agreed route and country statuses', () => {
  assert.deepEqual(new Set(Object.values(ROUTE_STATUSES)), allowed);
  assert.deepEqual(new Set(Object.keys(STATUS_LABELS_RU)), allowed);
  assert.deepEqual(new Set(Object.keys(COUNTRY_GROUP_LABELS_RU)), allowed);
  assert.equal(resolveStatusConflict([]), 'SUITABLE_WITH_CONDITIONS');
});

test('Spain, Uruguay, Argentina, Paraguay, and Portugal return only the three agreed statuses', () => {
  const result = calculateCountries(
    profile(),
    [spain, uruguay, argentina, paraguay, portugal],
    context,
    (countryPackage) => {
      if (countryPackage.country_id === 'AR') return argentinaAdapter;
      if (countryPackage.country_id === 'PY') return paraguayAdapter;
      if (countryPackage.country_id === 'PT') return portugalAdapter;
      return spainAdapter;
    },
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.results.map(({ country }) => country.countryId), ['ES', 'UY', 'AR', 'PY', 'PT']);
  for (const country of result.results) {
    assert.ok(allowed.has(country.country.group), `${country.country.countryId}: invalid country group ${country.country.group}`);
    assert.equal(country.country.groupLabel, COUNTRY_GROUP_LABELS_RU[country.country.group]);
    assert.ok(country.routes.length > 0);
    for (const route of country.routes) {
      assert.ok(allowed.has(route.routeStatus), `${route.routeId}: invalid route status ${route.routeStatus}`);
      assert.equal(route.statusLabel, STATUS_LABELS_RU[route.routeStatus]);
    }
  }
});

test('current location does not block routes that allow filing after entry', () => {
  const input = profile();
  input.application_preferences.methods = ['RUSSIA'];
  const result = calculateCountries(
    input,
    [spain, uruguay, argentina, paraguay, portugal],
    context,
    (countryPackage) => {
      if (countryPackage.country_id === 'AR') return argentinaAdapter;
      if (countryPackage.country_id === 'PY') return paraguayAdapter;
      if (countryPackage.country_id === 'PT') return portugalAdapter;
      return spainAdapter;
    },
  );
  assert.deepEqual(result.errors, []);
  const byCountry = Object.fromEntries(result.results.map((country) => [country.country.countryId, country]));
  assert.equal(byCountry.ES.routes.find((route) => route.routeId === 'ES_DNV').applicationFit, 'MEETS');
  assert.equal(byCountry.UY.routes.find((route) => route.routeId === 'UY_PERMANENT').applicationFit, 'MEETS');
  assert.equal(byCountry.AR.routes.find((route) => route.routeId === 'AR_NOMAD').applicationFit, 'MEETS');
  const paraguayTemporary = byCountry.PY.routes.find((route) => route.routeId === 'PY_TEMPORARY');
  assert.equal(paraguayTemporary.applicationFit, 'MEETS');
  assert.equal(paraguayTemporary.routeStatus, 'SUITABLE');
  assert.equal(byCountry.PT.routes.find((route) => route.routeId === 'PT_D8_REMOTE').applicationFit, 'MEETS');
});

test('runtime and legacy research schema contain no retired status names', async () => {
  const paths = [
    '../js/engine/status-contract.js',
    '../js/countries/spain-adapter.js',
    '../js/countries/argentina-adapter.js',
    '../js/countries/paraguay-adapter.js',
    '../js/countries/portugal-adapter.js',
    '../matcher/profile.js',
    '../matcher/app.js',
    '../pilot/app.js',
    '../data/research-package-v2.2.schema.json',
  ];
  const text = (await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
  for (const retired of ['PRELIMINARY_SUITABLE', 'INSUFFICIENT_COUNTRY_DATA', 'INDIVIDUAL_REVIEW_REQUIRED']) {
    assert.equal(text.includes(retired), false, `${retired} remains in runtime`);
  }
  assert.equal(text.includes('Предварительно подходит'), false);
  assert.equal(text.includes('Предварительный результат'), false);
});
