import { CalculationContextError } from '../engine/calculate-country.js';
import { ROUTE_STATUSES, STATUS_LABELS_RU, resolveStatusConflict } from '../engine/status-contract.js';
import { INCOME_TYPE_BY_SCENARIO, ROUTE_RULES } from './spain-rules.js';

const outcome = (status, code, message, options = {}) => ({ status, code, message, condition: options.condition ?? null, field: options.field ?? null });
const fits = (checks) => checks.some(({ status }) => status === ROUTE_STATUSES.UNSUITABLE) ? 'DOES_NOT_MEET'
  : checks.some(({ status }) => [ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, ROUTE_STATUSES.PRELIMINARY_SUITABLE].includes(status)) ? 'UNKNOWN' : 'MEETS';

function normalizeProfile(profile = {}) {
  const universalFamily = profile.family || {};
  const adults = Math.max(1, Number(universalFamily.adults_count ?? profile.adults ?? 1));
  const children = Math.max(0, Number(universalFamily.children?.length ?? profile.children ?? 0));
  return {
    applicationNationality: profile.applicationNationality || profile.citizenship || 'RU',
    plannedBasis: profile.plannedBasis || profile.scenario || 'REMOTE_EMPLOYEE',
    currentLocation: profile.currentLocation || 'THIRD_COUNTRY', legalResidence: profile.legalResidence !== false,
    monthlyIncomeUsd: Math.max(0, Number(profile.monthlyIncomeUsd ?? profile.income?.monthly_amount_usd ?? 0)),
    bankCountry: profile.bankCountry || 'OTHER', socialSecurityPlan: profile.socialSecurityPlan || 'REGISTER_SPAIN',
    adults, children, relationshipType: adults > 1 ? (profile.relationshipType || 'MARRIAGE') : 'NONE',
    sameSexFamily: Boolean(profile.sameSexFamily && adults > 1), needsFamilyVisa: Boolean(profile.needsFamilyVisa && adults > 1),
    schoolNeeded: Boolean(profile.schoolNeeded && children > 0), goal: profile.goal || 'TEMPORARY_RESIDENCE',
    monthsPerYear: Math.min(12, Math.max(0, Number(profile.monthsPerYear ?? 12))), languageReadiness: profile.languageReadiness || 'YES',
    keepRuCitizenship: profile.keepRuCitizenship || 'DESIRABLE', monthlyBudgetUsd: Math.max(0, Number(profile.monthlyBudgetUsd || 0)),
    citySize: profile.citySize || 'ANY', pet: profile.pet || 'NONE', dogBreed: String(profile.dogBreed || '').trim(),
    medicineRequired: Boolean(profile.medicineRequired),
  };
}

function validateContext(profile, countryPackage, context) {
  const rate = context?.fx?.rates?.EUR;
  const asOf = Date.parse(context?.fx?.as_of);
  const calculationDate = Date.parse(context?.calculation_date);
  const maxAge = Number(context?.fx?.max_age_hours);
  const stale = Number.isFinite(asOf) && Number.isFinite(calculationDate) && Number.isFinite(maxAge)
    ? calculationDate - asOf > maxAge * 3600000 : true;
  if (!(Number(rate) > 0) || stale) {
    throw new CalculationContextError('Для расчёта необходим актуальный положительный курс EUR.', { currency: 'EUR' });
  }
}

function buildIndexes(data) {
  return {
    data,
    routeIncome: new Map((data.route_income || []).map((row) => [`${row.route_id}:${row.accepted_income_type}`, row])),
    routeFamily: new Map((data.route_family || []).map((row) => [row.route_id, row])),
    routeStatus: new Map((data.route_status || []).map((row) => [row.route_id, row])),
    routeWork: new Map((data.route_work || []).map((row) => [row.route_id, row])),
    sources: new Map((data.sources || []).map((row) => [row.source_id, row])),
  };
}

function familyThreshold(rule, profile) {
  const dependants = Math.max(0, profile.adults + profile.children - 1);
  let threshold = Number(rule.minimum_income_main_applicant || 0);
  if (dependants > 0) threshold += Number(rule.partner_increment_value || 0);
  if (dependants > 1) threshold += Number(rule.child_increment_value || 0) * (dependants - 1);
  return threshold;
}

