import { CalculationContextError } from '../engine/calculate-country.js';
import { convertMoney } from '../engine/currency.js';
import { ROUTE_STATUSES, STATUS_LABELS_RU, resolveStatusConflict } from '../engine/status-contract.js';
import { INCOME_TYPE_BY_SCENARIO, ROUTE_RULES } from './spain-rules.js';

const outcome = (status, code, message, options = {}) => ({ status, code, message, condition: options.condition ?? null, field: options.field ?? null });
const EU_EEA_SWISS = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'FI', 'FR', 'GR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'CH']);
const fits = (checks) => checks.some(({ status }) => status === ROUTE_STATUSES.UNSUITABLE) ? 'DOES_NOT_MEET'
  : checks.some(({ status }) => [ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, ROUTE_STATUSES.PRELIMINARY_SUITABLE].includes(status)) ? 'UNKNOWN' : 'MEETS';

function normalizeProfile(profile = {}, context) {
  const family = profile.family || {};
  const primaryIncome = profile.income?.primary || {};
  const budget = profile.preferences?.monthly_budget;
  const incomeConversion = convertMoney(primaryIncome.monthly_provable ?? null, 'USD', context, 'income.primary.monthly_provable');
  const budgetConversion = convertMoney(budget, 'USD', context, 'preferences.monthly_budget');
  return {
    citizenships: [...profile.citizenships],
    plannedBasis: profile.__legacy_scenario ?? primaryIncome.type ?? null,
    currentCountry: profile.residence?.current_country ?? null,
    currentStatus: profile.residence?.current_status ?? null,
    applicationMethods: profile.application_preferences?.methods ?? [],
    monthlyIncomeUsd: incomeConversion?.convertedAmount ?? null,
    incomeMoney: primaryIncome.monthly_provable ?? null,
    incomeConversion,
    incomeSourceCountry: primaryIncome.source_country ?? null,
    bankCountry: primaryIncome.bank_country ?? null,
    adults: family.adults_count ?? null,
    children: Array.isArray(family.children) ? family.children.map((child) => ({ ...child })) : null,
    partnerIncluded: family.partner_included ?? null,
    relationshipType: family.relationship_type ?? null,
    lgbt: profile.lgbt ?? null,
    schoolNeeded: family.school_needed ?? null,
    goal: profile.goal?.long_term ?? null,
    physicalPresence: profile.goal?.physical_presence ?? null,
    languageReadiness: profile.goal?.language_exam_readiness ?? null,
    keepRuCitizenship: profile.goal?.keep_russian_citizenship ?? null,
    monthlyBudgetUsd: budgetConversion?.convertedAmount ?? null,
    budgetMoney: budget ?? null,
    budgetConversion,
    citySize: profile.preferences?.city_size ?? null,
    petTypes: profile.pets?.types ?? null,
    medicineRequired: Boolean(profile.optional_modules?.medical?.specific_medicine_required),
  };
}

