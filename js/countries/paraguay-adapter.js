import { convertMoney } from '../engine/currency.js?v=7.0.2';
import { ROUTE_STATUSES, STATUS_LABELS_RU } from '../engine/status-contract.js?v=7.0.2';

const PUBLIC_ROUTE_IDS = new Set(['PY_TEMPORARY', 'PY_PERMANENT_AFTER_TEMP']);
const CITIZENSHIP_GOALS = new Set(['CITIZENSHIP_DESIRED', 'CITIZENSHIP_MAIN_GOAL', 'CITIZENSHIP_REQUIRED']);

const outcome = (status, code, message, options = {}) => ({
  status,
  code,
  message,
  condition: options.condition ?? null,
  action: options.action ?? null,
});

const strictest = (checks) => checks.some(({ status }) => status === ROUTE_STATUSES.UNSUITABLE)
  ? ROUTE_STATUSES.UNSUITABLE
  : checks.some(({ status }) => status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS)
    ? ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS
    : ROUTE_STATUSES.SUITABLE;

const fit = (checks) => checks.some(({ status }) => status === ROUTE_STATUSES.UNSUITABLE)
  ? 'DOES_NOT_MEET'
  : checks.some(({ status }) => status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS)
    ? 'UNKNOWN'
    : 'MEETS';

function sourceWithUsd(source, context, field) {
  const provable = convertMoney(source?.monthly_provable ?? null, 'USD', context, `${field}.monthly_provable`);
  const total = convertMoney(source?.monthly_total ?? source?.monthly_provable ?? null, 'USD', context, `${field}.monthly_total`);
  return {
    ...source,
    provableUsd: provable?.convertedAmount ?? null,
    totalUsd: total?.convertedAmount ?? null,
    conversion: provable,
  };
}

function normalizeProfile(profile = {}, context) {
  const family = profile.family || {};
  const primary = sourceWithUsd(profile.income?.primary || {}, context, 'income.primary');
  const additional = (profile.income?.additional_sources || []).map((source, index) =>
    sourceWithUsd(source, context, `income.additional_sources[${index}]`));
  const partner = (profile.income?.partner?.sources || []).map((source, index) =>
    sourceWithUsd(source, context, `income.partner.sources[${index}]`));
  const applicantSources = [primary, ...additional];
  const allSources = [...applicantSources, ...partner];
  const budget = profile.preferences?.monthly_budget;
  const budgetConversion = convertMoney(budget, 'USD', context, 'preferences.monthly_budget');
  const totalMonthlyIncomeUsd = allSources.reduce((sum, source) => sum + Number(source.totalUsd || 0), 0) || null;
  const applicantProvableIncomeUsd = applicantSources.reduce((sum, source) => sum + Number(source.provableUsd || 0), 0) || null;

  return {
    citizenships: [...profile.citizenships],
    applicationNationality: 'RU',
    currentCountry: profile.residence?.current_country ?? null,
    currentStatus: profile.residence?.current_status ?? null,
    applicationMethods: profile.application_preferences?.methods ?? [],
    primaryIncome: primary,
    applicantSources,
    partnerSources: partner,
    applicantProvableIncomeUsd,
    totalMonthlyIncomeUsd,
    incomeMoney: primary.monthly_provable ?? null,
    incomeConversion: primary.conversion,
    adults: family.adults_count ?? 1,
    children: Array.isArray(family.children) ? family.children.map((child) => ({ ...child })) : [],
    partnerIncluded: Boolean(family.partner_included),
    relationshipType: family.relationship_type ?? null,
    schoolNeeded: Boolean(family.school_needed),
    lgbt: profile.lgbt ?? null,
    goal: profile.goal?.long_term ?? null,
    keepRuCitizenship: profile.goal?.keep_russian_citizenship ?? null,
    monthlyBudgetUsd: budgetConversion?.convertedAmount ?? totalMonthlyIncomeUsd,
    budgetMoney: budget ?? null,
    budgetConversion,
    budgetDerivedFromIncome: budget == null && totalMonthlyIncomeUsd != null,
    citySize: profile.preferences?.city_size ?? 'ANY',
    petTypes: profile.pets?.types ?? ['NONE'],
    routeSpecificAnswers: profile.route_specific_answers || {},
  };
}

