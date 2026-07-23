import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildUserProfile, describeIncomeRequirement, describeResultIntro, resolveProvableAmount, sortRoutesForDisplay, validateAgainstSchema, validateUserProfile } from '../matcher/profile.js';
import { calculateSpain, STATUS_LABELS_RU } from '../js/spain-calculator.js';
import { countryOptions, parseCountryCode, searchCountries } from '../matcher/countries.js';
import { DOG_BREEDS, isKnownDogBreed, searchDogBreeds } from '../matcher/dog-breeds.js';

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
  primaryType: 'REMOTE_EMPLOYMENT', primarySourceCountry: 'US', primaryBankCountry: 'GE', primaryTotalAmount: '4000', primaryAmount: '4000', primaryCurrency: 'USD', primaryEvidence: 'FULL',
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


test('dog breed field uses a large searchable breed directory', () => {
  assert.ok(DOG_BREEDS.length >= 200);
  assert.equal(searchDogBreeds('в')[0], 'Веймаранер');
  assert.ok(searchDogBreeds('корги').includes('Вельш-корги пемброк'));
  assert.equal(isKnownDogBreed('Метис'), true);
  assert.equal(isKnownDogBreed('Не знаю'), true);
  assert.equal(isKnownDogBreed('Другая известная порода'), false);
});

test('individual review status has a concise user-facing label', () => {
  assert.equal(STATUS_LABELS_RU.INDIVIDUAL_REVIEW_REQUIRED, 'Нужна проверка');
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
  const profile = buildUserProfile(answers({ primaryTotalAmount: '300000', primaryAmount: '300000', primaryCurrency: 'RUB', monthlyBudget: '2200', budgetCurrency: 'EUR' }));
  assert.deepEqual(profile.income.primary.monthly_provable, { amount: 300000, currency: 'RUB' });
  assert.deepEqual(profile.preferences.monthly_budget, { amount: 2200, currency: 'EUR' });
});

test('removed city and climate questions use neutral profile defaults', () => {
  const profile = buildUserProfile(answers({ climates: ['TEMPERATE', 'WARM'], climate: undefined }));
  assert.equal(profile.preferences.city_size, 'ANY');
  assert.deepEqual(profile.preferences.climate, ['ANY']);
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
  assert.equal(source.includes('id="citySize"'), false);
  assert.equal(source.includes('name="climate"'), false);
});

test('root and legacy pilot redirect to the public matcher and are not linked from it', async () => {
  const [root, legacy, matcher] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../pilot/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(root, /location\.replace\('\.\/matcher\/'\)/);
  assert.match(legacy, /location\.replace\('\.\.\/matcher\/'\)/);
  assert.ok(matcher.includes('id="matcherForm"'));
  assert.equal(matcher.includes('href="../"'), false);
  assert.equal(matcher.includes('href="../pilot/"'), false);
});

test('result UI shows city comparisons and a human-readable row-based LGBT section', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../matcher/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /Самый жаркий/);
  assert.match(app, /Самый прохладный/);
  assert.match(app, /Самый дорогой/);
  assert.match(app, /Самый недорогой/);
  assert.match(app, /ЛГБТ: права, семья и иммиграция/);
  assert.match(app, /Брак и переезд с супругом/);
  assert.match(app, /Международная защита/);
  assert.match(app, /Достаточно безопасно/);
  assert.match(app, /Что меняется/);
  assert.equal(app.includes('Дети и родительство'), false);
  assert.equal(app.includes('Права транс-людей'), false);
  assert.equal(app.includes('Отдельной «ЛГБТ-визы» нет'), false);
  assert.equal(app.includes('Что не равно'), false);
  assert.equal(styles.includes('.lgbt-grid'), false);
  assert.match(styles, /\.lgbt-row\{display:grid/);
  assert.equal(app.includes('средние дневные минимумы и максимумы'), false);
  assert.equal(app.includes('Одна анкета независимо проверена'), false);
  assert.equal(app.includes('Все варианты ниже относятся только к стране'), false);
  assert.equal(app.includes('Школа: без платной международной школы'), false);
  assert.match(app, /Срок до гражданства:/);
  assert.equal(app.includes('Для выбранного размера города в пакете пока нет отдельной модели'), false);
  assert.match(styles, /\.country-workspace\{display:grid/);
  assert.match(styles, /\.country-tabs\{position:sticky/);
  assert.match(styles, /@media\(max-width:900px\)[\s\S]*overflow-x:auto/);
  assert.equal(app.includes('Ваш бюджет не указан'), false);
  assert.match(app, /budgetDerivedFromIncome/);
  assert.match(app, /data-country-tab/);
  assert.equal(app.includes('Сравнение стран'), false);
  assert.equal(app.includes('Страна расчёта'), false);
  assert.match(styles, /\.country-tab \.status-pill\{grid-column:2/);
});


test('income confirmation mode resolves one visible amount flow', () => {
  assert.equal(resolveProvableAmount('4000', 'FULL', ''), 4000);
  assert.equal(resolveProvableAmount('4000', 'PARTIAL', '2500'), 2500);
  assert.equal(resolveProvableAmount('4000', 'PARTIAL', ''), null);
  assert.equal(resolveProvableAmount('4000', 'NONE', '2500'), 0);
  assert.equal(resolveProvableAmount('4000', '', '2500'), null);
});

test('income step uses total income plus a conditional partial amount field', async () => {
  const [matcher, app] = await Promise.all([
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(matcher, /Какую часть дохода можете подтвердить документами\?/);
  assert.match(matcher, /value="FULL">Весь доход/);
  assert.match(matcher, /value="PARTIAL">Только часть/);
  assert.match(matcher, /value="NONE">Пока не могу подтвердить/);
  assert.match(matcher, /id="primaryAmountField"[^>]*hidden/);
  assert.match(app, /partial\.trim\(\) === ''/);
  assert.match(app, /Выберите, какую часть дохода можете подтвердить/);
});

test('income controls align and share one control radius', async () => {
  const styles = await readFile(new URL('../matcher/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /--control-radius:12px/);
  assert.match(styles, /\.income-block \.field>span:first-child\{[^}]*min-height:48px/);
  assert.match(styles, /\.field input,\.field select,\.field textarea\{border-radius:var\(--control-radius\)!important\}/);
  assert.match(styles, /\.money-combo\{[^}]*border-radius:var\(--control-radius\)/);
});

test('matcher cache keys include the current release for code and country data', async () => {
  const [matcher, app] = await Promise.all([
    readFile(new URL('../matcher/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../matcher/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(matcher, /styles\.css\?v=0\.12\.5/);
  assert.match(matcher, /app\.js\?v=0\.12\.5/);
  assert.match(app, /uruguay-research-v2\.2\.json\?v=0\.12\.5/);
  assert.match(app, /spain-adapter\.js\?v=0\.12\.5/);
});

test('README describes the live matcher and maintenance rule', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /immigration-country-matcher\/matcher\//);
  assert.match(readme, /README обновляется при каждом изменении/);
  assert.match(readme, /0\.12\.5/);
  assert.equal(readme.includes('Рабочий пилот Испании'), false);
});
