import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { portugalAdapter } from '../js/countries/portugal-adapter.js';
import { spainAdapter } from '../js/countries/spain-adapter.js';
import { formatCurrency } from '../matcher/format.js';
import { uniqueRouteActions } from '../matcher/profile.js';

const portugal = JSON.parse(await readFile(new URL('../data/portugal-research-v3.0.json', import.meta.url), 'utf8'));
const spain = JSON.parse(await readFile(new URL('../data/spain-research-v2.2.json', import.meta.url), 'utf8'));
const context = {
  calculation_date: '2026-07-30T12:00:00Z',
  engine_version: '7.0.2',
  fx: {
    base_currency: 'USD',
    rates: { EUR: 0.87, RUB: 80 },
    source: 'test',
    as_of: '2026-07-30T00:00:00Z',
    max_age_hours: 96,
  },
};

function income(type, amount = 4200, sourceCountry = 'US', owner = 'APPLICANT') {
  return {
    owner,
    type,
    source_country: sourceCountry,
    bank_country: 'GE',
    monthly_total: { amount, currency: 'EUR' },
    monthly_provable: { amount, currency: 'EUR' },
    evidence_level: 'FULL',
    history_months: 3,
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
    preferences: { monthly_budget: { amount: 3000, currency: 'EUR' }, city_size: 'ANY', climate: ['ANY'] },
    pets: { types: ['NONE'], dogs: [], other_pet_notes: null },
    special_circumstances: ['NONE'],
    route_specific_answers: {},
    ...overrides,
  };
}

function withPrimary(type, amount, sourceCountry = 'US', overrides = {}) {
  const candidate = profile(overrides);
  candidate.income = {
    ...candidate.income,
    primary: income(type, amount, sourceCountry),
  };
  return candidate;
}

function calculate(candidate = profile()) {
  const calculation = calculateCountries(candidate, [portugal], context, () => portugalAdapter);
  assert.deepEqual(calculation.errors, []);
  return calculation.results[0];
}

function route(result, routeId) {
  return result.routes.find((item) => item.routeId === routeId);
}

test('Portugal package loads and exposes exactly four publishable routes through calculateCountries', () => {
  const result = calculate();
  assert.equal(result.country.countryId, 'PT');
  assert.equal(result.country.name, 'Португалия');
  assert.equal(result.country.resultCurrency, 'EUR');
  assert.deepEqual(result.routes.map(({ routeId }) => routeId), [
    'PT_D8_REMOTE',
    'PT_D7_OWN_INCOME',
    'PT_D2_INDEPENDENT',
    'PT_D1_EMPLOYMENT',
  ]);
  assert.equal(result.routes.some(({ routeId }) => routeId === 'PT_D3_HIGHLY_QUALIFIED'), false);
  assert.equal(portugal.routes.find(({ route_id }) => route_id === 'PT_D3_HIGHLY_QUALIFIED').publishable, false);
});

test('D8 is suitable for documented foreign remote income above the JSON threshold', () => {
  const d8 = route(calculate(withPrimary('REMOTE_EMPLOYMENT', 4200)), 'PT_D8_REMOTE');
  assert.equal(d8.routeStatus, 'SUITABLE');
  assert.equal(d8.thresholdEur, 3680);
  assert.equal(d8.incomeEur, 4200);
  assert.match(d8.incomeGuidance, /последние 3 месяца/i);
});

test('D8 ignores income history length and keeps the route suitable above the threshold', () => {
  const candidate = withPrimary('REMOTE_EMPLOYMENT', 4200);
  candidate.income.primary.history_months = 1;
  const d8 = route(calculate(candidate), 'PT_D8_REMOTE');
  assert.equal(d8.routeStatus, 'SUITABLE');
  assert.equal(d8.checks.some(({ code }) => /history/i.test(code)), false);
  assert.ok(d8.initialPermitRequirements.some((item) => /последние 3 месяца/i.test(item)));
});

test('D8 is unsuitable below the mandatory threshold even when the profile says income may increase', () => {
  const candidate = withPrimary('REMOTE_EMPLOYMENT', 3200, 'US', {
    route_specific_answers: { PT_D8_REMOTE: { ready_to_raise_income: true } },
  });
  const d8 = route(calculate(candidate), 'PT_D8_REMOTE');
  assert.equal(d8.routeStatus, 'UNSUITABLE');
  assert.ok(d8.blockers.some((message) => message.includes('обязательный порог')));
  assert.ok(d8.actions.some((action) => action.includes('3680 EUR')));
});