function buildIndexes(data) {
  return {
    data,
    sources: new Map((data.sources || []).map((source) => [source.source_id, source])),
  };
}

function listRoutes(data) {
  return (data.routes || []).filter((route) =>
    PUBLIC_ROUTE_IDS.has(route.route_id)
    && route.publishable === true
    && route.available_to_russian_citizen === true);
}

function applicationEvaluation(route, profile) {
  if (route.route_id === 'PY_TEMPORARY') {
    if (profile.currentCountry === 'PY' && profile.currentStatus === 'TEMPORARY_RESIDENCE') {
      return [outcome(
        ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
        'temporary_residence_already_held',
        'У вас уже указана временная резиденция Парагвая; этот маршрут актуален для продления, а для следующего этапа нужно проверить переход на постоянную резиденцию.',
        { condition: 'Проверить срок действия временной карты и выбрать продление либо переход на постоянную резиденцию.' },
      )];
    }
    if (profile.currentCountry === 'PY') {
      return [outcome(
        ROUTE_STATUSES.SUITABLE,
        'paraguay_in_country_filing_available',
        'Вы уже находитесь в Парагвае и можете лично подать заявление внутри страны.',
      )];
    }
    return [outcome(
      ROUTE_STATUSES.SUITABLE,
      'paraguay_entry_required',
      'Маршрут доступен: для подачи нужно въехать в Парагвай и лично обратиться в миграционную службу.',
      { action: 'Подготовить документы для въезда и личной подачи в Парагвае.' },
    )];
  }

  if (profile.currentCountry !== 'PY' || profile.currentStatus !== 'TEMPORARY_RESIDENCE') {
    return [outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'paraguay_temporary_residence_required',
      'Для обычного перехода на постоянную резиденцию нужна действующая временная резиденция Парагвая.',
      { action: 'Сначала получить временную резиденцию Парагвая.' },
    )];
  }
  return [outcome(
    ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
    'paraguay_permanent_filing_window_check',
    'Основание для перехода есть, но нужно проверить срок действия временной карты и допустимое окно подачи.',
    {
      condition: 'Подать в последние три месяца действия временной карты либо в течение одного месяца после окончания со штрафом.',
      action: 'Проверить дату окончания временной карты и подготовить подачу в допустимое окно.',
    },
  )];
}

function incomeEvaluation(route, profile) {
  if (route.route_id === 'PY_TEMPORARY') {
    return {
      checks: [outcome(
        ROUTE_STATUSES.SUITABLE,
        'no_numeric_income_threshold',
        'Для первой временной резиденции официальный универсальный числовой порог дохода не установлен.',
      )],
      amountUsd: null,
      thresholdUsd: null,
      incomeTypeFit: 'NOT_APPLICABLE',
      incomeFit: 'NOT_APPLICABLE',
      incomeGuidance: route.income_rule_ru,
    };
  }

  const hasProvableIncome = Number(profile.applicantProvableIncomeUsd || 0) > 0;
  const check = hasProvableIncome
    ? outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'solvency_category_documents_required',
      'Единого числового порога нет; потребуется подтвердить подходящую официальную категорию состоятельности и комплект документов.',
      {
        condition: 'Подтвердить категорию состоятельности документами по действующим правилам миграционной службы.',
        action: 'Подготовить документы о работе, самостоятельной деятельности, удалённом доходе, пенсии, имуществе, участии в компании или другой применимой категории.',
      },
    )
    : outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'solvency_documents_missing',
      'Для постоянной резиденции нужно документально подтвердить реальный доход или другую официальную категорию состоятельности.',
      {
        condition: 'Подготовить подтверждение дохода или другой допустимой категории состоятельности.',
        action: 'Выбрать применимую категорию состоятельности и собрать подтверждающие документы.',
      },
    );

  return {
    checks: [check],
    amountUsd: profile.applicantProvableIncomeUsd,
    thresholdUsd: null,
    incomeTypeFit: 'MEETS',
    incomeFit: 'UNKNOWN',
    incomeGuidance: route.income_rule_ru,
  };
}

