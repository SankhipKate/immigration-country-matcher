import { CalculationContextError } from '../engine/calculate-country.js?v=7.0.2';
import { convertMoney } from '../engine/currency.js?v=7.0.2';
import { ROUTE_STATUSES, STATUS_LABELS_RU } from '../engine/status-contract.js?v=7.0.2';

const PUBLIC_ROUTE_IDS = new Set([
  'MX_TEMP_ECONOMIC_SOLVENCY',
  'MX_TEMP_LOCAL_JOB_OFFER',
]);

const ECONOMIC_INCOME_TYPES = new Set([
  'REMOTE_EMPLOYMENT',
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
  'PASSIVE_INCOME',
  'PENSION',
  'OTHER_REGULAR_REMOTE_INCOME',
]);

const ACTIVE_WORK_TYPES = new Set([
  'REMOTE_EMPLOYMENT',
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
  'OTHER_REGULAR_REMOTE_INCOME',
]);

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

function affirmative(value) {
  return value === true || ['YES', 'READY', 'WILL_DO', 'WILL_SEEK'].includes(value);
}

function explicitlyNegative(value) {
  return value === false || ['NO', 'REFUSE', 'NOT_INTERESTED'].includes(value);
}

function sourceWithUsd(source, context, field) {
  const provable = convertMoney(source?.monthly_provable ?? null, 'USD', context, `${field}.monthly_provable`);
  const total = convertMoney(
    source?.monthly_total ?? source?.monthly_provable ?? null,
    'USD',
    context,
    `${field}.monthly_total`,
  );
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
  const savingsConversion = convertMoney(profile.income?.savings ?? null, 'USD', context, 'income.savings');
  const totalMonthlyIncomeUsd = allSources.reduce((sum, source) => sum + Number(source.totalUsd || 0), 0) || null;

  return {
    citizenships: [...profile.citizenships],
    applicationNationality: 'RU',
    currentCountry: profile.residence?.current_country ?? null,
    currentStatus: profile.residence?.current_status ?? null,
    applicationMethods: profile.application_preferences?.methods ?? [],
    primaryIncome: primary,
    applicantSources,
    partnerSources: partner,
    allSources,
    totalMonthlyIncomeUsd,
    incomeMoney: primary.monthly_provable ?? null,
    incomeConversion: primary.conversion,
    savingsUsd: savingsConversion?.convertedAmount ?? null,
    savingsMoney: profile.income?.savings ?? null,
    savingsConversion,
    adults: family.adults_count ?? 1,
    children: Array.isArray(family.children) ? family.children.map((child) => ({ ...child })) : [],
    partnerIncluded: Boolean(family.partner_included),
    relationshipType: family.relationship_type ?? null,
    schoolNeeded: Boolean(family.school_needed),
    lgbt: profile.lgbt ?? null,
    goal: profile.goal?.long_term ?? null,
    physicalPresence: profile.goal?.physical_presence ?? null,
    keepRuCitizenship: profile.goal?.keep_russian_citizenship ?? null,
    languageExamReadiness: profile.goal?.language_exam_readiness ?? null,
    monthlyBudgetUsd: budgetConversion?.convertedAmount ?? totalMonthlyIncomeUsd,
    budgetMoney: budget ?? null,
    budgetConversion,
    budgetDerivedFromIncome: budget == null && totalMonthlyIncomeUsd != null,
    citySize: profile.preferences?.city_size ?? 'ANY',
    petTypes: profile.pets?.types ?? ['NONE'],
    routeSpecificAnswers: profile.route_specific_answers || {},
  };
}