export function legacyPilotProfileToUniversal(profile = {}) {
  const childCount = Number.isInteger(profile.children) ? profile.children : 0;
  const scenarioTypes = {
    REMOTE_EMPLOYEE: 'REMOTE_EMPLOYMENT', REMOTE_CONTRACTOR: 'CONTRACTOR', FOREIGN_COMPANY_OWNER: 'COMPANY_OWNER',
    PASSIVE_INCOME: 'PASSIVE_INCOME', STUDY: 'OTHER_REGULAR_REMOTE_INCOME', SELF_EMPLOYED_SPAIN: 'FREELANCE_OR_SELF_EMPLOYED',
    INNOVATIVE_PROJECT: 'SOLE_PROPRIETOR', SPANISH_JOB_OFFER: 'OTHER_REGULAR_REMOTE_INCOME',
  };
  const locationCountry = profile.currentLocation === 'SPAIN' ? 'ES' : profile.currentLocation === 'RUSSIA' ? 'RU' : 'PH';
  const locationStatus = profile.currentLocation === 'RUSSIA' ? 'CITIZENSHIP'
    : profile.legalResidence === true ? 'TEMPORARY_RESIDENCE'
      : profile.legalResidence === false ? 'TOURIST_OR_VISA_FREE' : null;
  const longTerm = profile.goal === 'TEMPORARY_RESIDENCE' ? 'TEMPORARY_RESIDENCE_SUFFICIENT' : profile.goal ?? null;
  const presence = Number(profile.monthsPerYear) >= 10 ? 'MOST_OF_YEAR' : Number(profile.monthsPerYear) >= 8 ? 'AT_LEAST_8_MONTHS'
    : Number(profile.monthsPerYear) >= 6 ? 'AT_LEAST_6_MONTHS' : Number.isFinite(Number(profile.monthsPerYear)) ? 'LESS_THAN_6_MONTHS' : null;
  const language = profile.languageReadiness === 'BASIC' ? 'BASIC_ONLY' : profile.languageReadiness;
  return {
    schema_version: 'user-profile-v1',
    __legacy_scenario: profile.plannedBasis ?? null,
    citizenships: [profile.applicationNationality || 'RU'],
    residence: { current_country: locationCountry, current_status: locationStatus },
    application_preferences: { methods: profile.currentLocation === 'SPAIN' ? ['IN_COUNTRY_AFTER_ENTRY'] : profile.currentLocation === 'RUSSIA' ? ['RUSSIA'] : ['CURRENT_COUNTRY'] },
    family: { adults_count: profile.adults ?? null, partner_included: Number(profile.adults) > 1 && Boolean(profile.needsFamilyVisa), relationship_type: Number(profile.adults) > 1 ? profile.relationshipType ?? null : null, children: Array.from({ length: childCount }, () => ({ age_years: null })), school_needed: Boolean(profile.schoolNeeded) },
    lgbt: { enabled: Boolean(profile.sameSexFamily), consent_for_personalization: Boolean(profile.sameSexFamily), family_recognition_relevant: Boolean(profile.sameSexFamily) },
    income: { primary: { type: scenarioTypes[profile.plannedBasis] ?? null, source_country: profile.incomeSourceCountry ?? null, bank_country: profile.bankCountry ?? null, monthly_provable: profile.monthlyIncomeUsd == null ? null : { amount: Number(profile.monthlyIncomeUsd), currency: 'USD' } } },
    goal: { long_term: longTerm, physical_presence: presence, language_exam_readiness: language ?? null, keep_russian_citizenship: profile.keepRuCitizenship ?? null },
    preferences: { monthly_budget: profile.monthlyBudgetUsd == null ? null : { amount: Number(profile.monthlyBudgetUsd), currency: 'USD' }, city_size: profile.citySize ?? null },
    pets: { types: [profile.pet || 'NONE'] }, special_circumstances: ['NONE'], optional_modules: { medical: { specific_medicine_required: Boolean(profile.medicineRequired) } },
    route_specific_answers: { ES_DNV: { social_security_plan: profile.socialSecurityPlan ?? null } },
  };
}

function validateContext(profile, countryPackage, context) {
  const rate = context?.fx?.base_currency === 'EUR' ? 1 : context?.fx?.rates?.EUR;
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
  let threshold = Number(rule.minimum_income_main_applicant || 0);
  threshold += Math.max(0, Number(profile.adults || 1) - 1) * Number(rule.partner_increment_value || 0);
  threshold += (profile.children?.length || 0) * Number(rule.child_increment_value || 0);
  return threshold;
}