test('D8 rejects an incompatible passive-income basis', () => {
  const d8 = route(calculate(withPrimary('PASSIVE_INCOME', 5000)), 'PT_D8_REMOTE');
  assert.equal(d8.routeStatus, 'UNSUITABLE');
  assert.equal(d8.incomeTypeFit, 'DOES_NOT_MEET');
  assert.ok(d8.blockers.some((message) => message.includes('активная удалённая работа')));
});

test('D7 accepts sufficient pension income', () => {
  const d7 = route(calculate(withPrimary('PENSION', 1200, 'RU')), 'PT_D7_OWN_INCOME');
  assert.equal(d7.routeStatus, 'SUITABLE');
  assert.equal(d7.thresholdEur, 920);
  assert.equal(d7.incomeEur, 1200);
});

test('D7 accepts sufficient passive income', () => {
  const result = calculate(withPrimary('PASSIVE_INCOME', 1400));
  const d7 = route(result, 'PT_D7_OWN_INCOME');
  assert.equal(d7.routeStatus, 'SUITABLE');
  assert.equal(result.bestRoute.routeId, 'PT_D7_OWN_INCOME');
});

test('D7 does not treat active foreign remote salary as own passive income', () => {
  const d7 = route(calculate(withPrimary('REMOTE_EMPLOYMENT', 5000)), 'PT_D7_OWN_INCOME');
  assert.equal(d7.routeStatus, 'UNSUITABLE');
  assert.equal(d7.incomeTypeFit, 'DOES_NOT_MEET');
  assert.deepEqual(d7.actions, ['Указать подтверждаемую пенсию или регулярный пассивный доход отдельным источником.']);
});

test('D2 accepts existing independent activity with sufficient means', () => {
  const result = calculate(withPrimary('CONTRACTOR', 1600));
  const d2 = route(result, 'PT_D2_INDEPENDENT');
  assert.equal(d2.routeStatus, 'SUITABLE');
  assert.equal(d2.basisMissing, false);
  assert.equal(result.bestRoute.routeId, 'PT_D2_INDEPENDENT');
});

test('D2 turns creation of a real independent basis into a substantive condition', () => {
  const d2 = route(calculate(withPrimary('REMOTE_EMPLOYMENT', 4200)), 'PT_D2_INDEPENDENT');
  assert.equal(d2.routeStatus, 'SUITABLE_WITH_CONDITIONS');
  assert.equal(d2.basisMissing, true);
  assert.ok(d2.conditions.some((condition) => condition.includes('договорное или предпринимательское основание')));
  assert.ok(d2.actions.some((action) => action.includes('договор или предложение договора')));
});

test('D1 uses an existing Portuguese employment source or a clear local-contract condition', () => {
  const confirmed = route(calculate(withPrimary('REMOTE_EMPLOYMENT', 2200, 'PT')), 'PT_D1_EMPLOYMENT');
  const willing = route(calculate(withPrimary('REMOTE_EMPLOYMENT', 4200, 'US')), 'PT_D1_EMPLOYMENT');
  const declined = route(calculate(withPrimary('PENSION', 2000, 'RU')), 'PT_D1_EMPLOYMENT');
  assert.equal(confirmed.routeStatus, 'SUITABLE');
  assert.equal(willing.routeStatus, 'SUITABLE_WITH_CONDITIONS');
  assert.ok(willing.actions.some((action) => action.includes('работодателя в Португалии')));
  assert.equal(declined.routeStatus, 'UNSUITABLE');
});

test('partner and child change the D7 and D2 family thresholds from the package formula', () => {
  const family = {
    adults_count: 2,
    partner_included: true,
    relationship_type: 'MARRIAGE',
    children: [{ age_years: 8 }],
    school_needed: true,
  };
  const pension = calculate(withPrimary('PENSION', 1500, 'RU', { family }));
  const contractor = calculate(withPrimary('CONTRACTOR', 1700, 'US', { family }));
  assert.equal(route(pension, 'PT_D7_OWN_INCOME').thresholdEur, 1656);
  assert.equal(route(pension, 'PT_D7_OWN_INCOME').routeStatus, 'UNSUITABLE');
  assert.equal(route(contractor, 'PT_D2_INDEPENDENT').thresholdEur, 1656);
  assert.equal(route(contractor, 'PT_D2_INDEPENDENT').routeStatus, 'SUITABLE');
});

