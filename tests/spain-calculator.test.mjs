import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateSpain,
  resolveStatusConflict,
  selectBestVariant,
  STATUS_LABELS_RU,
  COUNTRY_GROUP_LABELS_RU,
} from '../js/spain-calculator.js';

const data = JSON.parse(await readFile(new URL('../data/spain-research-v2.2.json', import.meta.url), 'utf8'));
const universalSamples = JSON.parse(await readFile(new URL('./fixtures/universal-profile-samples-v1.json', import.meta.url), 'utf8'));

const baseProfile = {
  applicationNationality: 'RU',
  currentLocation: 'THIRD_COUNTRY',
  legalResidence: true,
  bankCountry: 'OTHER',
  socialSecurityPlan: 'REGISTER_IN_SPAIN',
  adults: 1,
  children: 0,
  relationshipType: 'NONE',
  sameSexFamily: false,
  needsFamilyVisa: false,
  schoolNeeded: false,
  goal: 'TEMPORARY_RESIDENCE',
  monthsPerYear: 12,
  languageReadiness: 'YES',
  keepRuCitizenship: 'DESIRABLE',
  monthlyBudgetUsd: 2200,
  citySize: 'ANY',
  pet: 'NONE',
  medicineRequired: false,
};

const context = { calculation_date: '2026-07-19T12:00:00Z', engine_version: '2.1.0', fx: { base_currency: 'USD', rates: { EUR: 0.874, RUB: 80 }, source: 'test', as_of: '2026-07-19T00:00:00Z', max_age_hours: 96 } };
const currencyContext = { ...context, fx: { ...context.fx, rates: { EUR: 0.8, RUB: 80 } } };
const calculate = (overrides) => calculateSpain({ ...baseProfile, ...overrides }, data, context);
const strictProfile = (overrides = {}) => {
  const source = structuredClone(universalSamples[0]);
  source.citizenships = ['RU'];
  source.residence = { current_country: 'RU', current_status: 'CITIZENSHIP' };
  source.application_preferences = { methods: ['RUSSIA'] };
  source.family = { adults_count: 1, partner_included: false, relationship_type: null, children: [], school_needed: false };
  source.lgbt = { enabled: false, consent_for_personalization: false };
  source.income.primary.type = 'PASSIVE_INCOME';
  source.income.primary.monthly_provable = { amount: 5000, currency: 'USD' };
  source.goal = { long_term: 'TEMPORARY_RESIDENCE_SUFFICIENT', physical_presence: 'MOST_OF_YEAR', language_exam_readiness: 'YES', keep_russian_citizenship: 'DESIRABLE' };
  source.preferences.monthly_budget = null;
  source.preferences.city_size = 'ANY';
  source.route_specific_answers = {};
  return Object.assign(source, overrides);
};

test('conflict resolution chooses the strictest status inside one route', () => {
  assert.equal(
    resolveStatusConflict(['SUITABLE', 'SUITABLE_WITH_CONDITIONS', 'UNSUITABLE']),
    'UNSUITABLE'
  );
});

test('best-variant selection uses a separate preference order', () => {
  const best = selectBestVariant([
    { routeStatus: 'INSUFFICIENT_COUNTRY_DATA', scenarioAffinity: 1 },
    { routeStatus: 'SUITABLE_WITH_CONDITIONS', scenarioAffinity: 0 },
  ]);
  assert.equal(best.routeStatus, 'SUITABLE_WITH_CONDITIONS');
});

test('remote employee with sufficient converted income selects DNV', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 3200 });
  assert.equal(result.bestRoute.routeId, 'ES_DNV');
  assert.equal(result.bestRoute.routeStatus, 'SUITABLE');
});

test('currency conversion prevents comparing USD directly with an EUR threshold', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 2500 });
  assert.equal(result.bestRoute.routeId, 'ES_DNV');
  assert.equal(result.bestRoute.routeStatus, 'UNSUITABLE');
  assert.ok(result.bestRoute.blockers.some((message) => message.includes('требование маршрута')));
});

test('Russian bank statements return insufficient country data for DNV', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 4000, bankCountry: 'RU' });
  assert.equal(result.bestRoute.routeStatus, 'INSUFFICIENT_COUNTRY_DATA');
});