function applicationChecks(route, indexes, profile) {
  const checks = [];
  const allowed = route.allowed_nationalities;
  if (!Array.isArray(allowed) || allowed.length === 0) checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'nationality_rule_missing', 'Допустимые гражданства для маршрута не исследованы.'));
  else {
    const nationality = profile.applicationNationality;
    if (nationality === 'RU' && !['YES', 'NO'].includes(route.russian_citizens_allowed)) {
      checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'russian_nationality_rule_unknown', 'Доступность маршрута для граждан РФ не подтверждена.'));
    } else {
      const allowedByCategory = nationality === 'RU' ? route.russian_citizens_allowed === 'YES' && allowed.includes('THIRD_COUNTRY')
        : nationality === 'ES' ? allowed.includes('ES')
        : EU_EEA_SWISS.has(nationality) ? allowed.includes('EU_EEA_SWITZERLAND')
          : allowed.includes('THIRD_COUNTRY');
      const nationalityAllowed = nationality === 'RU'
        ? route.russian_citizens_allowed === 'YES' && (allowed.includes('RU') || allowedByCategory)
        : allowed.includes(nationality) || allowedByCategory;
      checks.push(nationalityAllowed
        ? outcome(ROUTE_STATUSES.SUITABLE, 'nationality_allowed', 'Гражданство заявителя допускается.')
        : outcome(ROUTE_STATUSES.UNSUITABLE, 'nationality_not_allowed', 'Маршрут недоступен для выбранного гражданства.'));
    }
  }
  if (!profile.currentCountry || !profile.currentStatus || profile.applicationMethods.length === 0) {
    checks.push(outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'application_details_missing', 'Нужно уточнить место, статус и допустимый способ подачи.', { field: 'residence' }));
  } else {
    const routeMethods = new Set(route.application_methods || []);
    const selected = profile.applicationMethods.includes('ANY')
      ? ['CURRENT_COUNTRY', 'RUSSIA', 'IN_COUNTRY_AFTER_ENTRY'] : profile.applicationMethods;
    const targetCountry = indexes.data?.country?.country_id ?? indexes.data?.country_id;
    const confirmedResidentStatuses = new Set(['CITIZENSHIP', 'PERMANENT_RESIDENCE', 'TEMPORARY_RESIDENCE', 'WORK_OR_FAMILY_VISA', 'STUDENT_STATUS']);
    const evaluateMethod = (method) => {
      if (method === 'IN_COUNTRY_AFTER_ENTRY') {
        if (!routeMethods.has('IN_COUNTRY')) return outcome(ROUTE_STATUSES.UNSUITABLE, 'in_country_method_not_allowed', 'Подача внутри целевой страны не предусмотрена.');
        if (route.in_country_application_allowed === 'YES') return outcome(ROUTE_STATUSES.SUITABLE, 'in_country_method_allowed', 'Подача внутри целевой страны предусмотрена.');
        if (route.in_country_application_allowed === 'NO') return outcome(ROUTE_STATUSES.UNSUITABLE, 'in_country_method_not_allowed', 'Подача внутри целевой страны не предусмотрена.');
        return outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'in_country_method_unknown', 'Правило подачи внутри целевой страны не подтверждено.');
      }
      if (method === 'RUSSIA') {
        if (!routeMethods.has('CURRENT_COUNTRY')) return outcome(ROUTE_STATUSES.UNSUITABLE, 'russia_method_not_allowed', 'Консульская подача из России не предусмотрена.');
        if (route.application_from_russia === 'YES') return outcome(ROUTE_STATUSES.SUITABLE, 'russia_method_allowed', 'Подача из России предусмотрена.');
        if (route.application_from_russia === 'NO') return outcome(ROUTE_STATUSES.UNSUITABLE, 'russia_method_not_allowed', 'Подача из России не предусмотрена.');
        return outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'russia_method_unknown', 'Возможность подачи из России не подтверждена.');
      }
      if (method !== 'CURRENT_COUNTRY' || !routeMethods.has('CURRENT_COUNTRY')) return outcome(ROUTE_STATUSES.UNSUITABLE, 'current_country_method_not_allowed', 'Консульская подача в текущей стране не предусмотрена.');
      if (profile.currentCountry === targetCountry) return outcome(ROUTE_STATUSES.UNSUITABLE, 'current_country_is_target', 'CURRENT_COUNTRY не применяется внутри целевой страны.');
      if (profile.currentCountry === 'RU') {
        if (route.application_from_russia === 'YES') return outcome(ROUTE_STATUSES.SUITABLE, 'current_country_russia_allowed', 'Консульская подача в России предусмотрена.');
        if (route.application_from_russia === 'NO') return outcome(ROUTE_STATUSES.UNSUITABLE, 'current_country_russia_not_allowed', 'Консульская подача в России не предусмотрена.');
        return outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'current_country_russia_unknown', 'Возможность консульской подачи в России не подтверждена.');
      }
      if (route.requires_legal_residence_in_application_country !== 'YES') return outcome(ROUTE_STATUSES.SUITABLE, 'current_country_method_allowed', 'Консульская подача в текущей стране предусмотрена.');
      if (confirmedResidentStatuses.has(profile.currentStatus)) return outcome(ROUTE_STATUSES.SUITABLE, 'current_country_residence_confirmed', 'Подтверждённый статус позволяет консульскую подачу в текущей стране.');
      if (profile.currentStatus === 'OTHER_LEGAL_STATUS') return outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'current_country_status_clarification', 'Нужно уточнить, является ли текущий законный статус резидентским.', { field: 'residence.current_status' });
      return outcome(ROUTE_STATUSES.UNSUITABLE, 'current_country_residence_required', 'Для консульской подачи требуется подтверждённый резидентский статус в текущей стране или подача из России.');
    };
    const methodRank = { SUITABLE: 6, SUITABLE_WITH_CONDITIONS: 5, PRELIMINARY_SUITABLE: 4, INSUFFICIENT_COUNTRY_DATA: 3, INDIVIDUAL_REVIEW_REQUIRED: 2, UNSUITABLE: 1 };
    const methodChecks = selected.map(evaluateMethod);
    methodChecks.sort((a, b) => methodRank[b.status] - methodRank[a.status]);
    checks.push(methodChecks[0]);
  }
  return checks;
}