function familyEvaluation(route, profile) {
  const checks = [];
  if (!profile.partnerIncluded && profile.children.length === 0) {
    return [outcome(ROUTE_STATUSES.SUITABLE, 'family_not_included', 'Семейные требования не применяются к заявителю без сопровождающих членов семьи.')];
  }

  if (route.route_id === 'PY_TEMPORARY') {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'family_members_apply_separately',
      'Каждый взрослый оформляет собственную временную резиденцию; дети подаются отдельно вместе с родителем или законным представителем.',
    ));
    return checks;
  }

  if (profile.partnerIncluded && profile.lgbt?.family_recognition_relevant) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'same_sex_partner_needs_independent_route',
      'Однополый брак или партнёрство не признаётся основанием супруга или иждивенца; партнёру нужен самостоятельный миграционный маршрут.',
      {
        condition: 'Партнёр должен отдельно соответствовать требованиям временной или постоянной резиденции.',
        action: 'Подготовить самостоятельное основание и документы для партнёра.',
      },
    ));
  } else if (profile.partnerIncluded && profile.relationshipType !== 'MARRIAGE') {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'partner_needs_independent_route',
      'Зарегистрированное или незарегистрированное партнёрство не подтверждено как категория супруга-иждивенца; партнёру нужен самостоятельный маршрут.',
      {
        condition: 'Партнёр должен отдельно соответствовать требованиям резиденции.',
        action: 'Подготовить самостоятельное основание и документы для партнёра.',
      },
    ));
  }

  if (profile.children.length > 0) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'children_supported',
      'Дети до 18 лет оформляются как отдельная категория вместе с родителем или законным представителем и освобождены от собственного подтверждения состоятельности.',
    ));
  }
  if (checks.length === 0) checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'family_configuration_supported', 'Состав семьи не создаёт известного препятствия для этого маршрута.'));
  return checks;
}

function goalEvaluation(route, profile) {
  const checks = [];
  if (route.route_id === 'PY_TEMPORARY') {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'temporary_is_required_first_stage',
      profile.goal === 'TEMPORARY_RESIDENCE_SUFFICIENT'
        ? 'Маршрут соответствует цели временного проживания.'
        : 'Временная резиденция является обязательным первым этапом обычного перехода на постоянную резиденцию.',
    ));
  } else {
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'permanent_path_available', 'Маршрут ведёт к бессрочной постоянной резиденции.'));
  }

  if (CITIZENSHIP_GOALS.has(profile.goal) && ['REQUIRED', 'DESIRABLE'].includes(profile.keepRuCitizenship)) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'dual_citizenship_with_russia_unconfirmed',
      'Сохранение гражданства РФ после натурализации в Парагвае не подтверждено международным договором или взаимностью.',
      { condition: 'До натурализации отдельно проверить возможность сохранения гражданства РФ.' },
    ));
  }
  return checks;
}

function initialPermitRequirements(route, profile) {
  if (route.route_id === 'PY_TEMPORARY') {
    return [
      'Личная подача в миграционной службе внутри Парагвая.',
      ...(profile.partnerIncluded ? ['Каждый взрослый подаёт самостоятельное заявление.'] : []),
      ...(profile.children.length ? ['Дети оформляются отдельно вместе с родителем или законным представителем.'] : []),
    ];
  }
  return [
    'Действующая временная резиденция Парагвая.',
    'Подача в последние три месяца действия временной карты либо в течение одного месяца после окончания со штрафом.',
    'Документы по одной из официальных категорий экономической состоятельности.',
  ];
}