function applicationChecks(route, profile) {
  const checks = [];
  checks.push(route.russian_citizens_allowed !== 'YES' && profile.applicationNationality === 'RU'
    ? outcome(ROUTE_STATUSES.UNSUITABLE, 'nationality_not_allowed', 'Маршрут не подтверждён для подачи по гражданству РФ.')
    : outcome(ROUTE_STATUSES.SUITABLE, 'nationality_allowed', 'Гражданство заявителя допускается.'));
  if (profile.currentLocation === 'SPAIN') checks.push(route.in_country_application_allowed === 'YES'
    ? outcome(ROUTE_STATUSES.SUITABLE, 'application_in_country', 'Подача внутри страны предусмотрена.')
    : outcome(ROUTE_STATUSES.UNSUITABLE, 'application_in_country_blocked', 'Подача внутри страны не предусмотрена.'));
  else if (profile.currentLocation === 'RUSSIA') checks.push(route.application_from_russia === 'YES'
    ? outcome(ROUTE_STATUSES.SUITABLE, 'application_from_russia', 'Подача из России предусмотрена.')
    : outcome(ROUTE_STATUSES.UNSUITABLE, 'application_from_russia_blocked', 'Подача из России не подтверждена.'));
  else checks.push(route.requires_legal_residence_in_application_country === 'YES' && !profile.legalResidence
    ? outcome(ROUTE_STATUSES.UNSUITABLE, 'legal_residence_required', 'Для подачи требуется законное резидентство.')
    : outcome(ROUTE_STATUSES.SUITABLE, 'application_location_ok', 'Место подачи соответствует известным правилам.'));
  return checks;
}

function incomeEvaluation(route, indexes, profile, context) {
  const rule = ROUTE_RULES[route.route_id] || { incomeTypes: [] };
  const incomeType = INCOME_TYPE_BY_SCENARIO[profile.plannedBasis];
  const incomeEur = profile.monthlyIncomeUsd * Number(context.fx.rates.EUR);
  if (!rule.incomeTypes.includes(incomeType)) return { checks: [outcome(ROUTE_STATUSES.UNSUITABLE, 'income_type_incompatible', 'Тип дохода несовместим с правилами этого маршрута.')], incomeEur, thresholdEur: null, incomeTypeFit: 'DOES_NOT_MEET', incomeFit: 'NOT_APPLICABLE' };
  if (rule.individualReview) return { checks: [outcome(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'business_case_review', 'Требуется индивидуальная оценка бизнес-плана и проекта.')], incomeEur, thresholdEur: null, incomeTypeFit: 'MEETS', incomeFit: 'UNKNOWN' };
  if (rule.missingSalaryThreshold) return { checks: [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'hq_salary_missing', 'Официальный зарплатный порог 2026 ещё не внесён.')], incomeEur, thresholdEur: null, incomeTypeFit: 'MEETS', incomeFit: 'UNKNOWN' };
  const incomeRule = indexes.routeIncome.get(`${route.route_id}:${incomeType}`);
  if (!incomeRule) return { checks: [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'income_rule_missing', 'Подтверждённое правило дохода отсутствует.')], incomeEur, thresholdEur: null, incomeTypeFit: 'MEETS', incomeFit: 'UNKNOWN' };
  const thresholdEur = familyThreshold(incomeRule, profile);
  const checks = [];
  if (profile.monthlyIncomeUsd <= 0) checks.push(outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'income_missing', 'Подтверждаемый доход не указан.'));
  else if (incomeEur < thresholdEur) checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'income_below_threshold', `Доход после пересчёта составляет около ${Math.round(incomeEur)} EUR, требование маршрута — ${Math.round(thresholdEur)} EUR в месяц.`));
  else if (incomeEur < thresholdEur * 1.1) checks.push(outcome(ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS, 'income_close_to_threshold', 'Доход превышает порог менее чем на 10%.', { condition: 'Поддерживать доход минимум на 10% выше порога.' }));
  else checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'income_meets_threshold', 'Доход превышает семейный порог.'));
  if (rule.socialSecurityReview) {
    if (profile.bankCountry === 'RU') checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'russian_bank_documents_open', 'Приём выписок российского банка требует подтверждения.'));
    checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'social_security_rule_open', 'Применимое правило социального страхования для российского кейса требует подтверждения.'));
  }
  return { checks, incomeEur, thresholdEur, incomeTypeFit: 'MEETS', incomeFit: profile.monthlyIncomeUsd <= 0 ? 'UNKNOWN' : incomeEur >= thresholdEur ? 'MEETS' : 'DOES_NOT_MEET' };
}