function incomeEvaluation(route, indexes, profile, context) {
  const rule = ROUTE_RULES[route.route_id] || { incomeTypes: [] };
  const incomeType = INCOME_TYPE_BY_SCENARIO[profile.plannedBasis];
  const requirementConversion = convertMoney(profile.incomeMoney, 'EUR', context, 'income.primary.monthly_provable');
  const incomeEur = requirementConversion?.convertedAmount ?? null;
  const base = { incomeEur, requirementConversion };
  if (!profile.plannedBasis) return { ...base, checks: [outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'income_type_missing', 'Нужно указать основной тип дохода.', { field: 'income.primary.type' })], thresholdEur: null, incomeTypeFit: 'UNKNOWN', incomeFit: 'UNKNOWN' };
  let basisChecks = [];
  if (rule.separateBasis) {
    const basisSelected = rule.scenarios.includes(profile.plannedBasis);
    basisChecks = [outcome(basisSelected && rule.individualReview ? ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED : ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'separate_route_basis_required', rule.separateBasis)];
    if (!rule.fundsIncomeType) return { ...base, checks: basisChecks, thresholdEur: null, incomeTypeFit: 'NOT_APPLICABLE', incomeFit: 'NOT_APPLICABLE', basisMissing: !basisSelected };
  }
  if (!rule.fundsIncomeType && !rule.incomeTypes.includes(incomeType)) return { ...base, checks: [outcome(ROUTE_STATUSES.UNSUITABLE, 'income_type_incompatible', 'Тип дохода несовместим с правилами этого маршрута.')], thresholdEur: null, incomeTypeFit: 'DOES_NOT_MEET', incomeFit: 'NOT_APPLICABLE' };
  if (rule.individualReview) {
    const message = route.country_id === 'UY'
      ? 'Фиксированный минимальный доход не установлен: достаточность и документы о средствах оцениваются индивидуально.'
      : 'Требуется индивидуальная оценка бизнес-плана и проекта.';
    return { ...base, checks: [outcome(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'individual_income_review', message)], thresholdEur: null, incomeTypeFit: 'MEETS', incomeFit: 'UNKNOWN', incomeGuidance: route.country_id === 'UY' ? 'Официального фиксированного порога нет. Ориентиры: минимальная зарплата с 1 июля 2026 года — 25 383 UYU (примерно 640 USD) в месяц; в одном публичном личном опыте заявитель сообщил о принятии 650 USD в месяц. Это не официальный минимум и не гарантия решения.' : null };
  }
  if (rule.meansDeclaration) {
    const checks = profile.monthlyIncomeUsd == null
      ? [outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'income_missing', 'Нужно указать средства для проживания и подтвердить их декларацией.', { field: 'income.primary.amount' })]
      : [outcome(ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS, 'means_declaration_required', 'Официальный фиксированный минимум не установлен; потребуется декларация о достаточных средствах.', { condition: 'Подать подписанную декларацию о наличии средств для проживания.' })];
    return { ...base, checks, thresholdEur: null, incomeTypeFit: 'MEETS', incomeFit: profile.monthlyIncomeUsd == null ? 'UNKNOWN' : 'MEETS', incomeGuidance: 'Официального фиксированного порога нет. Ориентиры: минимальная зарплата с 1 июля 2026 года — 25 383 UYU (примерно 640 USD) в месяц; в одном публичном личном опыте заявитель сообщил о принятии 650 USD в месяц. Это не официальный минимум и не гарантия решения.' };
  }
  if (rule.missingSalaryThreshold) return { ...base, checks: [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'hq_salary_missing', 'Зарплатный порог проверяется после получения конкретного предложения работы.')], thresholdEur: null, incomeTypeFit: 'NOT_APPLICABLE', incomeFit: 'UNKNOWN' };
  const incomeRule = indexes.routeIncome.get(`${route.route_id}:${rule.fundsIncomeType || incomeType}`);
  if (!incomeRule) return { ...base, checks: [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'income_rule_missing', 'Подтверждённое правило дохода отсутствует.')], thresholdEur: null, incomeTypeFit: 'MEETS', incomeFit: 'UNKNOWN' };
  const thresholdEur = familyThreshold(incomeRule, profile);
  const checks = [...basisChecks];
  if (profile.monthlyIncomeUsd == null) checks.push(outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'income_missing', 'Подтверждаемый доход не указан.', { field: 'income.primary.amount' }));
  else if (incomeEur < thresholdEur) checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'income_below_threshold', `Доход после пересчёта составляет около ${Math.round(incomeEur)} EUR, требование маршрута — ${Math.round(thresholdEur)} EUR в месяц.`));
  else if (incomeEur < thresholdEur * 1.1) checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'income_meets_threshold_close', 'Доход соответствует официальному порогу, запас составляет менее 10%.'));
  else checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'income_meets_threshold', 'Доход превышает семейный порог.'));
  if (rule.socialSecurityReview) {
    if (profile.incomeSourceCountry === 'ES') checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'dnv_foreign_income_source_required', 'Для DNV основная работа или профессиональная деятельность должна быть связана преимущественно с работодателем или заказчиками за пределами Испании.'));
    else checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'dnv_foreign_income_source', 'Для DNV потребуется подтвердить иностранного работодателя или заказчиков и допустимую долю деятельности в Испании.'));
    if (profile.bankCountry === 'RU') checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'russian_bank_documents_open', 'Приём выписок российского банка требует подтверждения.'));
    const contractor = ['CONTRACTOR', 'FREELANCE_OR_SELF_EMPLOYED'].includes(profile.plannedBasis);
    const message = contractor
      ? 'Для DNV самостоятельному специалисту потребуется регистрация в испанской системе социального страхования (RETA).'
      : 'Для DNV потребуется испанское социальное страхование либо допустимое подтверждение покрытия по международному соглашению.';
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'social_security_required', message));
  }
  return { ...base, checks, thresholdEur, incomeTypeFit: 'MEETS', incomeFit: profile.monthlyIncomeUsd == null ? 'UNKNOWN' : incomeEur >= thresholdEur ? 'MEETS' : 'DOES_NOT_MEET', basisMissing: Boolean(rule.separateBasis && !rule.scenarios.includes(profile.plannedBasis)) };
}

