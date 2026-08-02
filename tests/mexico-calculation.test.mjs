import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { mexicoAdapter } from '../js/countries/mexico-adapter.js';

const mexico = JSON.parse(await readFile(new URL('../data/mexico-research-v3.0.json', import.meta.url), 'utf8'));
const context = {
  calculation_date: '2026-08-01T08:00:00Z',
  engine_version: '7.0.2',
  fx: {
    base_currency: 'USD',
    rates: { EUR: 0.87, RUB: 80, ARS: 1350, MXN: 18 },
    source: 'test',
    as_of: '2026-08-01T00:00:00Z',
    max_age_hours: 96,
  },
};

function income(type, amount = 5000, sourceCountry = 'US', historyMonths = 6) {
  return {
    owner: 'APPLICANT',
    type,
    source_country: sourceCountry,
    bank_country: 'GE',
    monthly_total: { amount, currency: 'USD' },
    monthly_provable: { amount, currency: 'USD' },
    evidence_level: 'FULL',
    history_months: historyMonths,
  };
}

function profile(overrides = {}) {
  return {
    schema_version: 'user-profile-v1',
    citizenships: ['RU'],
    residence: { current_country: 'RU', current_status: 'CITIZENSHIP' },
    application_preferences: { methods: ['RUSSIA', 'IN_COUNTRY_AFTER_ENTRY'] },
    family: { adults_count: 1, partner_included: false, relationship_type: null, children: [], school_needed: false },
    lgbt: { enabled: false, consent_for_personalization: false, family_recognition_relevant: null, safety_relevant: null },
    income: {
      primary: income('REMOTE_EMPLOYMENT'),
      has_additional_sources: false,
      additional_sources: [],
      partner: { has_income: false, sources: [] },
      savings: null,
    },
    goal: {
      long_term: 'PR_REQUIRED',
      physical_presence: 'MOST_OF_YEAR',
      language_exam_readiness: 'YES',
      keep_russian_citizenship: 'REQUIRED',
    },
    preferences: { monthly_budget: { amount: 3500, currency: 'USD' }, city_size: 'ANY', climate: ['ANY'] },
    pets: { types: ['NONE'], dogs: [], other_pet_notes: null },
    special_circumstances: ['NONE'],
    route_specific_answers: {},
    ...overrides,
  };
}

function calculate(candidate = profile(), ctx = context) {
  const result = calculateCountries(candidate, [mexico], ctx, () => mexicoAdapter);
  assert.deepEqual(result.errors, []);
  return result.results[0];
}

function route(result, routeId) {
  return result.routes.find((item) => item.routeId === routeId);
}

test('Mexico exposes exactly two publishable routes', () => {
  const result = calculate();
  assert.equal(result.country.countryId, 'MX');
  assert.equal(result.country.name, 'Мексика');
  assert.equal(result.country.resultCurrency, 'USD');
  assert.deepEqual(result.routes.map(({ routeId }) => routeId), [
    'MX_TEMP_ECONOMIC_SOLVENCY',
    'MX_TEMP_LOCAL_JOB_OFFER',
  ]);
  assert.equal(result.routes.some(({ routeId }) => routeId.startsWith('MX_FAMILY_')), false);
});

test('economic-solvency route accepts documented foreign income above the current MXN threshold', () => {
  const result = calculate();
  const economic = route(result, 'MX_TEMP_ECONOMIC_SOLVENCY');
  assert.equal(economic.routeStatus, 'SUITABLE');
  assert.ok(economic.thresholdUsd > 4400 && economic.thresholdUsd < 4500);
  assert.equal(economic.incomeUsd, 5000);
  assert.equal(result.bestRoute.routeId, 'MX_TEMP_ECONOMIC_SOLVENCY');
});

test('economic-solvency route rejects income below the threshold', () => {
  const candidate = profile();
  candidate.income.primary = income('REMOTE_EMPLOYMENT', 3000, 'US', 6);
  const economic = route(calculate(candidate), 'MX_TEMP_ECONOMIC_SOLVENCY');
  assert.equal(economic.routeStatus, 'UNSUITABLE');
  assert.ok(economic.blockers.some((message) => message.includes('финансовое основание')));
});

test('economic-solvency route remains unsuitable below the threshold even when the applicant plans to raise income', () => {
  const candidate = profile();
  candidate.income.primary = income('REMOTE_EMPLOYMENT', 3000, 'US', 3);
  candidate.route_specific_answers = {
    MX_TEMP_ECONOMIC_SOLVENCY: { ready_to_raise_income: true },
  };
  const economic = route(calculate(candidate), 'MX_TEMP_ECONOMIC_SOLVENCY');
  assert.equal(economic.routeStatus, 'UNSUITABLE');
  assert.ok(economic.blockers.some((message) => message.includes('финансовое основание')));
});

test('savings satisfy the official alternative after a twelve-month average-balance history', () => {
  const candidate = profile();
  candidate.income.primary = income('PENSION', 500, 'RU', 6);
  candidate.income.savings = { amount: 80000, currency: 'USD' };
  candidate.route_specific_answers = {
    MX_TEMP_ECONOMIC_SOLVENCY: { savings_history_months: 12 },
  };
  const economic = route(calculate(candidate), 'MX_TEMP_ECONOMIC_SOLVENCY');
  assert.equal(economic.routeStatus, 'SUITABLE');
  assert.match(economic.checks.find(({ code }) => code === 'economic_savings_confirmed').message, /накопления/i);
});