function familyChecks(route, indexes, profile) {
  if (profile.adults + profile.children <= 1) return [outcome(ROUTE_STATUSES.SUITABLE, 'no_dependants', 'Зависимые члены семьи отсутствуют.')];
  const rule = indexes.routeFamily.get(route.route_id);
  if (!rule) return [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'family_rule_missing', 'Семейные правила не структурированы.')];
  const checks = [];
  if (profile.adults > 1 && profile.needsFamilyVisa) checks.push(rule.partner_allowed === 'YES'
    ? outcome(ROUTE_STATUSES.SUITABLE, 'partner_allowed', 'Партнёр может быть включён.')
    : outcome(ROUTE_STATUSES.UNSUITABLE, 'partner_not_allowed', 'Партнёр не может быть включён.'));
  if (profile.children > 0) checks.push(rule.children_allowed === 'YES'
    ? outcome(ROUTE_STATUSES.SUITABLE, 'children_allowed', 'Дети могут быть включены.')
    : outcome(ROUTE_STATUSES.UNSUITABLE, 'children_not_allowed', 'Дети не могут быть включены.'));
  return checks.length ? checks : [outcome(ROUTE_STATUSES.SUITABLE, 'family_ok', 'Семейная конфигурация соответствует маршруту.')];
}

function goalChecks(route, indexes, profile) {
  if (profile.goal === 'TEMPORARY_RESIDENCE') return [outcome(ROUTE_STATUSES.SUITABLE, 'temporary_goal', 'Маршрут предоставляет первоначальный статус проживания.')];
  const rule = indexes.routeStatus.get(route.route_id);
  if (!rule) return [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'long_term_rule_missing', 'Долгосрочный путь не заполнен.')];
  const field = profile.goal === 'PR_REQUIRED' ? 'path_to_pr' : 'path_to_citizenship';
  const label = profile.goal === 'PR_REQUIRED' ? 'ПМЖ' : 'гражданству';
  const checks = [rule[field] === 'YES' ? outcome(ROUTE_STATUSES.SUITABLE, 'long_term_path', `Маршрут засчитывается в путь к ${label}.`)
    : rule[field] === 'CONDITIONAL' ? outcome(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'long_term_conditional', `Путь к ${label} требует индивидуальной проверки.`)
      : outcome(ROUTE_STATUSES.UNSUITABLE, 'long_term_unavailable', `Подтверждённого пути к ${label} нет.`)];
  if (profile.goal === 'CITIZENSHIP_REQUIRED' && profile.keepRuCitizenship === 'REQUIRED') checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'renunciation_conflict', 'сохранение указано как обязательное и конфликтует с известным правилом.'));
  if (profile.monthsPerYear < 10) checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'presence_too_low', 'Планируется слишком мало времени в стране.'));
  return checks;
}

function evaluateRoute(route, indexes, profile, context) {
  const application = applicationChecks(route, profile);
  const income = incomeEvaluation(route, indexes, profile, context);
  const family = familyChecks(route, indexes, profile);
  const goal = goalChecks(route, indexes, profile);
  const checks = [...application, ...income.checks, ...family, ...goal];
  const routeStatus = resolveStatusConflict(checks.map(({ status }) => status));
  const messages = (status) => [...new Set(checks.filter((check) => check.status === status).map((check) => check.condition || check.message))];
  const missing = messages(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA);
  const preliminary = messages(ROUTE_STATUSES.PRELIMINARY_SUITABLE);
  const review = messages(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED);
  const conditions = messages(ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS);
  return {
    routeId: route.route_id, routeName: route.name_ru || route.official_name, routeStatus, statusLabel: STATUS_LABELS_RU[routeStatus],
    applicationNationality: profile.applicationNationality, thresholdEur: income.thresholdEur, incomeEur: income.incomeEur,
    goalFit: fits(goal), applicationFit: fits(application), familyFit: fits(family), incomeTypeFit: income.incomeTypeFit, incomeFit: income.incomeFit,
    countryMissingCount: missing.length, clientMissingCount: preliminary.length, conditionsCount: conditions.length,
    scenarioAffinity: ROUTE_RULES[route.route_id]?.scenarios.includes(profile.plannedBasis) ? 1 : 0,
    checks, conditions, blockers: messages(ROUTE_STATUSES.UNSUITABLE), missing, preliminary, review,
    primarySourceId: route.primary_source_id, longTerm: indexes.routeStatus.get(route.route_id) || null,
    work: indexes.routeWork.get(route.route_id) || null, family: indexes.routeFamily.get(route.route_id) || null,
  };
}