function familyChecks(route, indexes, profile) {
  if (profile.adults == null || profile.partnerIncluded == null || profile.children == null) return [outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'family_answer_missing', 'Нужно уточнить состав семьи.', { field: 'family' })];
  if (!profile.partnerIncluded && profile.children.length === 0) return [outcome(ROUTE_STATUSES.SUITABLE, 'no_dependants', 'Зависимые члены семьи отсутствуют.')];
  const rule = indexes.routeFamily.get(route.route_id);
  if (!rule) return [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'family_rule_missing', 'Семейные правила не структурированы.')];
  const checks = [];
  if (profile.partnerIncluded) checks.push(rule.partner_allowed === 'YES'
    ? outcome(ROUTE_STATUSES.SUITABLE, 'partner_allowed', 'Партнёр может быть включён.')
    : rule.partner_allowed === 'NO' ? outcome(ROUTE_STATUSES.UNSUITABLE, 'partner_not_allowed', 'Партнёр не может быть включён.')
      : outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'partner_rule_unknown', 'Возможность включить партнёра не подтверждена.'));
  if (profile.partnerIncluded && !profile.relationshipType) checks.push(outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'relationship_type_missing', 'Уточните тип отношений.', { field: 'family.relationship_type' }));
  if (profile.partnerIncluded && profile.relationshipType) {
    const accepted = Array.isArray(rule.accepted_relationship_types) && rule.accepted_relationship_types.includes(profile.relationshipType);
    const value = profile.relationshipType === 'UNREGISTERED_PARTNER'
      ? rule.unregistered_partner_allowed
      : accepted ? 'YES' : 'NO';
    checks.push(value === 'YES' ? outcome(ROUTE_STATUSES.SUITABLE, 'relationship_recognized', 'Тип отношений признаётся.')
      : value === 'NO' ? outcome(ROUTE_STATUSES.UNSUITABLE, 'relationship_not_recognized', 'Этот тип отношений не позволяет включить партнёра.')
        : outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'relationship_rule_unknown', 'Признание этого типа отношений не подтверждено.'));
    if (value === 'YES' && profile.relationshipType === 'UNREGISTERED_PARTNER' && rule.notes) {
      checks.push(outcome(ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS, 'unregistered_partner_evidence_required', rule.notes, { condition: rule.notes }));
    }
  }
  if (profile.partnerIncluded && profile.lgbt?.enabled && profile.lgbt?.consent_for_personalization) {
    const field = profile.relationshipType === 'UNREGISTERED_PARTNER' ? 'same_sex_unregistered_partner_allowed' : 'same_sex_partner_allowed';
    checks.push(rule[field] === 'YES' ? outcome(ROUTE_STATUSES.SUITABLE, 'same_sex_family_recognized', 'Однополая семья признаётся.')
      : rule[field] === 'NO' ? outcome(ROUTE_STATUSES.UNSUITABLE, 'same_sex_family_not_recognized', 'Однополая семья не признаётся для этого маршрута.')
        : outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'same_sex_family_rule_unknown', 'Признание однополой семьи не подтверждено.'));
  }
  if (profile.children.length > 0) checks.push(rule.children_allowed === 'YES'
    ? outcome(ROUTE_STATUSES.SUITABLE, 'children_allowed', 'Дети могут быть включены.')
    : rule.children_allowed === 'NO' ? outcome(ROUTE_STATUSES.UNSUITABLE, 'children_not_allowed', 'Дети не могут быть включены.')
      : outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'children_rule_unknown', 'Возможность включить детей не подтверждена.'));
  if (rule.dependent_child_age_limit != null) for (const child of profile.children) {
    if (child.age_years == null) checks.push(outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'child_age_missing', 'Уточните возраст ребёнка.', { field: 'family.children.age_years' }));
    else if (child.age_years >= Number(rule.dependent_child_age_limit)) checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'child_age_limit', 'Возраст ребёнка превышает подтверждённый предел зависимого ребёнка.'));
  }
  if (profile.children.some((child) => child.parenthood_complex === true)) checks.push(outcome(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'complex_parenthood', 'Сложная ситуация родительства требует индивидуальной проверки.'));
  return checks.length ? checks : [outcome(ROUTE_STATUSES.SUITABLE, 'family_ok', 'Семейная конфигурация соответствует маршруту.')];
}