function evaluateRoute(route, indexes, profile) {
  const application = applicationEvaluation(route, profile);
  const income = incomeEvaluation(route, profile);
  const family = familyEvaluation(route, profile);
  const goal = goalEvaluation(route, profile);
  const checks = [...application, ...income.checks, ...family, ...goal];
  const routeStatus = strictest(checks);
  const blockers = [...new Set(checks.filter((check) => check.status === ROUTE_STATUSES.UNSUITABLE).map((check) => check.message))];
  const conditions = [...new Set(checks.filter((check) => check.status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS).map((check) => check.condition || check.message))];
  const actions = [...new Set(checks.map((check) => check.action).filter(Boolean))];
  const primarySourceId = route.source_ids?.[0] ?? null;
  const basisMissing = route.route_id === 'PY_PERMANENT_AFTER_TEMP'
    && application.some((check) => check.code === 'paraguay_temporary_residence_required');
  const applicationGuidance = [
    route.application_inside_ru && `Внутри Парагвая: ${route.application_inside_ru}`,
    route.application_abroad_ru && `Из-за рубежа: ${route.application_abroad_ru}`,
  ].filter(Boolean).join(' ');

  return {
    routeId: route.route_id,
    routeName: route.name_ru,
    routeStatus,
    statusLabel: STATUS_LABELS_RU[routeStatus],
    applicationNationality: 'RU',
    viaSecondaryNationality: false,
    thresholdUsd: income.thresholdUsd,
    thresholdEur: null,
    incomeUsd: income.amountUsd,
    incomeEur: null,
    incomeOriginal: profile.incomeMoney,
    incomeConversion: profile.incomeConversion,
    incomeRequirementConversion: null,
    basisMissing,
    goalFit: fit(goal),
    applicationFit: fit(application),
    familyFit: fit(family),
    incomeTypeFit: income.incomeTypeFit,
    incomeFit: income.incomeFit,
    countryMissingCount: 0,
    clientMissingCount: conditions.length,
    conditionsCount: conditions.length,
    scenarioAffinity: route.route_id === 'PY_PERMANENT_AFTER_TEMP'
      ? Number(profile.currentCountry === 'PY' && profile.currentStatus === 'TEMPORARY_RESIDENCE')
      : Number(!(profile.currentCountry === 'PY' && profile.currentStatus === 'TEMPORARY_RESIDENCE')),
    checks,
    conditions,
    blockers,
    missing: [],
    countryMissing: [],
    preliminary: [],
    clientMissing: conditions,
    review: [],
    actions,
    initialPermitRequirements: initialPermitRequirements(route, profile),
    incomeGuidance: income.incomeGuidance,
    applicationGuidance,
    followUpQuestions: [],
    primarySourceId,
    primarySource: indexes.sources.get(primarySourceId) || null,
    longTerm: {
      pr_path_ru: route.pr_path_ru,
      citizenship_path_ru: route.citizenship_path_ru,
      presence_rule_ru: route.presence_rule_ru,
      dual_citizenship_ru: route.dual_citizenship_ru,
    },
    work: null,
    family: { rule_ru: route.family_rule_ru, partner_work_rights_ru: route.partner_work_rights_ru },
  };
}

function familyCost(city, profile) {
  const adults = Number(profile.adults || 1);
  const children = profile.children?.length || 0;
  const single = Number(city.budget_single_usd);
  const couple = Number(city.budget_couple_usd);
  const familyOneChild = Number(city.budget_family_1_child_usd);
  const additionalAdult = Math.max(0, couple - single);
  const additionalChild = Math.max(0, familyOneChild - couple);
  return Math.round(single + Math.max(0, adults - 1) * additionalAdult + children * additionalChild);
}

function sizeCode(value) {
  return value === 'крупный' ? 'LARGE' : value === 'средний' ? 'MEDIUM' : value === 'небольшой' ? 'SMALL' : 'ANY';
}