test('Spanish primary income source is evaluated separately for DNV', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 5000, incomeSourceCountry: 'ES' });
  const dnv = result.routes.find((route) => route.routeId === 'ES_DNV');
  assert.equal(dnv.routeStatus, 'UNSUITABLE');
  assert.ok(dnv.blockers.some((message) => message.includes('за пределами Испании')));
});

test('passive-income profile selects NLV when its threshold is met', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 3200 });
  assert.equal(result.bestRoute.routeId, 'ES_NLV');
  assert.equal(result.bestRoute.routeStatus, 'SUITABLE');
});

test('NLV fails when passive resources are below the threshold', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 1800 });
  assert.equal(result.bestRoute.routeId, 'ES_NLV');
  assert.equal(result.bestRoute.routeStatus, 'UNSUITABLE');
});

test('every NLV blocker has a corresponding corrective action', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 1800, legalResidence: false });
  const nlv = result.routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(nlv.blockers.length, 2);
  assert.equal(nlv.actions.length, 2);
  assert.ok(nlv.actions.some((action) => action.includes('Подаваться из России')));
  assert.ok(nlv.actions.some((action) => action.includes(`${Math.round(nlv.thresholdEur)} EUR`)));
});

test('Spanish highly-qualified route is preliminary until the offer and qualification are verified', () => {
  const result = calculate({ plannedBasis: 'SPANISH_JOB_OFFER', monthlyIncomeUsd: 5000 });
  assert.equal(result.bestRoute.routeId, 'ES_HIGHLY_QUALIFIED');
  assert.equal(result.bestRoute.routeStatus, 'PRELIMINARY_SUITABLE');
  assert.ok(result.bestRoute.actions.some((action) => action.includes('квалифицированной работы')));
  assert.match(result.bestRoute.primarySource.url, /inclusion\.gob\.es/);
});

test('four Spanish routes explain their in-country filing rules', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 5000 });
  const guidance = Object.fromEntries(result.routes.map((route) => [route.routeId, route.applicationGuidance]));
  assert.match(guidance.ES_DNV, /законно/);
  assert.match(guidance.ES_ENTREPRENEUR, /UGE/);
  assert.match(guidance.ES_HIGHLY_QUALIFIED, /работодатель/);
  assert.match(guidance.ES_STUDENT, /только на высшее образование/);
});

test('practical budget has a researched small Spanish city without fallback', () => {
  const profile = strictProfile();
  profile.preferences.city_size = 'SMALL';
  const result = calculateSpain(profile, data, context);
  assert.ok(result.recommendedCity);
  assert.equal(result.usedCitySizeFallback, false);
  assert.equal(result.recommendedCity.cityId, 'ES_CASTELLON');
});

test('student route compares available means with the published IPREM requirement', () => {
  const enough = calculate({ plannedBasis: 'STUDY', monthlyIncomeUsd: 1000 }).routes.find((route) => route.routeId === 'ES_STUDENT');
  const low = calculate({ plannedBasis: 'STUDY', monthlyIncomeUsd: 500 }).routes.find((route) => route.routeId === 'ES_STUDENT');
  assert.equal(enough.thresholdEur, 600);
  assert.equal(enough.routeStatus, 'PRELIMINARY_SUITABLE');
  assert.equal(low.routeStatus, 'UNSUITABLE');
  assert.ok(low.actions.some((action) => action.includes('600 EUR')));
});

test('unknown multiple-citizenship rule does not invent a hard conflict', () => {
  const result = calculate({
    plannedBasis: 'REMOTE_EMPLOYEE',
    monthlyIncomeUsd: 5000,
    goal: 'CITIZENSHIP_REQUIRED',
    keepRuCitizenship: 'REQUIRED',
  });
  assert.equal(result.bestRoute.routeId, 'ES_DNV');
  assert.equal(result.bestRoute.routeStatus, 'INSUFFICIENT_COUNTRY_DATA');
});

test('a family budget below city costs produces a practical mismatch group', () => {
  const result = calculate({
    plannedBasis: 'REMOTE_EMPLOYEE',
    monthlyIncomeUsd: 6000,
    adults: 2,
    children: 1,
    relationshipType: 'REGISTERED_PARTNERSHIP',
    needsFamilyVisa: true,
    schoolNeeded: true,
    monthlyBudgetUsd: 2500,
  });
  assert.equal(result.bestRoute.routeStatus, 'SUITABLE');
  assert.equal(result.country.group, 'LEGAL_BUT_PRACTICALLY_UNSUITABLE');
});