function goalChecks(route, indexes, profile) {
  if (!profile.goal) return [outcome(ROUTE_STATUSES.PRELIMINARY_SUITABLE, 'long_term_goal_missing', 'Уточните долгосрочную цель.', { field: 'goal.long_term' })];
  if (profile.goal === 'TEMPORARY_RESIDENCE_SUFFICIENT' || profile.goal === 'UNDECIDED') return [outcome(ROUTE_STATUSES.SUITABLE, 'temporary_goal', 'Маршрут предоставляет первоначальный статус проживания.')];
  const rule = indexes.routeStatus.get(route.route_id);
  if (!rule) return [outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'long_term_rule_missing', 'Долгосрочный путь не заполнен.')];
  const citizenshipGoal = profile.goal.startsWith('CITIZENSHIP_');
  const field = citizenshipGoal ? 'path_to_citizenship' : 'path_to_pr';
  const label = citizenshipGoal ? 'гражданству' : 'ПМЖ';
  const hardRequired = ['PR_REQUIRED', 'CITIZENSHIP_REQUIRED'].includes(profile.goal);
  const checks = [];
  if (rule[field] === 'YES') checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'long_term_path', `Маршрут засчитывается в путь к ${label}.`));
  else if (rule[field] === 'CONDITIONAL') checks.push(outcome(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'long_term_conditional', `Путь к ${label} требует индивидуальной проверки.`));
  else if (hardRequired && rule[field] === 'NO') checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'long_term_unavailable', `Подтверждённого пути к ${label} нет.`));
  else if (rule[field] === 'NO') checks.push(outcome(ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS, 'long_term_preference_unavailable', `Желаемый путь к ${label} не подтверждён, но первоначальный ВНЖ доступен.`, { condition: 'Учесть отсутствие подтверждённого долгосрочного пути.' }));
  else checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'long_term_path_unknown', `Данные о пути к ${label} отсутствуют.`));
  if (citizenshipGoal && rule.language_exam_required === 'YES') {
    if (profile.languageReadiness === 'NO' && profile.goal === 'CITIZENSHIP_REQUIRED') checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'language_required', 'Для обязательной цели требуется языковой экзамен.'));
    else if (profile.languageReadiness === 'BASIC_ONLY' && !['A1', 'A2'].includes(rule.required_language_level)) checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'language_level_insufficient', 'Базового уровня недостаточно для подтверждённого экзамена.'));
  }
  const presenceField = citizenshipGoal ? 'allowed_absence_for_citizenship_days' : 'allowed_absence_for_pr_days';
  if (profile.physicalPresence === 'LESS_THAN_6_MONTHS' && rule[presenceField] == null) {
    checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'absence_rule_missing', 'Точные допустимые отсутствия для долгосрочной цели не исследованы.'));
  }
  if (citizenshipGoal && ['REQUIRED', 'DESIRABLE'].includes(profile.keepRuCitizenship)) {
    if (rule.multiple_citizenship_allowed === 'NO' && profile.keepRuCitizenship === 'REQUIRED') checks.push(outcome(ROUTE_STATUSES.UNSUITABLE, 'renunciation_conflict', 'Обязательное сохранение гражданства РФ конфликтует с подтверждённым правилом.'));
    else if (rule.multiple_citizenship_allowed === 'UNKNOWN') checks.push(outcome(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'multiple_citizenship_rule_unknown', 'Правило сохранения прежнего гражданства требует подтверждения.'));
    else if (profile.keepRuCitizenship === 'DESIRABLE' && rule.multiple_citizenship_allowed !== 'YES') checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'citizenship_preservation_note', 'Сохранение гражданства РФ нужно учитывать при выборе долгосрочной стратегии.'));
  }
  return checks;
}