function validateContext(profile, countryPackage, context) {
  const mxnRate = Number(context?.fx?.rates?.MXN);
  const asOf = Date.parse(context?.fx?.as_of);
  const calculationDate = Date.parse(context?.calculation_date);
  const maxAge = Number(context?.fx?.max_age_hours);
  const stale = Number.isFinite(asOf) && Number.isFinite(calculationDate) && Number.isFinite(maxAge)
    ? calculationDate - asOf > maxAge * 3600000
    : true;
  if (!(mxnRate > 0) || stale) {
    throw new CalculationContextError('Для расчёта Мексики необходим актуальный положительный курс MXN к USD.', { currency: 'MXN' });
  }
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

function routeAnswers(profile, routeId) {
  return profile.routeSpecificAnswers?.[routeId] || {};
}

function thresholdUsd(route, context) {
  if (route.income_threshold_amount == null || !route.income_threshold_currency) {
    return { amount: null, conversion: null };
  }
  const conversion = convertMoney(
    { amount: Number(route.income_threshold_amount), currency: route.income_threshold_currency },
    'USD',
    context,
    `routes.${route.route_id}.income_threshold_amount`,
  );
  return { amount: conversion.convertedAmount, conversion };
}

function parseSavingsThresholdMxn(route) {
  const normalized = String(route.income_formula || '').replaceAll('\u00a0', ' ');
  const matches = [...normalized.matchAll(/(\d[\d\s.,]*)\s*MXN/giu)];
  const match = matches.at(-1);
  if (!match) throw new TypeError(`Mexico route ${route.route_id} has no parseable savings threshold`);
  const raw = match[1].replace(/\s/g, '');
  const normalizedNumber = raw.includes(',') && raw.includes('.')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(',', '.');
  const amount = Number(normalizedNumber);
  if (!(amount > 0)) throw new TypeError(`Mexico route ${route.route_id} has an invalid savings threshold`);
  return amount;
}

function matchingEconomicIncome(profile) {
  const sources = profile.applicantSources.filter((source) => ECONOMIC_INCOME_TYPES.has(source.type));
  const foreign = sources.filter((source) => source.source_country && source.source_country !== 'MX');
  const unknown = sources.filter((source) => source.source_country == null);
  const local = sources.filter((source) => source.source_country === 'MX');
  const eligible = [...foreign, ...unknown];
  return {
    sources,
    foreign,
    unknown,
    local,
    eligible,
    amountUsd: eligible.reduce((sum, source) => sum + Number(source.provableUsd || 0), 0),
    original: eligible.length === 1 ? eligible[0].monthly_provable : null,
    conversion: eligible.length === 1 ? eligible[0].conversion : null,
  };
}

function economicEvaluation(route, profile, context) {
  const threshold = thresholdUsd(route, context);
  const savingsThresholdMxn = parseSavingsThresholdMxn(route);
  const savingsThreshold = convertMoney(
    { amount: savingsThresholdMxn, currency: 'MXN' },
    'USD',
    context,
    `routes.${route.route_id}.savings_threshold`,
  );
  const income = matchingEconomicIncome(profile);
  const answers = routeAnswers(profile, route.route_id);
  const incomeMeets = income.amountUsd >= threshold.amount;
  const savingsMeets = Number(profile.savingsUsd) >= savingsThreshold.convertedAmount;
  const checks = [];

  if (income.sources.length > 0 && income.eligible.length === 0 && income.local.length > 0 && !savingsMeets) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'economic_foreign_income_required',
      'Доход от мексиканского работодателя не является иностранным финансовым основанием для резиденции по экономической состоятельности.',
      { action: 'Использовать маршрут по местной оферте либо подтвердить иностранный доход или достаточный средний остаток.' },
    ));
  } else if (incomeMeets) {
    if (income.unknown.length > 0) {
      checks.push(outcome(
        ROUTE_STATUSES.SUITABLE,
        'economic_foreign_source_documents_required',
        'Доход достигает порога. При подаче потребуется подтвердить иностранное происхождение выплат.',
        { action: 'Подготовить договоры, письма работодателя или заказчиков и банковские выписки, подтверждающие иностранный источник выплат.' },
      ));
    } else {
      checks.push(outcome(
        ROUTE_STATUSES.SUITABLE,
        'economic_income_confirmed',
        'Иностранный подтверждаемый доход достигает официального порога.',
        { action: 'Для подачи подготовить выписки и подтверждения дохода за последние 6 полных месяцев.' },
      ));
    }

  } else if (savingsMeets) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'economic_savings_confirmed',
      'Подтверждаемые накопления достигают официальной финансовой альтернативы.',
      { action: 'Для подачи подготовить банковские или инвестиционные выписки, подтверждающие средний остаток за последние 12 месяцев.' },
    ));

  } else {
    const current = Math.max(income.amountUsd || 0, profile.savingsUsd || 0);
    const target = income.amountUsd > 0 ? threshold.amount : savingsThreshold.convertedAmount;
    const message = `Подтверждаемое финансовое основание составляет около ${Math.round(current)} USD, а применимый порог — около ${Math.round(target)} USD.`;
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'economic_financial_below_threshold',
      message,
      { action: 'Для этого маршрута подтверждаемый доход или накопления должны достигать официального порога.' },
    ));
  }

  return {
    checks,
    thresholdUsd: threshold.amount,
    thresholdConversion: threshold.conversion,
    amountUsd: income.amountUsd || profile.savingsUsd || null,
    incomeOriginal: income.original ?? profile.savingsMoney,
    incomeConversion: income.conversion ?? profile.savingsConversion,
    incomeTypeFit: income.eligible.length || profile.savingsUsd != null ? 'MEETS' : income.local.length ? 'DOES_NOT_MEET' : 'NOT_APPLICABLE',
    incomeFit: incomeMeets || savingsMeets ? fit(checks) : checks[0]?.status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS ? 'UNKNOWN' : 'DOES_NOT_MEET',
    basisMissing: !(income.eligible.length || profile.savingsUsd != null),
    incomeGuidance: `${route.income_rule_ru} В текущем расчётном контексте доходный порог — около ${Math.ceil(threshold.amount)} USD в месяц за 6 месяцев; альтернатива по накоплениям — около ${Math.ceil(savingsThreshold.convertedAmount)} USD среднего остатка за 12 месяцев.`,
  };
}