function evaluatePractical(data, profile) {
  const cities = (data.cities || []).map((city) => {
    const costUsd = familyCost(city, profile);
    const budgetDifference = profile.monthlyBudgetUsd == null ? null : profile.monthlyBudgetUsd - costUsd;
    return {
      cityId: city.city_id,
      cityName: city.name_ru,
      populationCategory: sizeCode(city.size),
      roles: city.roles_ru || [],
      costUsd,
      costIsFamilySpecific: true,
      budgetDifference,
      budgetFit: budgetDifference == null ? 'NOT_APPLICABLE' : budgetDifference >= 0 ? 'MEETS' : 'DOES_NOT_MEET',
      practicalEvaluation: 'MEETS',
      missing: [],
      failures: [],
      climate: city.climate_category_ru,
      coldRange: city.cold_period_temperature_range_c,
      hotRange: city.hot_period_temperature_range_c,
      lgbtSafety: city.lgbt_safety_ru,
      publicSchoolAvailable: city.public_school_available,
      publicSchoolLanguage: city.public_school_language,
      internationalSchoolStatus: city.international_school_status_ru,
      internationalSchoolCost: city.international_school_cost_ru,
      sourceIds: city.source_ids || [],
    };
  });
  cities.sort((left, right) => left.costUsd - right.costUsd);
  for (const city of cities) {
    city.roles = (city.roles || [])
      .map((role) => String(role).trim())
      .filter((role) => !/самый недорог/i.test(role));
  }
  if (cities[0]) cities[0].roles = ['Самый недорогой', ...cities[0].roles];
  const petSelected = profile.petTypes?.some((type) => !['NONE', 'OTHER'].includes(type));
  return {
    cities,
    recommendedCity: cities[0] || null,
    usedCitySizeFallback: false,
    requestedCitySize: profile.citySize,
    petSummary: petSelected ? data.pets?.result_text_ru || null : null,
    schoolSummary: profile.schoolNeeded ? data.schools?.international_school_ru || null : data.schools?.public_school_ru || null,
  };
}

function evaluateLgbt(data, profile) {
  if (!profile.lgbt?.enabled || !data.lgbt) return null;
  const rule = data.lgbt;
  return {
    enabled: true,
    rules: [{ id: 'PY_LGBT', legalStatus: 'NO' }],
    rows: [
      ['Брак и переезд с супругом', rule.same_sex_marriage_rule_ru],
      ['Зарегистрированные отношения', rule.registered_partnership_rule_ru],
      ['Иностранные документы', rule.foreign_document_rule_ru],
      ['Международная защита', rule.international_protection_ru],
    ],
    safety: {
      level: rule.country_safety_category_ru,
      tone: 'unsafe',
      text: rule.safety_explanation_ru,
    },
    pendingChanges: Array.isArray(rule.pending_changes) ? rule.pending_changes : [],
  };
}

function determineCountryGroup(bestRoute, practical, profile, routes = []) {
  if (!bestRoute || routes.every((route) => route.routeStatus === ROUTE_STATUSES.UNSUITABLE)) return ROUTE_STATUSES.UNSUITABLE;
  return bestRoute.routeStatus;
}

function collectSources(data, indexes, bestRoute, practical) {
  const ids = new Set([
    ...(bestRoute?.primarySourceId ? [bestRoute.primarySourceId] : []),
    ...(practical?.recommendedCity?.sourceIds || []),
  ]);
  return [...ids].map((id) => indexes.sources.get(id)).filter(Boolean);
}

function collectPracticalMissing(data, profile) {
  return profile.petTypes?.includes('OTHER') ? ['Правила ввоза другого вида животного проверяются отдельно.'] : [];
}

export const paraguayAdapter = Object.freeze({
  id: 'paraguay',
  normalizeProfile,
  buildIndexes,
  listRoutes,
  evaluateRoute,
  evaluatePractical,
  evaluateLgbt,
  determineCountryGroup,
  collectSources,
  collectPracticalMissing,
});