function evaluateRoute(route, indexes, profile, context) {
  const application = applicationChecks(route, indexes, profile);
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
  const incomeTypeAction = {
    ES_DNV: 'Подтвердить удалённую работу по трудовому договору, контрактам с иностранными заказчиками или доход владельца иностранной компании.',
    ES_NLV: 'Подтвердить пассивный доход, не требующий работы: например, аренду, дивиденды или пенсию.',
    UY_DIGITAL_NOMAD: 'Подтвердить удалённую работу на иностранную компанию или заказчиков.',
  };
  const actionByCode = {
    current_country_residence_required: 'Подаваться из России либо получить подтверждённый резидентский статус в текущей стране.',
    in_country_method_not_allowed: 'Выбрать предусмотренную маршрутом подачу через консульство; если текущая страна не подходит — подаваться из России.',
    income_below_threshold: income.thresholdEur == null ? null : `Увеличить подтверждаемые средства минимум до ${Math.round(income.thresholdEur)} EUR в месяц.`,
    dnv_foreign_income_source_required: 'Подтвердить основную работу или заказчиков за пределами Испании.',
    long_term_unavailable: 'Выбрать маршрут с подтверждённым путём к вашей долгосрочной цели либо изменить долгосрочную цель.',
    relationship_not_recognized: 'Оформить отношения в форме, которую признаёт этот маршрут, либо подаваться без включения партнёра.',
    child_age_limit: 'Проверить отдельное основание для совершеннолетнего ребёнка или подаваться без его включения как иждивенца.',
    language_required: 'Подтвердить готовность выполнить языковое требование для гражданства.',
    nationality_not_allowed: 'Выбрать маршрут, доступный гражданам РФ.',
  };
  const actionFor = (check) => check.code === 'income_type_incompatible' ? incomeTypeAction[route.route_id]
    : actionByCode[check.code] || `Устранить это препятствие: ${check.message}`;
  const blockerActions = checks.filter((check) => check.status === ROUTE_STATUSES.UNSUITABLE).map(actionFor);
  const enablingActions = checks.filter((check) => check.code === 'separate_route_basis_required').map((check) => check.message);
  const actions = [...blockerActions, ...enablingActions].filter(Boolean);
  const requirementCodes = new Set(['dnv_foreign_income_source', 'social_security_required']);
  const initialPermitRequirements = checks.filter((check) => requirementCodes.has(check.code)).map((check) => check.message);
  const applicationGuidance = {
    ES_DNV: 'Из Испании податься можно, если вы находитесь там законно. При подаче через консульство вне России нужен резидентский статус в стране подачи; альтернативно можно подаваться из России.',
    ES_ENTREPRENEUR: 'Из Испании податься можно при законном статусе. Заявление на разрешение подаёт сам предприниматель электронно через UGE; из-за рубежа доступен визовый путь.',
    ES_HIGHLY_QUALIFIED: 'Подача возможна, пока специалист законно находится в Испании, но заявление через UGE подаёт испанский работодатель. Если специалист за рубежом, после одобрения разрешения оформляется виза.',
    ES_STUDENT: 'Из Испании податься можно только на высшее образование: заявитель должен быть совершеннолетним, находиться законно и подать документы не позднее чем за два месяца до окончания законного статуса и до начала учёбы. Для остальных учебных программ используется консульская подача.',
    UY_PERMANENT: 'Это прямая постоянная резиденция: временная резиденция перед ней не обязательна. Заявление подаётся внутри Уругвая.',
    UY_TEMPORARY: 'Это отдельная срочная категория по работе, учёбе или другой временной цели, а не обязательная ступень перед постоянной резиденцией.',
    UY_DIGITAL_NOMAD: 'Это отдельное разрешение на 6 месяцев с продлением ещё на 6. Затем можно отдельно обратиться за временной или постоянной резиденцией; автоматического перехода нет.',
  }[route.route_id] || null;
  return {
    routeId: route.route_id, routeName: route.name_ru || route.official_name, routeStatus, statusLabel: STATUS_LABELS_RU[routeStatus],
    applicationNationality: profile.applicationNationality, viaSecondaryNationality: profile.applicationNationality !== 'RU', thresholdEur: income.thresholdEur, incomeEur: income.incomeEur,
    incomeUsd: profile.monthlyIncomeUsd,
    incomeOriginal: profile.incomeMoney, incomeConversion: profile.incomeConversion, incomeRequirementConversion: income.requirementConversion, basisMissing: Boolean(income.basisMissing),
    goalFit: fits(goal), applicationFit: fits(application), familyFit: fits(family), incomeTypeFit: income.incomeTypeFit, incomeFit: income.incomeFit,
    countryMissingCount: missing.length, clientMissingCount: preliminary.length, conditionsCount: conditions.length,
    scenarioAffinity: ROUTE_RULES[route.route_id]?.scenarios?.includes(profile.plannedBasis) ? 1 : 0,
    checks, conditions, blockers: messages(ROUTE_STATUSES.UNSUITABLE), missing, countryMissing: missing, preliminary, clientMissing: preliminary, review, actions, initialPermitRequirements,
    incomeGuidance: income.incomeGuidance || null, applicationGuidance,
    incomeExampleSource: route.country_id === 'UY' ? indexes.sources.get('S_UY_INCOME_CASE') || null : null,
    followUpQuestions: [],
    primarySourceId: route.primary_source_id, primarySource: indexes.sources.get(route.primary_source_id) || null, longTerm: indexes.routeStatus.get(route.route_id) || null,
    work: indexes.routeWork.get(route.route_id) || null, family: indexes.routeFamily.get(route.route_id) || null,
  };
}

function familyCost(city, profile) {
  const children = profile.children?.length || 0;
  if (profile.adults === 1 && children === 0) return Number(city.estimated_monthly_cost_single_usd || 0);
  if (profile.adults === 2 && children === 0) return Number(city.estimated_monthly_cost_couple_usd || 0);
  if (profile.adults === 2 && children === 1) return Number(city.estimated_monthly_cost_family_1_child_usd || 0);
  return Number(city.estimated_monthly_cost_single_usd || 0) + Math.max(0, profile.adults - 1) * Number(city.additional_adult_cost_usd || 0) + children * Number(city.additional_child_cost_usd || 0);
}