test('all six Spain routes are independently evaluated', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 3200 });
  assert.equal(result.routes.length, 6);
  assert.equal(result.bestRoute.routeId, 'ES_NLV');
  assert.ok(result.routes.every((route) => !Object.hasOwn(route, 'selection' + 'Score')));
});

test('legacy family keeps adults and children as separate values', () => {
  const result = calculateSpain({ ...baseProfile, adults: 2, children: 1, plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000 }, data, context);
  assert.equal(result.profile.adults, 2);
  assert.equal(result.profile.children.length, 1);
});

test('legacy wrapper re-exports public Russian labels', () => {
  assert.equal(STATUS_LABELS_RU.SUITABLE, 'Подходит');
  assert.equal(COUNTRY_GROUP_LABELS_RU.SUITABLE, 'Подходит');
});

test('canonical conflict and selection orders remain independent', () => {
  assert.equal(resolveStatusConflict(['INSUFFICIENT_COUNTRY_DATA', 'INDIVIDUAL_REVIEW_REQUIRED']), 'INDIVIDUAL_REVIEW_REQUIRED');
  assert.equal(selectBestVariant([{ routeId: 'review', routeStatus: 'INDIVIDUAL_REVIEW_REQUIRED' }, { routeId: 'missing', routeStatus: 'INSUFFICIENT_COUNTRY_DATA' }]).routeId, 'missing');
});

test('DNV social security is reported as an initial-permit requirement without making the result yellow', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 5000, socialSecurityPlan: null });
  assert.equal(result.bestRoute.routeStatus, 'SUITABLE');
  assert.deepEqual(result.bestRoute.followUpQuestions, []);
  assert.ok(result.bestRoute.initialPermitRequirements.some((condition) => condition.includes('социальн')));
});

test('legacy social-security answer does not override the route requirement', () => {
  const result = calculate({ plannedBasis: 'REMOTE_EMPLOYEE', monthlyIncomeUsd: 5000, socialSecurityPlan: 'FOREIGN_CERTIFICATE' });
  assert.equal(result.bestRoute.routeStatus, 'SUITABLE');
  assert.deepEqual(result.bestRoute.followUpQuestions, []);
});

test('unknown budget is not converted to zero', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000, monthlyBudgetUsd: null });
  assert.equal(result.profile.monthlyBudgetUsd, null);
  assert.equal(result.recommendedCity.budgetProximity, 'NOT_APPLICABLE');
});

test('budget proximity uses the ten-percent margin', () => {
  const baseline = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000, monthlyBudgetUsd: null });
  const cost = baseline.recommendedCity.costUsd;
  const within = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000, monthlyBudgetUsd: cost / 0.95 });
  const outside = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000, monthlyBudgetUsd: cost / 0.8 });
  assert.equal(within.recommendedCity.budgetProximity, 'WITHIN_MARGIN');
  assert.equal(outside.recommendedCity.budgetProximity, 'OUTSIDE_MARGIN');
});

test('citizenship desired does not block an available initial residence', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000, goal: 'CITIZENSHIP_DESIRED', keepRuCitizenship: 'WILLING_TO_RENOUNCE' });
  assert.notEqual(result.bestRoute.routeStatus, 'UNSUITABLE');
});

test('country engine preserves children and can still create citizenship variants', () => {
  const profile = { ...universalSamples[1], citizenships: ['RU', 'AR'], route_specific_answers: { ES_DNV: { social_security_plan: 'REGISTER_IN_SPAIN' } } };
  const result = calculateSpain(profile, data, currencyContext);
  assert.equal(result.profile.children.length, profile.family.children.length);
  assert.equal(result.routes.every((route) => route.citizenshipVariants.length === 2), true);
});

test('EUR income and budget are converted through the USD base with audit metadata', () => {
  const profile = strictProfile();
  profile.income.primary.monthly_provable = { amount: 4000, currency: 'EUR' };
  profile.preferences.monthly_budget = { amount: 2400, currency: 'EUR' };
  const result = calculateSpain(profile, data, currencyContext);
  assert.equal(result.profile.monthlyIncomeUsd, 5000);
  assert.equal(result.bestRoute.incomeEur, 4000);
  assert.equal(result.bestRoute.incomeRequirementConversion.appliedRate, 1);
  assert.equal(result.recommendedCity.budgetConversion.convertedAmount, 3000);
  assert.equal(result.bestRoute.incomeRequirementConversion.rateAsOf, currencyContext.fx.as_of);
});