test('a Mexican salary belongs to the local-job route rather than economic solvency', () => {
  const candidate = profile();
  candidate.income.primary = income('REMOTE_EMPLOYMENT', 2500, 'MX', 6);
  const result = calculate(candidate);
  assert.equal(route(result, 'MX_TEMP_ECONOMIC_SOLVENCY').routeStatus, 'UNSUITABLE');
  assert.equal(route(result, 'MX_TEMP_LOCAL_JOB_OFFER').routeStatus, 'SUITABLE');
  assert.equal(result.bestRoute.routeId, 'MX_TEMP_LOCAL_JOB_OFFER');
});

test('foreign active work produces a clear condition to obtain a Mexican offer', () => {
  const job = route(calculate(), 'MX_TEMP_LOCAL_JOB_OFFER');
  assert.equal(job.routeStatus, 'SUITABLE_WITH_CONDITIONS');
  assert.ok(job.actions.some((action) => action.includes('работодателя в Мексике')));
});

test('passive-only profile does not invent readiness for a local job', () => {
  const candidate = profile();
  candidate.income.primary = income('PASSIVE_INCOME', 7000, 'RU', 6);
  const job = route(calculate(candidate), 'MX_TEMP_LOCAL_JOB_OFFER');
  assert.equal(job.routeStatus, 'UNSUITABLE');
});

test('family documents remain filing requirements and do not lower route status', () => {
  const candidate = profile({
    family: {
      adults_count: 2,
      partner_included: true,
      relationship_type: 'UNREGISTERED_PARTNER',
      children: [{ age_years: 9 }],
      school_needed: true,
    },
  });
  const economic = route(calculate(candidate), 'MX_TEMP_ECONOMIC_SOLVENCY');
  assert.equal(economic.routeStatus, 'SUITABLE');
  assert.equal(economic.conditions.length, 0);
  assert.ok(economic.initialPermitRequirements.some((action) => action.includes('апостиль')));
  assert.ok(economic.initialPermitRequirements.some((action) => action.includes('concubinato')));
});

test('Mexico exposes researched cities, schools, pets, LGBT data and long-term texts', () => {
  const candidate = profile({
    family: { adults_count: 2, partner_included: true, relationship_type: 'MARRIAGE', children: [{ age_years: 8 }], school_needed: true },
    lgbt: { enabled: true, consent_for_personalization: true, family_recognition_relevant: true, safety_relevant: true },
    pets: { types: ['DOG'], dogs: [{ breed: 'Метис' }], other_pet_notes: null },
  });
  const result = calculate(candidate);
  const economic = route(result, 'MX_TEMP_ECONOMIC_SOLVENCY');
  assert.deepEqual(result.cities.map(({ cityName }) => cityName), ['Мерида', 'Вальядолид (Юкатан)', 'Гвадалахара', 'Мехико']);
  assert.deepEqual(result.cities.map(({ costUsd }) => costUsd), [2900, 3000, 3060, 3700]);
  assert.match(result.schoolSummary, /Eton School Mexico/);
  assert.match(result.petSummary, /Certificado Zoosanitario/);
  assert.equal(result.lgbt.safety.tone, 'caution');
  assert.match(result.lgbt.rows[0][1], /всех 32 субъектах/);
  assert.match(economic.longTerm.pr_path_ru, /4 последовательных лет/);
  assert.match(economic.longTerm.citizenship_path_ru, /5 непосредственных лет/);
  assert.match(economic.longTerm.dual_citizenship_ru, /множественную национальность/);
});

test('missing or stale MXN rate fails with a typed country error', () => {
  const missing = structuredClone(context);
  delete missing.fx.rates.MXN;
  const missingResult = calculateCountries(profile(), [mexico], missing, () => mexicoAdapter);
  assert.equal(missingResult.errors[0].code, 'CALCULATION_CONTEXT_INCOMPLETE');
  assert.match(missingResult.errors[0].message, /MXN/);

  const stale = structuredClone(context);
  stale.calculation_date = '2026-08-10T00:00:00Z';
  const staleResult = calculateCountries(profile(), [mexico], stale, () => mexicoAdapter);
  assert.equal(staleResult.errors[0].code, 'CALCULATION_CONTEXT_INCOMPLETE');
});

test('all Mexico outcomes use only the public three-status contract', () => {
  const allowed = new Set(['SUITABLE', 'SUITABLE_WITH_CONDITIONS', 'UNSUITABLE']);
  for (const evaluated of calculate().routes) {
    assert.ok(allowed.has(evaluated.routeStatus));
    assert.ok(evaluated.checks.length > 0);
  }
});

test('public matcher loads Mexico, its adapter, its flag and researched cities', async () => {
  const [app, fx] = await Promise.all([
    readFile(new URL('../matcher/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../pilot/fx-context.js', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /mexico-adapter\.js\?v=7\.0\.2/);
  assert.match(app, /mexico-research-v3\.0\.json\?v=7\.0\.2/);
  assert.match(app, /countryId === 'MX' \? '🇲🇽'/);
  assert.match(app, /\['AR', 'PY', 'PT', 'MX', 'BR'\]\.includes\(countryId\)/);
  assert.match(fx, /quotes=EUR,ARS,MXN,BRL/);
  assert.match(fx, /\['EUR', 'ARS', 'MXN', 'BRL'\]/);
});
