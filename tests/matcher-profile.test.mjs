import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildUserProfile, describeIncomeRequirement, describeResultIntro, sortRoutesForDisplay, validateAgainstSchema, validateUserProfile } from '../matcher/profile.js';
import { calculateSpain } from '../js/spain-calculator.js';
import { countryOptions, parseCountryCode, searchCountries } from '../matcher/countries.js';

const profileSchema = JSON.parse(await readFile(new URL('../data/schemas/user-profile-v1.schema.json', import.meta.url), 'utf8'));
const spainData = JSON.parse(await readFile(new URL('../data/spain-research-v2.2.json', import.meta.url), 'utf8'));
const context = { calculation_date: '2026-07-19T12:00:00Z', engine_version: '2.1.0', fx: { base_currency: 'USD', rates: { EUR: 0.87, RUB: 80 }, source: 'test', as_of: '2026-07-19T00:00:00Z', max_age_hours: 96 } };

test('visible matcher version matches package version', async () => {
  const [matcherHtml, packageJson] = await Promise.all([
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  assert.match(matcherHtml, new RegExp(`версия ${packageJson.version.replaceAll('.', '\\.')}`));
});

const answers = (overrides = {}) => ({
  currentCountry: 'PH', currentStatus: 'TOURIST_OR_VISA_FREE', applicationMethods: ['ANY'],
  hasPartner: false, partnerIncluded: false, relationshipType: '', lgbtEnabled: false, childAges: [], schoolNeeded: false,
  primaryType: 'REMOTE_EMPLOYMENT', primarySourceCountry: 'US', primaryBankCountry: 'GE', primaryAmount: '4000', primaryCurrency: 'USD', primaryEvidence: 'FULL',
  hasAdditionalIncome: false, partnerHasIncome: false,
  longTermGoal: 'TEMPORARY_RESIDENCE_SUFFICIENT', physicalPresence: 'MOST_OF_YEAR', languageExamReadiness: '', keepRuCitizenship: 'REQUIRED',
  budgetUnknown: false, monthlyBudget: '2500', budgetCurrency: 'USD', citySize: 'ANY', climate: 'ANY', petTypes: ['NONE'],
  specialCircumstances: ['NONE'], medicalEnabled: false, routeSpecificAnswers: {},
  ...overrides,
});

test('new matcher creates a valid user-profile-v1 for one Russian citizen', () => {
  const profile = buildUserProfile(answers());
  assert.deepEqual(profile.citizenships, ['RU']);
  assert.equal(profile.schema_version, 'user-profile-v1');
  assert.equal(validateUserProfile(profile).valid, true);
  assert.deepEqual(validateAgainstSchema(profile, profileSchema), []);
});

test('partner and child remain separate family members', () => {
  const profile = buildUserProfile(answers({ hasPartner: true, partnerIncluded: true, relationshipType: 'MARRIAGE', childAges: ['7'], schoolNeeded: true }));
  assert.equal(profile.family.adults_count, 2);
  assert.deepEqual(profile.family.children, [{ age_years: 7 }]);
  assert.equal(profile.family.school_needed, true);
});

test('registered and unregistered partnerships are preserved', () => {
  for (const relationshipType of ['REGISTERED_PARTNERSHIP', 'UNREGISTERED_PARTNER']) {
    assert.equal(buildUserProfile(answers({ hasPartner: true, partnerIncluded: true, relationshipType })).family.relationship_type, relationshipType);
  }
});

test('LGBT safety personalization remains available without an included partner', () => {
  assert.equal(buildUserProfile(answers({ hasPartner: true, partnerIncluded: true, relationshipType: 'MARRIAGE', lgbtEnabled: true })).lgbt.consent_for_personalization, true);
  const solo = buildUserProfile(answers({ partnerIncluded: false, lgbtEnabled: true }));
  assert.equal(solo.lgbt.enabled, true);
  assert.equal(solo.lgbt.safety_relevant, true);
  assert.equal(solo.lgbt.family_recognition_relevant, null);
});

test('tourist status is not converted to residence', () => {
  assert.equal(buildUserProfile(answers()).residence.current_status, 'TOURIST_OR_VISA_FREE');
});

test('searchable country values are converted to ISO codes', () => {
  assert.equal(parseCountryCode('PH — Филиппины'), 'PH');
  assert.equal(parseCountryCode('Филиппины'), 'PH');
  assert.equal(parseCountryCode('RU'), 'RU');
  assert.equal(parseCountryCode('Филиппины / Philippines — PH'), 'PH');
  assert.match(countryOptions().find((country) => country.code === 'PH').label, /^Филиппины \/ Philippines — PH$/);
});

test('Russian prefix search ranks Philippines before Ethiopia', () => {
  assert.equal(searchCountries('фи')[0].code, 'PH');
  assert.equal(searchCountries('ph')[0].code, 'PH');
});

test('freelance income does not invent a source country', () => {
  const profile = buildUserProfile(answers({ primaryType: 'FREELANCE_OR_SELF_EMPLOYED', primarySourceCountry: '' }));
  assert.equal(profile.income.primary.source_country, null);
  assert.equal(validateUserProfile(profile).valid, true);
  assert.deepEqual(validateAgainstSchema(profile, profileSchema), []);
});

test('user can select current-country and in-country application methods together', () => {
  const profile = buildUserProfile(answers({ applicationMethods: ['CURRENT_COUNTRY', 'IN_COUNTRY_AFTER_ENTRY'] }));
  assert.deepEqual(profile.application_preferences.methods, ['CURRENT_COUNTRY', 'IN_COUNTRY_AFTER_ENTRY']);
  assert.equal(validateAgainstSchema(profile, profileSchema).length, 0);
});

test('income and budget retain their own currencies', () => {
  const profile = buildUserProfile(answers({ primaryAmount: '300000', primaryCurrency: 'RUB', monthlyBudget: '2200', budgetCurrency: 'EUR' }));
  assert.deepEqual(profile.income.primary.monthly_provable, { amount: 300000, currency: 'RUB' });
  assert.deepEqual(profile.preferences.monthly_budget, { amount: 2200, currency: 'EUR' });
});

test('multiple climate preferences are preserved and pass the schema', () => {
  const profile = buildUserProfile(answers({ climates: ['TEMPERATE', 'WARM'], climate: undefined }));
  assert.deepEqual(profile.preferences.climate, ['TEMPERATE', 'WARM']);
  assert.deepEqual(validateAgainstSchema(profile, profileSchema), []);
});

test('unknown budget is null and does not become zero', () => {
  assert.equal(buildUserProfile(answers({ budgetUnknown: true, monthlyBudget: '' })).preferences.monthly_budget, null);
});

test('language answer is only used for PR or citizenship goals', () => {
  assert.equal(buildUserProfile(answers({ languageExamReadiness: 'NO' })).goal.language_exam_readiness, 'DEPENDS_ON_LANGUAGE');
  assert.equal(buildUserProfile(answers({ longTermGoal: 'CITIZENSHIP_REQUIRED', languageExamReadiness: 'NO' })).goal.language_exam_readiness, 'NO');
});

test('optional medical module can be absent', () => {
  assert.equal('optional_modules' in buildUserProfile(answers()), false);
  assert.equal(validateUserProfile(buildUserProfile(answers())).valid, true);
});

test('route-specific follow-up answer is preserved outside the main questions', () => {
  const routeSpecificAnswers = { ES_DNV: { social_security_plan: 'REGISTER_IN_SPAIN' } };
  assert.deepEqual(buildUserProfile(answers({ routeSpecificAnswers })).route_specific_answers, routeSpecificAnswers);
});

test('DNV social security is an initial-permit requirement, not a follow-up question', () => {
  const result = calculateSpain(buildUserProfile(answers()), spainData, context);
  const dnv = result.routes.find((route) => route.routeId === 'ES_DNV');
  assert.deepEqual(dnv.followUpQuestions, []);
  assert.ok(dnv.initialPermitRequirements.some((condition) => condition.includes('социальн')));
});

test('income-type mismatch explicitly says that the amount is not the problem', () => {
  const message = describeIncomeRequirement({ incomeTypeFit: 'DOES_NOT_MEET', thresholdEur: null }, () => '');
  assert.ok(message.includes('Сумма дохода не является причиной'));
  assert.equal(message.includes('порог'), false);
});

test('all unsuitable routes are not presented as the best option', () => {
  const intro = describeResultIntro([{ routeStatus: 'UNSUITABLE' }, { routeStatus: 'UNSUITABLE' }]);
  assert.equal(intro.heading, 'Сейчас подходящих вариантов не найдено');
  assert.equal(intro.routeLabel, 'Наиболее близкий вариант при изменении условий');
});

test('result routes are ordered from suitable through preliminary to unsuitable', () => {
  const routes = [
    { routeId: 'no', routeStatus: 'UNSUITABLE' },
    { routeId: 'pre', routeStatus: 'PRELIMINARY_SUITABLE' },
    { routeId: 'yes', routeStatus: 'SUITABLE' },
    { routeId: 'review', routeStatus: 'INDIVIDUAL_REVIEW_REQUIRED' },
    { routeId: 'conditions', routeStatus: 'SUITABLE_WITH_CONDITIONS' },
  ];
  assert.deepEqual(sortRoutesForDisplay(routes).map(({ routeId }) => routeId), ['yes', 'conditions', 'pre', 'review', 'no']);
  assert.equal(routes[0].routeId, 'no');
});

test('missing child age is reported as a profile validation error', () => {
  const result = validateUserProfile(buildUserProfile(answers({ childAges: [''] })));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.field === 'childAges'));
});

test('machine-readable schema rejects a profile with missing child age', () => {
  const errors = validateAgainstSchema(buildUserProfile(answers({ childAges: [''] })), profileSchema);
  assert.ok(errors.some((error) => error.path.endsWith('.age_years')));
});

test('main matcher has no Spain-specific social-security question', async () => {
  const source = await readFile(new URL('../matcher/index.html', import.meta.url), 'utf8');
  assert.equal(source.includes('социального страхования Испании'), false);
  assert.ok(source.includes('У вас есть гражданство РФ?'));
  assert.match(source, /id="questionnaireView"[^>]*hidden/);
});

test('legacy pilot remains available beside the new matcher', async () => {
  const [legacy, matcher] = await Promise.all([
    readFile(new URL('../pilot/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
  ]);
  assert.ok(legacy.includes('id="profile-form"'));
  assert.ok(matcher.includes('id="matcherForm"'));
});