function localJobEvaluation(route, profile) {
  const localEmployment = profile.applicantSources.filter((source) =>
    source.type === 'REMOTE_EMPLOYMENT' && source.source_country === 'MX');
  const activeWork = profile.applicantSources.some((source) => ACTIVE_WORK_TYPES.has(source.type));
  const answers = routeAnswers(profile, route.route_id);
  const willing = answers.willing_local_job ?? answers.ready_to_get_local_offer;
  const checks = [];

  if (localEmployment.length > 0) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'local_job_offer_confirmed',
      'Профиль содержит трудовой доход от мексиканского работодателя; для подачи остаётся подтвердить регистрацию работодателя и предварительную авторизацию INM.',
    ));
  } else if (explicitlyNegative(willing) || (!activeWork && !affirmative(willing))) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'local_job_offer_absent',
      'Мексиканской оферты нет, а текущий профиль не подтверждает активную занятость или готовность искать местную работу.',
      { action: 'Получить формальное предложение работы от зарегистрированного в INM работодателя.' },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'local_job_offer_required',
      'Рабочий маршрут станет доступен после получения мексиканской оферты и предварительной авторизации INM.',
      {
        condition: 'Получить местную оферту и авторизацию INM.',
        action: 'Найти работодателя в Мексике, зарегистрированного в INM, и получить оферту с профессией, сроком, местом работы и оплатой.',
      },
    ));
  }

  return {
    checks,
    thresholdUsd: null,
    thresholdConversion: null,
    amountUsd: localEmployment.reduce((sum, source) => sum + Number(source.provableUsd || 0), 0) || null,
    incomeOriginal: localEmployment.length === 1 ? localEmployment[0].monthly_provable : null,
    incomeConversion: localEmployment.length === 1 ? localEmployment[0].conversion : null,
    incomeTypeFit: localEmployment.length ? 'MEETS' : activeWork || affirmative(willing) ? 'UNKNOWN' : 'DOES_NOT_MEET',
    incomeFit: 'NOT_APPLICABLE',
    basisMissing: localEmployment.length === 0,
    incomeGuidance: route.income_rule_ru,
  };
}

function incomeEvaluation(route, profile, context) {
  if (route.route_id === 'MX_TEMP_ECONOMIC_SOLVENCY') return economicEvaluation(route, profile, context);
  if (route.route_id === 'MX_TEMP_LOCAL_JOB_OFFER') return localJobEvaluation(route, profile);
  throw new TypeError(`Unsupported publishable Mexico route: ${route.route_id}`);
}

function applicationEvaluation(route, profile) {
  return [outcome(
    ROUTE_STATUSES.SUITABLE,
    'mexico_application_procedure',
    'Место подачи является процедурным требованием и не понижает статус маршрута. Первоначальная виза оформляется через мексиканское консульство; после въезда карта резидента оформляется в INM.',
    { action: 'Подать заявление в компетентное мексиканское консульство, затем после въезда оформить карту резидента в INM.' },
  )];
}

