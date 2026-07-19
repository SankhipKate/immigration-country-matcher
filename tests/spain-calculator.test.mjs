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

const baseProfile = {
  applicationNationality: 'RU',
  currentLocation: 'THIRD_COUNTRY',
  legalResidence: true,
  eurUsdRate: 1.144,
  bankCountry: 'OTHER',
  socialSecurityPlan: 'REGISTER_SPAIN',
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

const calculate = (overrides) => calculateSpain({ ...baseProfile, ...overrides }, data);

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
  assert.equal(result.bestRoute.routeStatus, 'INSUFFICIENT_COUNTRY_DATA');
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

test('Spanish job offer exposes the unresolved 2026 salary threshold', () => {
  const result = calculate({ plannedBasis: 'SPANISH_JOB_OFFER', monthlyIncomeUsd: 5000 });
  assert.equal(result.bestRoute.routeId, 'ES_HIGHLY_QUALIFIED');
  assert.equal(result.bestRoute.routeStatus, 'INSUFFICIENT_COUNTRY_DATA');
});

test('citizenship goal conflicts with mandatory preservation of Russian citizenship', () => {
  const result = calculate({
    plannedBasis: 'REMOTE_EMPLOYEE',
    monthlyIncomeUsd: 5000,
    goal: 'CITIZENSHIP_REQUIRED',
    keepRuCitizenship: 'REQUIRED',
  });
  assert.equal(result.bestRoute.routeId, 'ES_DNV');
  assert.equal(result.bestRoute.routeStatus, 'UNSUITABLE');
  assert.ok(result.bestRoute.blockers.some((message) => message.includes('сохранение указано как обязательное')));
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
    monthlyBudgetUsd: 3000,
  });
  assert.equal(result.bestRoute.routeStatus, 'INSUFFICIENT_COUNTRY_DATA');
  assert.equal(result.country.group, 'LEGAL_BUT_PRACTICALLY_UNSUITABLE');
});

test('all six Spain routes are independently evaluated', () => {
  const result = calculate({ plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 3200 });
  assert.equal(result.routes.length, 6);
  assert.equal(result.bestRoute.routeId, 'ES_NLV');
  assert.ok(result.routes.every((route) => !Object.hasOwn(route, 'selection' + 'Score')));
});

test('family keeps adults and children as separate counts', () => {
  const result = calculateSpain({ ...baseProfile, family: { adults_count: 2, children: [{ age_years: 13 }] }, plannedBasis: 'PASSIVE_INCOME', monthlyIncomeUsd: 5000 }, data);
  assert.equal(result.profile.adults, 2);
  assert.equal(result.profile.children, 1);
});

test('legacy wrapper re-exports public Russian labels', () => {
  assert.equal(STATUS_LABELS_RU.SUITABLE, 'Подходит');
  assert.equal(COUNTRY_GROUP_LABELS_RU.SUITABLE, 'Подходит');
});

test('canonical conflict and selection orders remain independent', () => {
  assert.equal(resolveStatusConflict(['INSUFFICIENT_COUNTRY_DATA', 'INDIVIDUAL_REVIEW_REQUIRED']), 'INDIVIDUAL_REVIEW_REQUIRED');
  assert.equal(selectBestVariant([{ routeId: 'review', routeStatus: 'INDIVIDUAL_REVIEW_REQUIRED' }, { routeId: 'missing', routeStatus: 'INSUFFICIENT_COUNTRY_DATA' }]).routeId, 'missing');
});