test('D2 is unsuitable when existing independent income is below the family threshold', () => {
  const family = {
    adults_count: 2,
    partner_included: true,
    relationship_type: 'MARRIAGE',
    children: [{ age_years: 8 }],
    school_needed: false,
  };
  const candidate = withPrimary('CONTRACTOR', 1500, 'US', {
    family,
    route_specific_answers: { PT_D2_INDEPENDENT: { ready_to_raise_income: true } },
  });
  const d2 = route(calculate(candidate), 'PT_D2_INDEPENDENT');
  assert.equal(d2.routeStatus, 'UNSUITABLE');
  assert.equal(d2.incomeFit, 'DOES_NOT_MEET');
});

test('Portugal keeps an existing unregistered partnership suitable and lists evidence as a filing requirement', () => {
  const family = {
    adults_count: 2,
    partner_included: true,
    relationship_type: 'UNREGISTERED_PARTNER',
    children: [],
    school_needed: false,
  };
  const d8 = route(calculate(withPrimary('REMOTE_EMPLOYMENT', 5000, 'US', { family })), 'PT_D8_REMOTE');
  assert.equal(d8.routeStatus, 'SUITABLE');
  assert.ok(d8.initialPermitRequirements.some((item) => /совместной жизни|фактический союз/i.test(item)));
  assert.equal(d8.actions.some((item) => /совместной жизни|фактический союз/i.test(item)), false);
});

test('Portugal result uses researched cities, family, long-term, work, schools, pets, LGBT, sources, and route-scoped reviews', () => {
  const candidate = withPrimary('REMOTE_EMPLOYMENT', 4500, 'US', {
    family: {
      adults_count: 2,
      partner_included: true,
      relationship_type: 'MARRIAGE',
      children: [{ age_years: 7 }],
      school_needed: true,
    },
    lgbt: { enabled: true, consent_for_personalization: true, family_recognition_relevant: true, safety_relevant: true },
    pets: { types: ['DOG'], dogs: [{ breed: 'Метис' }], other_pet_notes: null },
  });
  const result = calculate(candidate);
  const d8 = route(result, 'PT_D8_REMOTE');
  const d1 = route(result, 'PT_D1_EMPLOYMENT');
  assert.equal(result.bestRoute.routeId, 'PT_D8_REMOTE');
  assert.deepEqual(result.cities.map(({ cityName }) => cityName), ['Браганса', 'Фару', 'Лиссабон']);
  assert.equal(result.cities[0].costUsd, 1835);
  assert.match(result.schoolSummary, /Международные школы/);
  assert.match(result.petSummary, /микрочип/);
  assert.match(d8.family.rule_ru, /100% RMMG/);
  assert.match(d8.family.partner_work_rights_ru, /вправе работать/);
  assert.equal(d8.work.local_work_allowed, true);
  assert.match(d8.longTerm.pr_path_ru, /5 лет/);
  assert.match(d8.longTerm.citizenship_path_ru, /10 лет/);
  assert.match(d8.longTerm.presence_rule_ru, /6 месяцев подряд/);
  assert.equal(result.lgbt.safety.tone, 'safe');
  assert.match(result.lgbt.rows[0][1], /независимо от пола/);
  assert.ok(result.sources.some(({ source_id }) => source_id === 'PT_SRC_NOMAD_RULE'));
  assert.equal(d8.review.length, 1);
  assert.deepEqual(d1.review, []);
});

test('all public Portugal outcomes stay inside the three-status contract and explain their result', () => {
  const allowed = new Set(['SUITABLE', 'SUITABLE_WITH_CONDITIONS', 'UNSUITABLE']);
  const result = calculate();
  for (const item of result.routes) {
    assert.ok(allowed.has(item.routeStatus));
    assert.ok(item.checks.length > 0);
    assert.ok(item.checks.every(({ message }) => typeof message === 'string' && message.length > 0));
  }
});