function familyEvaluation(route, profile) {
  if (!profile.partnerIncluded && profile.children.length === 0) {
    return [outcome(ROUTE_STATUSES.SUITABLE, 'family_not_applicable', 'Семейное присоединение для текущего состава семьи не требуется.')];
  }
  const actions = ['Для членов семьи подготовить документы о родстве или семейной связи, апостиль или легализацию, перевод на испанский и отдельные заявления.'];
  if (profile.partnerIncluded && profile.relationshipType === 'UNREGISTERED_PARTNER') {
    actions.push('Для незарегистрированного партнёра подготовить доказательства concubinato (юридически признаваемого фактического союза) или общей семьи.');
  }
  return [outcome(
    ROUTE_STATUSES.SUITABLE,
    'family_unity_available',
    'Партнёр и дети могут присоединиться по процедуре семейного единства. Подготовка семейных документов является требованием к подаче и не понижает статус маршрута.',
    { action: actions.join(' ') },
  )];
}

function goalEvaluation(route, profile) {
  const citizenshipRequired = ['CITIZENSHIP_MAIN_GOAL', 'CITIZENSHIP_REQUIRED'].includes(profile.goal);
  const citizenshipRelevant = citizenshipRequired || profile.goal === 'CITIZENSHIP_DESIRED';
  if (citizenshipRelevant && profile.languageExamReadiness === 'NO') {
    return [outcome(
      citizenshipRequired ? ROUTE_STATUSES.UNSUITABLE : ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'mexico_citizenship_language_required',
      'Для натурализации требуются испанский язык, история и культура Мексики.',
      {
        condition: 'Подготовиться к языковому и интеграционному экзаменам.',
        action: 'Изучить испанский и подготовиться к экзаменам по истории и культуре Мексики.',
      },
    )];
  }
  if (citizenshipRelevant && profile.physicalPresence === 'LESS_THAN_6_MONTHS') {
    return [outcome(
      citizenshipRequired ? ROUTE_STATUSES.UNSUITABLE : ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'mexico_citizenship_presence_required',
      'Ограниченное проживание менее половины года несовместимо с правилом непрерывности для натурализации в последние два года.',
      {
        condition: 'Увеличить фактическое проживание и соблюдать лимит отсутствий.',
        action: 'Планировать проживание, при котором суммарные отсутствия за последние два года перед натурализацией не превысят шесть месяцев.',
      },
    )];
  }
  return [outcome(
    ROUTE_STATUSES.SUITABLE,
    'long_term_path_available',
    'Временная резиденция засчитывается для общего перехода к постоянной резиденции и натурализации при соблюдении правил проживания.',
  )];
}

