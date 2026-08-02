import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { paraguayAdapter } from '../js/countries/paraguay-adapter.js';

const paraguay = JSON.parse(await readFile(new URL('../data/paraguay-research-v3.0.json', import.meta.url), 'utf8'));
const context = {
  calculation_date: '2026-07-25T12:00:00Z',
  engine_version: '7.0.2',
  fx: {
    base_currency: 'USD',
    rates: { EUR: 0.87, RUB: 80 },
    source: 'test',
    as_of: '2026-07-25T00:00:00Z',
    max_age_hours: 96,
  },
};

function profile(overrides = {}) {
  return {
    schema_version: 'user-profile-v1',
    citizenships: ['RU'],
    residence: { current_country: 'RU', current_status: 'CITIZENSHIP' },
    application_preferences: { methods: ['RUSSIA'] },
    family: { adults_count: 1, partner_included: false, relationship_type: null, children: [], school_needed: false },
    lgbt: { enabled: false, consent_for_personalization: false, family_recognition_relevant: null, safety_relevant: null },
    income: {
      primary: {
        owner: 'APPLICANT',
        type: 'REMOTE_EMPLOYMENT',
        source_country: 'US',
        bank_country: 'GE',
        monthly_total: { amount: 2500, currency: 'USD' },
        monthly_provable: { amount: 2500, currency: 'USD' },
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
    preferences: { monthly_budget: { amount: 1800, currency: 'USD' }, city_size: 'ANY', climate: ['ANY'] },
    pets: { types: ['NONE'], dogs: [], other_pet_notes: null },
    special_circumstances: ['NONE'],
    route_specific_answers: {},
    ...overrides,
  };
}

function calculate(input = profile()) {
  return calculateCountries(input, [paraguay], context, () => paraguayAdapter).results[0];
}

test('Paraguay publishes only temporary residence and permanent residence after temporary status', () => {
  const result = calculate();
  assert.deepEqual(result.routes.map(({ routeId }) => routeId), ['PY_TEMPORARY', 'PY_PERMANENT_AFTER_TEMP']);
  assert.equal(result.routes.some(({ routeId }) => routeId === 'PY_INVESTOR_PASS'), false);
});

test('applicant in Russia can travel for an in-country temporary filing and cannot skip directly to permanent residence', () => {
  const result = calculate();
  const temporary = result.routes.find(({ routeId }) => routeId === 'PY_TEMPORARY');
  const permanent = result.routes.find(({ routeId }) => routeId === 'PY_PERMANENT_AFTER_TEMP');
  assert.equal(result.bestRoute.routeId, 'PY_TEMPORARY');
  assert.equal(temporary.routeStatus, 'SUITABLE');
  assert.equal(temporary.applicationFit, 'MEETS');
  assert.ok(temporary.actions.some((item) => item.includes('въезда и личной подачи')));
  assert.equal(temporary.conditions.some((item) => item.includes('Въехать в Парагвай')), false);
  assert.equal(permanent.routeStatus, 'UNSUITABLE');
  assert.ok(permanent.blockers.some((item) => item.includes('временная резиденция Парагвая')));
});

test('applicant already inside Paraguay can use the temporary residence route without an invented income threshold', () => {
  const input = profile({
    residence: { current_country: 'PY', current_status: 'TOURIST_OR_VISA_FREE' },
    application_preferences: { methods: ['CURRENT_COUNTRY'] },
  });
  const temporary = calculate(input).routes.find(({ routeId }) => routeId === 'PY_TEMPORARY');
  assert.equal(temporary.routeStatus, 'SUITABLE');
  assert.equal(temporary.thresholdUsd, null);
  assert.equal(temporary.incomeTypeFit, 'NOT_APPLICABLE');
  assert.match(temporary.incomeGuidance, /универсальный числовой порог/i);
});

test('current Paraguayan temporary resident is directed to the permanent-residence transition', () => {
  const input = profile({
    residence: { current_country: 'PY', current_status: 'TEMPORARY_RESIDENCE' },
    application_preferences: { methods: ['CURRENT_COUNTRY'] },
    goal: {
      long_term: 'PR_REQUIRED',
      physical_presence: 'DEPENDS_ON_COUNTRY',
      language_exam_readiness: 'DEPENDS_ON_LANGUAGE',
      keep_russian_citizenship: 'DESIRABLE',
    },
  });
  const result = calculate(input);
  const permanent = result.routes.find(({ routeId }) => routeId === 'PY_PERMANENT_AFTER_TEMP');
  assert.equal(result.bestRoute.routeId, 'PY_PERMANENT_AFTER_TEMP');
  assert.equal(permanent.routeStatus, 'SUITABLE_WITH_CONDITIONS');
  assert.equal(permanent.thresholdUsd, null);
  assert.ok(permanent.conditions.some((item) => item.includes('последние три месяца')));
  assert.ok(permanent.conditions.some((item) => item.includes('категорию состоятельности')));
});

test('same-sex partner is shown as needing an independent Paraguayan route', () => {
  const input = profile({
    residence: { current_country: 'PY', current_status: 'TEMPORARY_RESIDENCE' },
    application_preferences: { methods: ['CURRENT_COUNTRY'] },
    family: { adults_count: 2, partner_included: true, relationship_type: 'MARRIAGE', children: [], school_needed: false },
    lgbt: { enabled: true, consent_for_personalization: true, family_recognition_relevant: true, safety_relevant: true },
  });
  const result = calculate(input);
  const permanent = result.routes.find(({ routeId }) => routeId === 'PY_PERMANENT_AFTER_TEMP');
  assert.ok(permanent.conditions.some((item) => item.includes('Партнёр должен отдельно')));
  assert.equal(result.lgbt.safety.tone, 'unsafe');
  assert.equal(result.lgbt.safety.level, 'небезопасно');
});

test('Paraguay practical result uses researched family budgets and does not invent international-school prices', () => {
  const input = profile({
    family: { adults_count: 2, partner_included: true, relationship_type: 'MARRIAGE', children: [{ age_years: 8 }], school_needed: true },
    pets: { types: ['DOG'], dogs: [{ breed: 'MIXED' }], other_pet_notes: null },
  });
  const result = calculate(input);
  assert.deepEqual(result.cities.map(({ cityName }) => cityName), ['Энкарнасьон', 'Сьюдад-дель-Эсте', 'Асунсьон']);
  assert.equal(result.cities[0].costUsd, 1550);
  assert.equal(result.cities.every(({ internationalSchoolCost }) => internationalSchoolCost == null), true);
  assert.match(result.schoolSummary, /актуальные цены/i);
  assert.match(result.petSummary, /до пяти домашних собак или кошек/i);
});

test('public matcher loads Paraguay data, adapter, flag, and dynamic city cards', async () => {
  const app = await readFile(new URL('../matcher/app.js', import.meta.url), 'utf8');
  assert.match(app, /paraguay-research-v3\.0\.json\?v=7\.0\.2/);
  assert.match(app, /paraguay-adapter\.js\?v=7\.0\.2/);
  assert.match(app, /countryId === 'PY' \? '🇵🇾'/);
  assert.match(app, /\['AR', 'PY', 'PT', 'MX', 'BR'\]\.includes\(countryId\)/);
  assert.match(app, /countryId === 'UY' \? 700 : 0/);
});