test('RUB income and budget are converted through configured context rates', () => {
  const profile = strictProfile();
  profile.income.primary.monthly_provable = { amount: 400000, currency: 'RUB' };
  profile.preferences.monthly_budget = { amount: 240000, currency: 'RUB' };
  const result = calculateSpain(profile, data, currencyContext);
  assert.equal(result.profile.monthlyIncomeUsd, 5000);
  assert.equal(result.bestRoute.incomeEur, 4000);
  assert.equal(result.recommendedCity.budgetConversion.convertedAmount, 3000);
  assert.equal(result.bestRoute.incomeConversion.originalCurrency, 'RUB');
});

test('missing required currency rate raises calculation-context error', () => {
  const profile = strictProfile();
  profile.income.primary.monthly_provable = { amount: 400000, currency: 'RUB' };
  const noRub = { ...context, fx: { ...context.fx, rates: { EUR: 0.8 } } };
  assert.throws(() => calculateSpain(profile, data, noRub), { code: 'CALCULATION_CONTEXT_INCOMPLETE' });
});

test('missing currency is a profile-contract error, not a missing client answer', () => {
  const profile = strictProfile();
  profile.income.primary.monthly_provable = { amount: 4000 };
  assert.throws(() => calculateSpain(profile, data, context), { code: 'PROFILE_INCOMPLETE' });
});

test('actual Spain routes allow RU and third-country AR but reject EU citizenship', () => {
  const profile = strictProfile({ citizenships: ['RU', 'AR', 'DE'] });
  const result = calculateSpain(profile, data, context);
  const nlv = result.routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(nlv.citizenshipVariants.find((item) => item.applicationNationality === 'RU').applicationFit, 'MEETS');
  assert.equal(nlv.citizenshipVariants.find((item) => item.applicationNationality === 'AR').applicationFit, 'MEETS');
  assert.equal(nlv.citizenshipVariants.find((item) => item.applicationNationality === 'DE').blockers.some((item) => item.includes('гражданства')), true);
});

test('exact allowed nationality can win and explicitly excluded nationality cannot', () => {
  const exactPackage = structuredClone(data);
  exactPackage.routes = [structuredClone(data.routes.find((route) => route.route_id === 'ES_NLV'))];
  exactPackage.routes[0].allowed_nationalities = ['AR'];
  exactPackage.routes[0].russian_citizens_allowed = 'NO';
  const exact = calculateSpain(strictProfile({ citizenships: ['RU', 'AR'] }), exactPackage, context);
  assert.equal(exact.bestRoute.applicationNationality, 'AR');
  assert.equal(exact.bestRoute.viaSecondaryNationality, true);
  const forbidden = calculateSpain(strictProfile({ citizenships: ['RU', 'CL'] }), exactPackage, context);
  assert.equal(forbidden.routes[0].citizenshipVariants.every((item) => item.routeStatus === 'UNSUITABLE'), true);
});

test('family relationship and same-sex checks use package fields without false gaps', () => {
  for (const relationshipType of ['MARRIAGE', 'REGISTERED_PARTNERSHIP', 'UNREGISTERED_PARTNER']) {
    const profile = strictProfile();
    profile.family = { adults_count: 2, partner_included: true, relationship_type: relationshipType, children: [], school_needed: false };
    const dnv = calculateSpain(profile, data, context).routes.find((route) => route.routeId === 'ES_DNV');
    assert.equal(dnv.checks.some((check) => check.code === 'relationship_rule_unknown'), false);
  }
  for (const relationshipType of ['MARRIAGE', 'UNREGISTERED_PARTNER']) {
    const profile = strictProfile();
    profile.family = { adults_count: 2, partner_included: true, relationship_type: relationshipType, children: [], school_needed: false };
    profile.lgbt = { enabled: true, consent_for_personalization: true, family_recognition_relevant: true };
    const dnv = calculateSpain(profile, data, context).routes.find((route) => route.routeId === 'ES_DNV');
    assert.equal(dnv.checks.some((check) => check.code === 'same_sex_family_recognized'), true);
  }
});

