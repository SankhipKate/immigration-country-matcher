import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { brazilAdapter } from '../js/countries/brazil-adapter.js';

const brazil = JSON.parse(await readFile(new URL('../data/brazil-research-v3.0.json', import.meta.url), 'utf8'));

const context = {
  calculation_date: '2026-08-01T08:00:00Z',
  engine_version: '7.0.2',
  fx: {
    base_currency: 'USD',
    rates: { EUR: 0.87, ARS: 1350, MXN: 18, BRL: 5.5, RUB: 80, UYU: 40 },
    source: 'test',
    as_of: '2026-08-01T00:00:00Z',
    max_age_hours: 96,
  },
};

function incomeSource({ type = 'REMOTE_EMPLOYMENT', sourceCountry = 'US', bankCountry = 'GE', amount = 2000, currency = 'USD' } = {}) {
  return {
    owner: 'APPLICANT',
    type,
    source_country: sourceCountry,
    bank_country: bankCountry,
    monthly_total: { amount, currency },
    monthly_provable: { amount, currency },
    evidence_level: 'FULL',
  };
}

function profile(overrides = {}) {
  const result = {
    schema_version: 'user-profile-v1',
    citizenships: ['RU'],
    residence: { current_country: 'RU', current_status: 'CITIZENSHIP' },
    application_preferences: { methods: ['RUSSIA', 'IN_COUNTRY_AFTER_ENTRY'] },
    family: { adults_count: 1, partner_included: false, relationship_type: null, children: [], school_needed: false },
    lgbt: { enabled: false, consent_for_personalization: false, family_recognition_relevant: null, safety_relevant: null },
    income: {
      primary: incomeSource(),
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
  return {
    ...result,
    ...overrides,
    residence: { ...result.residence, ...(overrides.residence || {}) },
    application_preferences: { ...result.application_preferences, ...(overrides.application_preferences || {}) },
    family: { ...result.family, ...(overrides.family || {}) },
    lgbt: { ...result.lgbt, ...(overrides.lgbt || {}) },
    income: { ...result.income, ...(overrides.income || {}) },
    goal: { ...result.goal, ...(overrides.goal || {}) },
    preferences: { ...result.preferences, ...(overrides.preferences || {}) },
    pets: { ...result.pets, ...(overrides.pets || {}) },
    route_specific_answers: { ...result.route_specific_answers, ...(overrides.route_specific_answers || {}) },
  };
}

function calculate(input = profile(), ctx = context) {
  const result = calculateCountries(input, [brazil], ctx, () => brazilAdapter);
  assert.deepEqual(result.errors, []);
  return result.results[0];
}

function route(result, routeId) {
  return result.routes.find(({ routeId: id }) => id === routeId);
}

test('Brazil calculation exposes all eight researched routes', () => {
  const result = calculate();
  assert.equal(result.country.countryId, 'BR');
  assert.equal(result.country.name, 'Бразилия');
  assert.deepEqual(result.routes.map(({ routeId }) => routeId), [
    'BR_DIGITAL_NOMAD',
    'BR_RETIREMENT',
    'BR_LOCAL_EMPLOYMENT',
    'BR_BRAZIL_GRADUATE_WORK',
    'BR_STUDY',
    'BR_FAMILY_REUNIFICATION',
    'BR_PRODUCTIVE_INVESTOR',
    'BR_REAL_ESTATE_INVESTOR',
  ]);
});

test('digital nomad is suitable for documented foreign remote income above 1,500 USD', () => {
  const result = calculate(profile({ income: { primary: incomeSource({ amount: 1700 }) } }));
  const nomad = route(result, 'BR_DIGITAL_NOMAD');
  assert.equal(nomad.routeStatus, 'SUITABLE');
  assert.equal(nomad.thresholdUsd, 1500);
  assert.equal(nomad.incomeUsd, 1700);
  assert.equal(result.bestRoute.routeId, 'BR_DIGITAL_NOMAD');
});

test('digital nomad accepts the 18,000 USD savings alternative', () => {
  const input = profile({
    income: { primary: incomeSource({ amount: 800 }), savings: { amount: 20000, currency: 'USD' } },
  });
  const nomad = route(calculate(input), 'BR_DIGITAL_NOMAD');
  assert.equal(nomad.routeStatus, 'SUITABLE');
  assert.ok(nomad.checks.some(({ code }) => code === 'brazil_nomad_savings_met'));
});

test('digital nomad is unsuitable below both financial alternatives even when readiness flags are true', () => {
  const input = profile({
    income: { primary: incomeSource({ amount: 1000 }), savings: { amount: 5000, currency: 'USD' } },
    route_specific_answers: {
      BR_DIGITAL_NOMAD: { ready_to_raise_income: true, ready_to_build_savings: true },
    },
  });
  const nomad = route(calculate(input), 'BR_DIGITAL_NOMAD');
  assert.equal(nomad.routeStatus, 'UNSUITABLE');
  assert.ok(nomad.checks.some(({ code }) => code === 'brazil_nomad_finance_below_threshold'));
});

test('digital nomad does not treat a Brazilian employer as a foreign remote basis', () => {
  const input = profile({ income: { primary: incomeSource({ sourceCountry: 'BR', amount: 2500 }) } });
  const nomad = route(calculate(input), 'BR_DIGITAL_NOMAD');
  assert.equal(nomad.routeStatus, 'UNSUITABLE');
  assert.equal(nomad.incomeTypeFit, 'DOES_NOT_MEET');
});

test('Russian bank documents are a filing requirement and do not lower an otherwise qualifying nomad route', () => {
  const input = profile({ income: { primary: incomeSource({ bankCountry: 'RU', amount: 2000 }) } });
  const nomad = route(calculate(input), 'BR_DIGITAL_NOMAD');
  assert.equal(nomad.routeStatus, 'SUITABLE');
  assert.ok(nomad.initialPermitRequirements.some((item) => /консульств/i.test(item)));
  assert.equal(nomad.actions.some((item) => /консульств/i.test(item)), false);
});

test('retirement route requires a pension basis and accepts regular top-up income', () => {
  const input = profile({
    income: {
      primary: incomeSource({ type: 'PENSION', sourceCountry: 'RU', amount: 1400 }),
      has_additional_sources: true,
      additional_sources: [incomeSource({ type: 'PASSIVE_INCOME', sourceCountry: 'RU', amount: 700 })],
    },
  });
  const retirement = route(calculate(input), 'BR_RETIREMENT');
  assert.equal(retirement.routeStatus, 'SUITABLE');
  assert.equal(retirement.incomeUsd, 2100);
});

test('retirement route is unsuitable below 2,000 USD even when the profile says income may be added', () => {
  const input = profile({
    income: { primary: incomeSource({ type: 'PENSION', sourceCountry: 'RU', amount: 1500 }) },
    route_specific_answers: {
      BR_RETIREMENT: { ready_to_raise_income: true, ready_to_add_regular_income: true },
    },
  });
  const retirement = route(calculate(input), 'BR_RETIREMENT');
  assert.equal(retirement.routeStatus, 'UNSUITABLE');
  assert.ok(retirement.checks.some(({ code }) => code === 'brazil_retirement_income_below'));
});

test('local employment becomes suitable with a confirmed Brazilian offer', () => {
  const input = profile({ route_specific_answers: { BR_LOCAL_EMPLOYMENT: { local_job_offer_confirmed: true } } });
  const local = route(calculate(input), 'BR_LOCAL_EMPLOYMENT');
  assert.equal(local.routeStatus, 'SUITABLE');
  assert.equal(local.basisMissing, false);
});

test('Brazil graduate work requires a qualifying Brazilian degree and in-country filing', () => {
  const input = profile({
    residence: { current_country: 'BR', current_status: 'STUDENT_STATUS' },
    route_specific_answers: { BR_BRAZIL_GRADUATE_WORK: { brazil_degree_completed: true } },
  });
  const graduate = route(calculate(input), 'BR_BRAZIL_GRADUATE_WORK');
  assert.equal(graduate.routeStatus, 'SUITABLE');
});

test('Brazil graduate work remains suitable outside Brazil and lists the trip as an application requirement', () => {
  const input = profile({
    residence: { current_country: 'RU', current_status: 'CITIZENSHIP' },
    route_specific_answers: { BR_BRAZIL_GRADUATE_WORK: { brazil_degree_completed: true } },
  });
  const graduate = route(calculate(input), 'BR_BRAZIL_GRADUATE_WORK');
  assert.equal(graduate.routeStatus, 'SUITABLE');
  assert.ok(graduate.initialPermitRequirements.some((item) => /въехать|MigranteWeb/i.test(item)));
});

test('study route is suitable with admission and confirmed financial means', () => {
  const input = profile({
    route_specific_answers: { BR_STUDY: { admission_confirmed: true, study_funds_confirmed: true } },
  });
  const study = route(calculate(input), 'BR_STUDY');
  assert.equal(study.routeStatus, 'SUITABLE');
});

test('same-sex family link can use the family-reunification route', () => {
  const input = profile({
    family: { adults_count: 2, partner_included: true, relationship_type: 'MARRIAGE' },
    lgbt: { enabled: true, consent_for_personalization: true, family_recognition_relevant: true, safety_relevant: true },
    route_specific_answers: { BR_FAMILY_REUNIFICATION: { brazil_family_sponsor: true } },
  });
  const result = calculate(input);
  const family = route(result, 'BR_FAMILY_REUNIFICATION');
  assert.equal(family.routeStatus, 'SUITABLE');
  assert.equal(result.lgbt.enabled, true);
  assert.match(result.lgbt.rows[0][1], /однопол/i);
});

test('Brazil keeps an existing unregistered partnership suitable and lists união estável evidence as a filing requirement', () => {
  const input = profile({
    family: { adults_count: 2, partner_included: true, relationship_type: 'UNREGISTERED_PARTNER' },
  });
  const nomad = route(calculate(input), 'BR_DIGITAL_NOMAD');
  assert.equal(nomad.routeStatus, 'SUITABLE');
  assert.ok(nomad.initialPermitRequirements.some((item) => /união estável|совместной жизни/i.test(item)));
});

test('productive investment uses 500,000 BRL as the automatic standard threshold', () => {
  const input = profile({
    route_specific_answers: {
      BR_PRODUCTIVE_INVESTOR: { investment_capital_brl: 500000, investment_project_ready: true },
    },
  });
  const investor = route(calculate(input), 'BR_PRODUCTIVE_INVESTOR');
  assert.equal(investor.routeStatus, 'SUITABLE');
  assert.ok(Math.abs(investor.thresholdUsd - 500000 / 5.5) < 0.001);
});

test('productive investment keeps the 150,000 BRL innovation alternative conditional', () => {
  const input = profile({
    route_specific_answers: {
      BR_PRODUCTIVE_INVESTOR: { investment_capital_brl: 200000, innovation_project: true },
    },
  });
  const investor = route(calculate(input), 'BR_PRODUCTIVE_INVESTOR');
  assert.equal(investor.routeStatus, 'SUITABLE_WITH_CONDITIONS');
  assert.ok(investor.checks.some(({ code }) => code === 'brazil_productive_innovation_review'));
});

test('real-estate investment uses the reduced 700,000 BRL threshold in the Northeast', () => {
  const input = profile({
    route_specific_answers: {
      BR_REAL_ESTATE_INVESTOR: {
        real_estate_investment_brl: 700000,
        property_region: 'NORTHEAST',
        property_selected: true,
      },
    },
  });
  const investor = route(calculate(input), 'BR_REAL_ESTATE_INVESTOR');
  assert.equal(investor.routeStatus, 'SUITABLE');
  assert.ok(Math.abs(investor.thresholdUsd - 700000 / 5.5) < 0.001);
});

test('Brazil practical result includes five family-specific cities and a small city', () => {
  const input = profile({
    family: { adults_count: 2, partner_included: true, relationship_type: 'MARRIAGE', children: [{ age_years: 10 }], school_needed: true },
  });
  const result = calculate(input);
  assert.equal(result.cities.length, 5);
  assert.ok(result.cities.some(({ populationCategory }) => populationCategory === 'SMALL'));
  assert.ok(result.cities.every(({ costIsFamilySpecific, coldRange, hotRange }) => costIsFamilySpecific && coldRange && hotRange));
  assert.match(result.schoolSummary, /международн/i);
});

test('missing or stale BRL rate creates a typed country error', () => {
  const missing = structuredClone(context);
  delete missing.fx.rates.BRL;
  const missingResult = calculateCountries(profile(), [brazil], missing, () => brazilAdapter);
  assert.equal(missingResult.results.length, 0);
  assert.equal(missingResult.errors[0].code, 'CALCULATION_CONTEXT_INCOMPLETE');
  assert.match(missingResult.errors[0].message, /BRL/);

  const stale = structuredClone(context);
  stale.fx.as_of = '2026-07-01T00:00:00Z';
  const staleResult = calculateCountries(profile(), [brazil], stale, () => brazilAdapter);
  assert.equal(staleResult.results.length, 0);
  assert.equal(staleResult.errors[0].code, 'CALCULATION_CONTEXT_INCOMPLETE');
});

test('public matcher loads Brazil data, adapter, flag, cities and version 7.0.2', async () => {
  const [app, html, fx, packageJson, readme] = await Promise.all([
    readFile(new URL('../matcher/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../pilot/fx-context.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /brazilAdapter/);
  assert.match(app, /brazil-research-v3\.0\.json\?v=7\.0\.2/);
  assert.match(app, /countryId === 'BR' \? '🇧🇷'/);
  assert.match(app, /\['AR', 'PY', 'PT', 'MX', 'BR'\]\.includes\(countryId\)/);
  assert.match(fx, /quotes=EUR,ARS,MXN,BRL/);
  assert.match(fx, /\['EUR', 'ARS', 'MXN', 'BRL'\]/);
  assert.equal(packageJson.version, '7.0.2');
  assert.match(html, /версия 7\.0\.2/);
  assert.match(readme, /Бразилии/);
  assert.match(readme, /семи стран/i);
});