test('public matcher loads Portugal without adding Portugal-specific questionnaire fields', async () => {
  const [app, html] = await Promise.all([
    readFile(new URL('../matcher/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /portugal-adapter\.js\?v=7\.0\.2/);
  assert.match(app, /portugal-research-v3\.0\.json\?v=7\.0\.2/);
  assert.match(app, /countryId === 'PT' \? '🇵🇹'/);
  assert.match(app, /\['AR', 'PY', 'PT', 'MX', 'BR'\]\.includes\(countryId\)/);
  assert.equal(/<[^>]+(?:id|name)="[^"]*(?:portugal|pt_d8|pt_d7|pt_d2|pt_d1)[^"]*"/i.test(html), false);
});

test('Spain and Portugal share one EUR rate and preserve a positive 1 USD income', () => {
  const candidate = withPrimary('REMOTE_EMPLOYMENT', 1);
  candidate.income.primary.monthly_total.currency = 'USD';
  candidate.income.primary.monthly_provable.currency = 'USD';
  candidate.preferences.monthly_budget = { amount: 1, currency: 'USD' };
  const calculation = calculateCountries(candidate, [spain, portugal], context, (countryPackage) =>
    countryPackage.country_id === 'PT' ? portugalAdapter : spainAdapter);
  assert.deepEqual(calculation.errors, []);
  const [spainResult, portugalResult] = calculation.results;
  assert.equal(spainResult.applicantProvableIncome.amount, 0.87);
  assert.equal(portugalResult.applicantProvableIncome.amount, 0.87);
  assert.equal(spainResult.applicantProvableIncome.currency, 'EUR');
  assert.equal(portugalResult.applicantProvableIncome.currency, 'EUR');
  assert.equal(formatCurrency(portugalResult.applicantProvableIncome.amount, 'EUR').includes('0 €'), false);
});

test('country KPI income includes applicant additional sources and excludes partner income', () => {
  const candidate = withPrimary('REMOTE_EMPLOYMENT', 1);
  candidate.income.primary.monthly_total.currency = 'USD';
  candidate.income.primary.monthly_provable.currency = 'USD';
  candidate.income.has_additional_sources = true;
  candidate.income.additional_sources = [income('PASSIVE_INCOME', 2, 'US', 'APPLICANT')];
  candidate.income.additional_sources[0].monthly_total.currency = 'USD';
  candidate.income.additional_sources[0].monthly_provable.currency = 'USD';
  candidate.income.partner = {
    has_income: true,
    sources: [income('PENSION', 100, 'RU', 'PARTNER')],
  };
  candidate.income.partner.sources[0].monthly_total.currency = 'USD';
  candidate.income.partner.sources[0].monthly_provable.currency = 'USD';
  const calculation = calculateCountries(candidate, [spain, portugal], context, (countryPackage) =>
    countryPackage.country_id === 'PT' ? portugalAdapter : spainAdapter);
  assert.deepEqual(calculation.errors, []);
  assert.ok(calculation.results.every((result) => Math.abs(result.applicantProvableIncome.amount - 2.61) < 1e-10));
});

test('all four public Portugal routes expose the four long-term texts directly from JSON', () => {
  const result = calculate();
  for (const evaluated of result.routes) {
    const source = portugal.routes.find(({ route_id }) => route_id === evaluated.routeId);
    assert.equal(evaluated.longTerm.pr_path_ru, source.pr_path_ru);
    assert.equal(evaluated.longTerm.citizenship_path_ru, source.citizenship_path_ru);
    assert.equal(evaluated.longTerm.presence_rule_ru, source.presence_rule_ru);
    assert.equal(evaluated.longTerm.dual_citizenship_ru, source.dual_citizenship_ru);
  }
});

test('Portugal route feedback never advises choosing a different route', () => {
  const result = calculate(withPrimary('REMOTE_EMPLOYMENT', 1));
  for (const evaluated of result.routes) {
    const ownCode = evaluated.routeId.match(/PT_(D\d)/)?.[1];
    const feedback = [
      ...evaluated.actions,
      ...evaluated.blockers,
      ...evaluated.conditions,
      ...evaluated.clientMissing,
    ].join(' ');
    for (const code of ['D8', 'D7', 'D2', 'D1']) {
      if (code !== ownCode) assert.equal(new RegExp(`\\b${code}\\b`).test(feedback), false, `${evaluated.routeId} mentions ${code}`);
    }
  }
});

test('Portugal corrective actions omit paired conditions and requirements that say the same thing', () => {
  const result = calculate(withPrimary('REMOTE_EMPLOYMENT', 1));
  assert.deepEqual(uniqueRouteActions(route(result, 'PT_D2_INDEPENDENT')), []);
  assert.deepEqual(uniqueRouteActions(route(result, 'PT_D1_EMPLOYMENT')), []);
  assert.deepEqual(uniqueRouteActions(route(result, 'PT_D7_OWN_INCOME')), [
    'Указать подтверждаемую пенсию или регулярный пассивный доход отдельным источником.',
  ]);
});

test('Portugal city data uses only approved roles and covers every required role and size', () => {
  const allowedRoles = new Set(['Столица', 'Самый недорогой', 'Самый дорогой', 'Самый прохладный', 'Самый жаркий']);
  const roles = portugal.cities.flatMap((city) => city.roles_ru);
  const sources = new Map(portugal.sources.map((source) => [source.source_id, source]));
  const rangeAverage = (range) => {
    const values = range.split('–').map((value) => Number(value.replace(',', '.')));
    return (values[0] + values[1]) / 2;
  };
  assert.ok(roles.every((role) => allowedRoles.has(role)));
  assert.deepEqual(new Set(roles), allowedRoles);
  assert.deepEqual(new Set(portugal.cities.map(({ size }) => size)), new Set(['крупный', 'средний', 'небольшой']));
  assert.equal(portugal.cities.find((city) => city.roles_ru.includes('Самый недорогой')).budget_single_usd, Math.min(...portugal.cities.map((city) => city.budget_single_usd)));
  assert.equal(portugal.cities.find((city) => city.roles_ru.includes('Самый дорогой')).budget_single_usd, Math.max(...portugal.cities.map((city) => city.budget_single_usd)));
  assert.equal(
    portugal.cities.find((city) => city.roles_ru.includes('Самый прохладный')).city_id,
    [...portugal.cities].sort((left, right) => rangeAverage(left.cold_period_temperature_range_c) - rangeAverage(right.cold_period_temperature_range_c))[0].city_id,
  );
  assert.equal(
    portugal.cities.find((city) => city.roles_ru.includes('Самый жаркий')).city_id,
    [...portugal.cities].sort((left, right) => rangeAverage(right.hot_period_temperature_range_c) - rangeAverage(left.hot_period_temperature_range_c))[0].city_id,
  );
  for (const city of portugal.cities) {
    const citySources = city.source_ids.map((sourceId) => sources.get(sourceId));
    assert.ok(citySources.some(({ source_type }) => source_type === 'OFFICIAL_STATISTICS'), `${city.city_id} has no official population source`);
    assert.ok(citySources.some(({ source_type }) => source_type === 'OFFICIAL_CLIMATE_NORMAL'), `${city.city_id} has no official climate source`);
  }
  assert.match(portugal.schools.public_school_ru, /Português Língua Não Materna \(PLNM\) — «португальский как неродной язык»/);
});

test('Portugal cities expose the expected size-first matcher categories', async () => {
  const { cityCategories } = await import('../matcher/profile.js');
  const result = calculate();
  const categories = Object.fromEntries(result.cities.map((city) => [
    city.cityName,
    cityCategories(city.populationCategory, city.roles),
  ]));
  assert.deepEqual(categories.Браганса, ['Небольшой город', 'Самый недорогой', 'Самый прохладный']);
  assert.deepEqual(categories.Фару, ['Средний город', 'Самый жаркий']);
  assert.deepEqual(categories.Лиссабон, ['Крупный город', 'Столица', 'Самый дорогой']);
});

test('Portugal matcher source has no fallback long-term text for PT or duplicate requirements heading', async () => {
  const app = await readFile(new URL('../matcher/app.js', import.meta.url), 'utf8');
  assert.match(app, /\['PY', 'PT', 'MX', 'BR'\]\.includes\(countryId\)/);
  assert.equal(app.includes('Что потребуется для этого маршрута'), false);
  assert.equal(app.includes('либо рассматривать D8'), false);
});