test('known and missing child ages are evaluated against the actual route limit', () => {
  const known = strictProfile();
  known.income.primary.type = 'OTHER_REGULAR_REMOTE_INCOME';
  known.family = { adults_count: 1, partner_included: false, relationship_type: null, children: [{ age_years: 12 }], school_needed: false };
  const knownStudent = calculateSpain(known, data, context).routes.find((route) => route.routeId === 'ES_STUDENT');
  assert.equal(knownStudent.checks.some((check) => check.code === 'child_age_missing'), false);
  const missing = structuredClone(known);
  missing.family.children = [{ age_years: null }];
  const missingStudent = calculateSpain(missing, data, context).routes.find((route) => route.routeId === 'ES_STUDENT');
  assert.equal(missingStudent.checks.some((check) => check.code === 'child_age_missing'), true);
});

test('CURRENT_COUNTRY inside Spain is not consular filing, while DNV in-country filing works', () => {
  const current = strictProfile();
  current.residence = { current_country: 'ES', current_status: 'TEMPORARY_RESIDENCE' };
  current.application_preferences.methods = ['CURRENT_COUNTRY'];
  const nlv = calculateSpain(current, data, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(nlv.checks.some((check) => check.code === 'current_country_is_target'), true);
  const inside = structuredClone(current);
  inside.application_preferences.methods = ['IN_COUNTRY_AFTER_ENTRY'];
  inside.income.primary.type = 'REMOTE_EMPLOYMENT';
  const dnv = calculateSpain(inside, data, context).routes.find((route) => route.routeId === 'ES_DNV');
  assert.equal(dnv.checks.some((check) => check.code === 'in_country_method_allowed'), true);
});

test('CURRENT_COUNTRY in Russia always checks application_from_russia', () => {
  const profile = strictProfile();
  profile.application_preferences.methods = ['CURRENT_COUNTRY'];
  const allowed = calculateSpain(profile, data, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(allowed.checks.some((check) => check.code === 'current_country_russia_allowed'), true);
  const blockedPackage = structuredClone(data);
  blockedPackage.routes.find((route) => route.route_id === 'ES_NLV').application_from_russia = 'NO';
  const blocked = calculateSpain(profile, blockedPackage, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(blocked.checks.some((check) => check.code === 'current_country_russia_not_allowed'), true);
});

test('CURRENT_COUNTRY in a third country distinguishes residence statuses', () => {
  const resident = strictProfile();
  resident.residence = { current_country: 'PH', current_status: 'TEMPORARY_RESIDENCE' };
  resident.application_preferences.methods = ['CURRENT_COUNTRY'];
  const residentNlv = calculateSpain(resident, data, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(residentNlv.checks.some((check) => check.code === 'current_country_residence_confirmed'), true);
  const tourist = structuredClone(resident);
  tourist.residence.current_status = 'TOURIST_OR_VISA_FREE';
  const touristNlv = calculateSpain(tourist, data, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(touristNlv.checks.some((check) => check.code === 'current_country_residence_required'), true);
  const other = structuredClone(resident);
  other.residence.current_status = 'OTHER_LEGAL_STATUS';
  const otherNlv = calculateSpain(other, data, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(otherNlv.checks.some((check) => check.code === 'current_country_status_clarification' && check.status === 'PRELIMINARY_SUITABLE'), true);
});

test('unknown Russian nationality rule is missing country data', () => {
  const countryPackage = structuredClone(data);
  countryPackage.routes.find((route) => route.route_id === 'ES_NLV').russian_citizens_allowed = 'UNKNOWN';
  const nlv = calculateSpain(strictProfile(), countryPackage, context).routes.find((route) => route.routeId === 'ES_NLV');
  assert.equal(nlv.checks.some((check) => check.code === 'russian_nationality_rule_unknown' && check.status === 'INSUFFICIENT_COUNTRY_DATA'), true);
  assert.equal(nlv.routeStatus, 'INSUFFICIENT_COUNTRY_DATA');
});

test('ANY evaluates every real method and cannot bypass all restrictions', () => {
  const countryPackage = structuredClone(data);
  const route = countryPackage.routes.find((item) => item.route_id === 'ES_NLV');
  route.application_from_russia = 'NO';
  const profile = strictProfile();
  profile.residence = { current_country: 'ES', current_status: 'TEMPORARY_RESIDENCE' };
  profile.application_preferences.methods = ['ANY'];
  const nlv = calculateSpain(profile, countryPackage, context).routes.find((item) => item.routeId === 'ES_NLV');
  assert.equal(nlv.applicationFit, 'DOES_NOT_MEET');
  assert.equal(nlv.routeStatus, 'UNSUITABLE');
});