function evaluateRoute(route, indexes, profile, context) {
  const income = incomeEvaluation(route, profile, context);
  const application = applicationEvaluation(route, profile);
  const family = familyEvaluation(route, profile);
  const goal = goalEvaluation(route, profile);
  const checks = [...application, ...income.checks, ...family, ...goal];
  const routeStatus = strictest(checks);
  const blockers = [...new Set(checks.filter((check) => check.status === ROUTE_STATUSES.UNSUITABLE).map((check) => check.message))];
  const conditions = [...new Set(checks.filter((check) => check.status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS).map((check) => check.condition || check.message))];
  const actions = [...new Set(checks.map((check) => check.action).filter(Boolean))];
  const primarySourceId = route.source_ids?.[0] ?? null;
  const applicationGuidance = [
    route.application_abroad_ru && `Из-за рубежа: ${route.application_abroad_ru}`,
    route.application_inside_ru && `После въезда: ${route.application_inside_ru}`,
  ].filter(Boolean).join(' ');

  return {
    routeId: route.route_id,
    routeName: route.name_ru,
    routeStatus,
    statusLabel: STATUS_LABELS_RU[routeStatus],
    applicationNationality: profile.applicationNationality,
    viaSecondaryNationality: profile.applicationNationality !== 'RU',
    thresholdUsd: income.thresholdUsd,
    thresholdEur: null,
    incomeUsd: income.amountUsd,
    incomeEur: null,
    incomeOriginal: income.incomeOriginal ?? profile.incomeMoney,
    incomeConversion: income.incomeConversion ?? profile.incomeConversion,
    incomeRequirementConversion: income.thresholdConversion,
    basisMissing: Boolean(income.basisMissing),
    goalFit: fit(goal),
    applicationFit: fit(application),
    familyFit: fit(family),
    incomeTypeFit: income.incomeTypeFit,
    incomeFit: income.incomeFit,
    countryMissingCount: 0,
    clientMissingCount: 0,
    conditionsCount: conditions.length,
    scenarioAffinity: route.route_id === 'MX_TEMP_ECONOMIC_SOLVENCY'
      && ECONOMIC_INCOME_TYPES.has(profile.primaryIncome.type)
      || route.route_id === 'MX_TEMP_LOCAL_JOB_OFFER'
      && profile.primaryIncome.source_country === 'MX'
      ? 1 : 0,
    checks,
    conditions,
    blockers,
    missing: [],
    countryMissing: [],
    preliminary: [],
    clientMissing: [],
    review: route.open_questions || [],
    actions,
    initialPermitRequirements: actions,
    incomeGuidance: income.incomeGuidance || route.income_rule_ru || null,
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
    work: {
      local_work_allowed: route.local_work_allowed,
      remote_foreign_work_allowed: route.remote_foreign_work_allowed,
      business_allowed: route.business_allowed,
      rule_ru: [
        route.local_work_allowed ? 'местная работа' : null,
        route.remote_foreign_work_allowed ? 'удалённая работа на иностранный источник' : null,
        route.business_allowed ? 'предпринимательство' : null,
      ].filter(Boolean).join(', ') || 'только деятельность в пределах основания маршрута',
    },
    family: {
      rule_ru: route.family_rule_ru,
      partner_work_rights_ru: route.partner_work_rights_ru,
    },
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
    const budgetFit = budgetDifference == null ? 'NOT_APPLICABLE' : budgetDifference >= 0 ? 'MEETS' : 'DOES_NOT_MEET';
    return {
      cityId: city.city_id,
      cityName: city.name_ru,
      populationCategory: sizeCode(city.size),
      roles: city.roles_ru || [],
      costUsd,
      costIsFamilySpecific: true,
      budgetDifference,
      budgetFit,
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
  cities.sort((a, b) => a.costUsd - b.costUsd);
  for (const city of cities) {
    city.roles = (city.roles || [])
      .map((role) => String(role).replace(/\s+из выбранных городов/gi, '').trim())
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
    entryForRussianCitizen: data.entry_for_russian_citizen || null,
  };
}

function evaluateLgbt(data, profile) {
  if (!profile.lgbt?.enabled || !data.lgbt) return null;
  const rule = data.lgbt;
  return {
    enabled: true,
    rules: [{ id: 'MX_LGBT', legalStatus: rule.same_sex_marriage_recognized ? 'YES' : 'NO' }],
    rows: [
      ['Брак и переезд с супругом', rule.same_sex_marriage_rule_ru],
      ['Зарегистрированные отношения', rule.registered_partnership_rule_ru],
      ['Иностранные документы', rule.foreign_document_rule_ru],
      ['Международная защита', rule.international_protection_ru],
    ],
    safety: {
      level: rule.country_safety_category_ru,
      tone: rule.country_safety_category_ru === 'безопасно' || rule.country_safety_category_ru === 'достаточно безопасно' ? 'safe' : 'caution',
      text: rule.safety_explanation_ru,
    },
    pendingChanges: Array.isArray(rule.pending_changes) ? rule.pending_changes : [],
  };
}

function determineCountryGroup(bestRoute, practical, profile, routes = []) {
  if (!bestRoute || routes.every((route) => route.routeStatus === ROUTE_STATUSES.UNSUITABLE)) {
    return ROUTE_STATUSES.UNSUITABLE;
  }
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
  return profile.petTypes?.includes('OTHER')
    ? ['Правила ввоза другого вида животного проверяются отдельно.']
    : [];
}

export const mexicoAdapter = Object.freeze({
  id: 'mexico',
  normalizeProfile,
  validateContext,
  buildIndexes,
  listRoutes,
  evaluateRoute,
  evaluatePractical,
  evaluateLgbt,
  determineCountryGroup,
  collectSources,
  collectPracticalMissing,
});