function familyCost(city, profile) {
  if (profile.adults === 1 && profile.children === 0) return Number(city.estimated_monthly_cost_single_usd || 0);
  if (profile.adults === 2 && profile.children === 0) return Number(city.estimated_monthly_cost_couple_usd || 0);
  if (profile.adults === 2 && profile.children === 1) return Number(city.estimated_monthly_cost_family_1_child_usd || 0);
  return Number(city.estimated_monthly_cost_single_usd || 0) + Math.max(0, profile.adults - 1) * Number(city.additional_adult_cost_usd || 0) + profile.children * Number(city.additional_child_cost_usd || 0);
}

function evaluatePractical(data, profile) {
  const cities = (data.cities || []).filter((city) => profile.citySize === 'ANY' || city.population_category === profile.citySize).map((city) => {
    const costUsd = familyCost(city, profile);
    const budgetFit = profile.monthlyBudgetUsd <= 0 ? 'NOT_APPLICABLE' : costUsd <= profile.monthlyBudgetUsd ? 'MEETS' : 'DOES_NOT_MEET';
    const missing = [];
    if (profile.pet !== 'NONE' && city.pet_friendly_housing === 'UNKNOWN') missing.push('Доступность аренды с животными ещё не подтверждена.');
    if (profile.schoolNeeded && city.international_school_available !== 'YES') missing.push('Международная школа не подтверждена.');
    return { cityId: city.city_id, cityName: city.name_ru, populationCategory: city.population_category, costUsd, budgetFit,
      budgetProximity: 'NOT_APPLICABLE', practicalEvaluation: budgetFit === 'DOES_NOT_MEET' ? 'DOES_NOT_MEET' : missing.length ? 'UNKNOWN' : 'MEETS',
      missing, airport: city.airport_name, climate: city.climate_category, primarySourceId: city.primary_source_id };
  });
  const practicalRank = { MEETS: 3, UNKNOWN: 2, DOES_NOT_MEET: 1 };
  cities.sort((a, b) => practicalRank[b.practicalEvaluation] - practicalRank[a.practicalEvaluation] || a.costUsd - b.costUsd);
  return { cities, recommendedCity: cities[0] || null };
}

function determineCountryGroup(bestRoute, practical, profile) {
  if (!bestRoute || bestRoute.routeStatus === ROUTE_STATUSES.UNSUITABLE) return 'UNSUITABLE';
  if (practical.recommendedCity?.practicalEvaluation === 'DOES_NOT_MEET') return 'LEGAL_BUT_PRACTICALLY_UNSUITABLE';
  if ([ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED].includes(bestRoute.routeStatus)) return 'REQUIRES_REVIEW';
  if (bestRoute.routeStatus === ROUTE_STATUSES.PRELIMINARY_SUITABLE) return 'PRELIMINARY';
  if (profile.pet !== 'NONE' && practical.recommendedCity?.practicalEvaluation === 'UNKNOWN') return 'REQUIRES_REVIEW';
  return 'SUITABLE';
}

function collectSources(data, indexes, bestRoute, practical) {
  const ids = new Set([bestRoute?.primarySourceId, bestRoute?.longTerm?.source_id, bestRoute?.work?.source_id, bestRoute?.family?.source_id, practical.recommendedCity?.primarySourceId, data.country?.primary_source_id].filter(Boolean));
  return [...ids].map((id) => indexes.sources.get(id)).filter(Boolean);
}

function collectPracticalMissing(data, profile, practical) {
  const missing = [...(practical.recommendedCity?.missing || [])];
  if (profile.pet === 'DOG' && data.pet_rules?.find((rule) => rule.animal_type === 'DOG')?.rabies_titer_required === 'UNKNOWN') missing.push('Необходимость титра антител для ввоза собаки требует актуальной проверки.');
  if (profile.medicineRequired) missing.push('Наличие лекарства и правила ввоза личного запаса проверяются отдельно.');
  return missing;
}

export const spainAdapter = Object.freeze({ id: 'spain', normalizeProfile, validateContext, buildIndexes, evaluateRoute, evaluatePractical, determineCountryGroup, collectSources, collectPracticalMissing });