function evaluatePractical(data, profile) {
  const allCities = data.cities || [];
  const matchingCities = allCities.filter((city) => profile.citySize === 'ANY' || city.population_category === profile.citySize);
  const usedCitySizeFallback = profile.citySize !== 'ANY' && matchingCities.length === 0 && allCities.length > 0;
  const cities = (usedCitySizeFallback ? allCities : matchingCities).map((city) => {
    const costUsd = familyCost(city, profile);
    const budgetDifference = profile.monthlyBudgetUsd == null ? null : profile.monthlyBudgetUsd - costUsd;
    const budgetDifferencePercent = profile.monthlyBudgetUsd == null ? null : Math.abs(budgetDifference) / profile.monthlyBudgetUsd * 100;
    const budgetFit = profile.monthlyBudgetUsd == null ? 'NOT_APPLICABLE' : costUsd <= profile.monthlyBudgetUsd ? 'MEETS' : 'DOES_NOT_MEET';
    const budgetProximity = profile.monthlyBudgetUsd == null ? 'NOT_APPLICABLE' : !Number.isFinite(costUsd) || costUsd <= 0 ? 'UNKNOWN' : budgetDifferencePercent <= 10 ? 'WITHIN_MARGIN' : 'OUTSIDE_MARGIN';
    const missing = [];
    const failures = [];
    if (!Number.isFinite(costUsd) || costUsd <= 0) missing.push('Стоимость жизни для этой семейной конфигурации не исследована.');
    if (profile.petTypes && !profile.petTypes.includes('NONE') && city.pet_friendly_housing === 'UNKNOWN') missing.push('Доступность аренды с животными ещё не подтверждена.');
    if (profile.schoolNeeded && city.international_school_available === 'UNKNOWN') missing.push('Доступность обязательной международной школы не подтверждена.');
    if (profile.schoolNeeded && city.international_school_available === 'NO') failures.push('Обязательная международная школа недоступна.');
    if (budgetFit === 'DOES_NOT_MEET') failures.push('Расчётная стоимость жизни превышает обязательный бюджет.');
    return { cityId: city.city_id, cityName: city.name_ru, populationCategory: city.population_category, costUsd, budgetOriginal: profile.budgetMoney, budgetConversion: profile.budgetConversion, budgetDifference, budgetDifferencePercent, budgetFit,
      budgetProximity, practicalEvaluation: missing.length ? 'UNKNOWN' : failures.length ? 'DOES_NOT_MEET' : 'MEETS',
      missing, failures, airport: city.airport_name, climate: city.climate_category, primarySourceId: city.primary_source_id };
  });
  const practicalRank = { MEETS: 3, UNKNOWN: 2, DOES_NOT_MEET: 1 };
  cities.sort((a, b) => practicalRank[b.practicalEvaluation] - practicalRank[a.practicalEvaluation] || a.costUsd - b.costUsd);
  return { cities, recommendedCity: cities[0] || null, usedCitySizeFallback, requestedCitySize: profile.citySize };
}

function determineCountryGroup(bestRoute, practical, profile, routes = []) {
  if (!bestRoute || (routes.length > 0 && routes.every((route) => route.routeStatus === ROUTE_STATUSES.UNSUITABLE))) return 'UNSUITABLE';
  if ([ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED].includes(bestRoute.routeStatus)) return 'REQUIRES_REVIEW';
  if (practical.recommendedCity?.practicalEvaluation === 'UNKNOWN') return 'REQUIRES_REVIEW';
  if (bestRoute.routeStatus === ROUTE_STATUSES.PRELIMINARY_SUITABLE) return 'PRELIMINARY';
  if (practical.recommendedCity?.practicalEvaluation === 'DOES_NOT_MEET') return 'LEGAL_BUT_PRACTICALLY_UNSUITABLE';
  return 'SUITABLE';
}

function collectSources(data, indexes, bestRoute, practical) {
  const ids = new Set([bestRoute?.primarySourceId, bestRoute?.longTerm?.source_id, bestRoute?.work?.source_id, bestRoute?.family?.source_id, practical.recommendedCity?.primarySourceId, data.country?.primary_source_id].filter(Boolean));
  return [...ids].map((id) => indexes.sources.get(id)).filter(Boolean);
}

function collectPracticalMissing(data, profile, practical) {
  const missing = [...(practical.recommendedCity?.missing || [])];
  if (profile.petTypes?.includes('DOG') && data.pet_rules?.find((rule) => rule.animal_type === 'DOG')?.rabies_titer_required === 'UNKNOWN') missing.push('Необходимость титра антител для ввоза собаки требует актуальной проверки.');
  if (profile.medicineRequired) missing.push('Наличие лекарства и правила ввоза личного запаса проверяются отдельно.');
  return missing;
}

export const spainAdapter = Object.freeze({ id: 'spain', normalizeProfile, validateContext, buildIndexes, evaluateRoute, evaluatePractical, determineCountryGroup, collectSources, collectPracticalMissing });
