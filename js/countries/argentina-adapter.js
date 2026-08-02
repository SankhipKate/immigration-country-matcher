import { CalculationContextError } from '../engine/calculate-country.js?v=7.0.2';
import { convertMoney } from '../engine/currency.js?v=7.0.2';
import { ROUTE_STATUSES, STATUS_LABELS_RU } from '../engine/status-contract.js?v=7.0.2';

const PUBLIC_STATUSES = Object.freeze({
  SUITABLE: ROUTE_STATUSES.SUITABLE,
  SUITABLE_WITH_CONDITIONS: ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
  UNSUITABLE: ROUTE_STATUSES.UNSUITABLE,
});

const REMOTE_INCOME_TYPES = new Set([
  'REMOTE_EMPLOYMENT',
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
]);

const outcome = (status, code, message, options = {}) => ({
  status,
  code,
  message,
  condition: options.condition ?? null,
  action: options.action ?? null,
});

const strictest = (checks) => checks.some(({ status }) => status === PUBLIC_STATUSES.UNSUITABLE)
  ? PUBLIC_STATUSES.UNSUITABLE
  : checks.some(({ status }) => status === PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS)
    ? PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS
    : PUBLIC_STATUSES.SUITABLE;

const fit = (checks) => checks.some(({ status }) => status === PUBLIC_STATUSES.UNSUITABLE)
  ? 'DOES_NOT_MEET'
  : checks.some(({ status }) => status === PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS)
    ? 'UNKNOWN'
    : 'MEETS';

function convertedMoney(money, context, field) {
  return convertMoney(money, 'USD', context, field);
}

function sourceWithUsd(source, context, field) {
  const conversion = convertedMoney(source?.monthly_provable ?? null, context, `${field}.monthly_provable`);
  const totalConversion = convertedMoney(source?.monthly_total ?? source?.monthly_provable ?? null, context, `${field}.monthly_total`);
  return {
    ...source,
    provableUsd: conversion?.convertedAmount ?? null,
    totalUsd: totalConversion?.convertedAmount ?? null,
    conversion,
  };
}

function normalizeProfile(profile = {}, context) {
  const family = profile.family || {};
  const primary = sourceWithUsd(profile.income?.primary || {}, context, 'income.primary');
  const additional = (profile.income?.additional_sources || []).map((source, index) => sourceWithUsd(source, context, `income.additional_sources[${index}]`));
  const partner = (profile.income?.partner?.sources || []).map((source, index) => sourceWithUsd(source, context, `income.partner.sources[${index}]`));
  const applicantSources = [primary, ...additional];
  const allSources = [...applicantSources, ...partner];
  const budget = profile.preferences?.monthly_budget;
  const budgetConversion = convertedMoney(budget, context, 'preferences.monthly_budget');
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
    monthlyIncomeUsd: primary.provableUsd,
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

function validateContext(profile, countryPackage, context) {
  const arsRate = Number(context?.fx?.rates?.ARS);
  const asOf = Date.parse(context?.fx?.as_of);
  const calculationDate = Date.parse(context?.calculation_date);
  const maxAge = Number(context?.fx?.max_age_hours);
  const stale = Number.isFinite(asOf) && Number.isFinite(calculationDate) && Number.isFinite(maxAge)
    ? calculationDate - asOf > maxAge * 3600000
    : true;
  if (!(arsRate > 0) || stale) {
    throw new CalculationContextError('Для расчёта Аргентины необходим актуальный положительный курс ARS к USD.', { currency: 'ARS' });
  }
}

function buildIndexes(data) {
  return {
    data,
    sources: new Map((data.sources || []).map((source) => [source.source_id, source])),
  };
}

const PUBLIC_ROUTE_IDS = new Set([
  'AR_NOMAD',
  'AR_RENTISTA',
  'AR_PENSIONADO',
  'AR_WORKER',
  'AR_SPECIALIST_TRANSFER',
  'AR_STUDENT',
]);

function listRoutes(data) {
  return (data.routes || []).filter((route) =>
    PUBLIC_ROUTE_IDS.has(route.route_id)
    && route.publishable === true
    && route.available_to_russian_citizen === true
  );
}

function matchingIncome(profile, acceptedTypes) {
  const sources = profile.applicantSources.filter((source) => acceptedTypes.has(source.type));
  return {
    sources,
    amountUsd: sources.reduce((sum, source) => sum + Number(source.provableUsd || 0), 0),
    original: sources.length === 1 ? sources[0].monthly_provable : null,
    conversion: sources.length === 1 ? sources[0].conversion : null,
  };
}

function thresholdUsd(route, context) {
  if (route.income_threshold_amount == null || !route.income_threshold_currency) return { amount: null, conversion: null };
  const conversion = convertMoney(
    { amount: Number(route.income_threshold_amount), currency: route.income_threshold_currency },
    'USD',
    context,
    `routes.${route.route_id}.income_threshold_amount`,
  );
  return { amount: conversion.convertedAmount, conversion };
}

function incomeEvaluation(route, profile, context) {
  const threshold = thresholdUsd(route, context);
  const noThreshold = () => ({ thresholdUsd: null, thresholdConversion: null, amountUsd: null, incomeTypeFit: 'NOT_APPLICABLE', incomeFit: 'NOT_APPLICABLE', checks: [] });

  if (route.route_id === 'AR_NOMAD') {
    const income = matchingIncome(profile, REMOTE_INCOME_TYPES);
    const checks = [];
    if (income.sources.length === 0) {
      checks.push(outcome(PUBLIC_STATUSES.UNSUITABLE, 'income_type_incompatible', 'Для этого маршрута нужна удалённая работа или самостоятельные услуги для зарубежного работодателя, заказчика или компании.', {
        action: 'Подтвердить удалённую работу или самостоятельные услуги для источника за пределами Аргентины.',
      }));
    } else {
      const localSource = income.sources.some((source) => source.source_country === 'AR');
      const sourceNotSpecified = income.sources.some((source) => source.source_country == null);
      const documentsMissing = income.amountUsd <= 0;
      if (localSource) checks.push(outcome(PUBLIC_STATUSES.UNSUITABLE, 'foreign_source_required', 'Доход цифрового кочевника должен поступать от источника за пределами Аргентины.', {
        action: 'Подтвердить зарубежного работодателя, заказчиков или иностранную компанию.',
      }));
      else if (sourceNotSpecified) checks.push(outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'foreign_source_confirmation_required', 'Для части дохода не указана единая страна источника; потребуется подтвердить, что клиенты или заказчики находятся за пределами Аргентины.', {
        condition: 'Подтвердить зарубежных клиентов или заказчиков.',
        action: 'Подготовить договоры, заказы, счета или квитанции с зарубежными клиентами.',
      }));
      if (documentsMissing) checks.push(outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'income_documents_required', 'Числового минимума нет, но нужно документально подтвердить деятельность и реальные поступления.', {
        condition: 'Подготовить документы о деятельности и поступлениях.',
        action: 'Подготовить договор, письмо работодателя, заказы, счета или квитанции и банковские поступления.',
      }));
      if (checks.length === 0) checks.push(outcome(PUBLIC_STATUSES.SUITABLE, 'nomad_income_confirmed', 'Тип дохода и зарубежный источник соответствуют маршруту; фиксированного числового минимума нет.'));
    }
    return {
      thresholdUsd: null,
      thresholdConversion: null,
      amountUsd: income.amountUsd,
      incomeOriginal: income.original,
      incomeConversion: income.conversion,
      incomeTypeFit: income.sources.length ? 'MEETS' : 'DOES_NOT_MEET',
      incomeFit: income.sources.length ? fit(checks) : 'NOT_APPLICABLE',
      checks,
      incomeGuidance: route.income_rule_ru,
    };
  }

  const thresholdRoute = route.route_id === 'AR_RENTISTA' || route.route_id === 'AR_PENSIONADO';
  if (thresholdRoute) {
    const accepted = new Set([route.route_id === 'AR_RENTISTA' ? 'PASSIVE_INCOME' : 'PENSION']);
    const income = matchingIncome(profile, accepted);
    const checks = [];
    if (income.sources.length === 0) {
      const label = route.route_id === 'AR_RENTISTA' ? 'подтверждаемый пассивный доход' : 'подтверждаемая регулярная пенсия';
      checks.push(outcome(PUBLIC_STATUSES.UNSUITABLE, 'income_type_incompatible', `Для этого маршрута нужен ${label}.`, {
        action: route.route_id === 'AR_RENTISTA'
          ? 'Указать пассивный доход от имущества или капитала отдельным источником дохода.'
          : 'Указать пенсию отдельным источником дохода.',
      }));
    } else {
      if (income.sources.some((source) => source.source_country === 'AR')) {
        checks.push(outcome(PUBLIC_STATUSES.UNSUITABLE, 'foreign_source_required', 'Для этого основания требуется иностранный источник выплаты.', {
          action: 'Подтвердить источник выплаты за пределами Аргентины.',
        }));
      }
      if (income.amountUsd < threshold.amount) {
        checks.push(outcome(PUBLIC_STATUSES.UNSUITABLE, 'income_below_threshold', `Подтверждаемый доход составляет около ${Math.round(income.amountUsd)} USD в месяц, а текущий порог — около ${Math.round(threshold.amount)} USD.`, {
          action: `Увеличить подтверждаемый доход минимум до ${Math.ceil(threshold.amount)} USD в месяц.`,
        }));
      } else {
        checks.push(outcome(PUBLIC_STATUSES.SUITABLE, 'income_meets_threshold', 'Подтверждаемый доход достигает действующего финансового порога.'));
      }
    }
    const formula = route.income_formula ? ` Официальная формула: ${route.income_formula}; в исследовании зафиксировано ${Number(route.income_threshold_amount).toLocaleString('ru-RU')} ${route.income_threshold_currency}.` : '';
    return {
      thresholdUsd: threshold.amount,
      thresholdConversion: threshold.conversion,
      amountUsd: income.amountUsd,
      incomeOriginal: income.original,
      incomeConversion: income.conversion,
      incomeTypeFit: income.sources.length ? 'MEETS' : 'DOES_NOT_MEET',
      incomeFit: income.sources.length ? (income.amountUsd >= threshold.amount ? 'MEETS' : 'DOES_NOT_MEET') : 'NOT_APPLICABLE',
      checks,
      incomeGuidance: `Минимальный подтверждаемый доход: около ${Math.ceil(threshold.amount)} USD в месяц.${formula}`,
    };
  }

  if (route.route_id === 'AR_WORKER') {
    return {
      ...noThreshold(),
      checks: [outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'local_contract_required', 'Маршрут станет доступен после получения трудового договора с зарегистрированным аргентинским работодателем.', {
        condition: 'Получить подходящий местный трудовой договор.',
        action: 'Получить трудовой договор с работодателем в Аргентине, зарегистрированным как приглашающая организация.',
      })],
      incomeGuidance: route.income_rule_ru,
      basisMissing: true,
    };
  }

  if (route.route_id === 'AR_SPECIALIST_TRANSFER') {
    return {
      ...noThreshold(),
      checks: [outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'specialist_contract_required', 'Нужен квалифицированный контракт, научная или техническая работа либо подтверждённый внутрикорпоративный перевод.', {
        condition: 'Получить подходящий контракт или оформить внутрикорпоративный перевод.',
        action: 'Получить контракт на квалифицированную, научную, техническую или консультационную работу либо оформить перевод внутри компании.',
      })],
      incomeGuidance: route.income_rule_ru,
      basisMissing: true,
    };
  }

  if (route.route_id === 'AR_STUDENT') {
    return {
      ...noThreshold(),
      checks: [outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'study_enrollment_required', 'Студенческий маршрут станет доступен после зачисления на официальную программу обучения.', {
        condition: 'Поступить на подходящую программу обучения.',
        action: 'Получить подтверждение зачисления в учреждение, зарегистрированное в миграционной службе.',
      })],
      incomeGuidance: route.income_rule_ru,
      basisMissing: true,
    };
  }

  return noThreshold();
}

function familyEvaluation(route, profile) {
  const checks = [];
  if (route.route_id === 'AR_NOMAD' && (profile.partnerIncluded || profile.children.length > 0)) {
    checks.push(outcome(PUBLIC_STATUSES.UNSUITABLE, 'nomad_family_not_included', 'Семья не включается в разрешение цифрового кочевника автоматически; каждому члену семьи нужно отдельное законное основание.', {
      action: 'Выбрать для семьи отдельные законные основания либо другой основной маршрут, допускающий воссоединение.',
    }));
    return checks;
  }
  if (profile.partnerIncluded && profile.relationshipType === 'UNREGISTERED_PARTNER') {
    checks.push(outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'partnership_registration_required', 'Для семейной резиденции фактическое партнёрство должно быть официально зарегистрировано.', {
      condition: 'Зарегистрировать фактическое партнёрство и подготовить подтверждающие документы.',
      action: 'Официально зарегистрировать партнёрство; иностранный документ при необходимости зарегистрировать в Аргентине.',
    }));
  }
  if (checks.length === 0) checks.push(outcome(PUBLIC_STATUSES.SUITABLE, 'family_configuration_supported', 'Состав семьи не создаёт известного препятствия для этого маршрута.'));
  return checks;
}

function goalEvaluation(route, profile) {
  if (route.route_id !== 'AR_NOMAD') return [outcome(PUBLIC_STATUSES.SUITABLE, 'long_term_path_available', 'Маршрут относится к временной резиденции с подтверждённым дальнейшим путём при соблюдении требований проживания.')];
  if (['PR_REQUIRED', 'CITIZENSHIP_REQUIRED'].includes(profile.goal)) {
    return [outcome(PUBLIC_STATUSES.UNSUITABLE, 'direct_long_term_path_unavailable', 'Не соответствует выбранной долгосрочной цели: это краткосрочный статус без прямого пути к ПМЖ или гражданству.')];
  }
  if (profile.goal === 'CITIZENSHIP_DESIRED') {
    return [outcome(PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS, 'long_term_transition_required', 'Это краткосрочный статус. Сам по себе он не является основанием для долгосрочного проживания или гражданства.', {
      condition: 'Учитывать, что для долгосрочной цели потребуется отдельное основание временной резиденции.',
    })];
  }
  return [outcome(PUBLIC_STATUSES.SUITABLE, 'temporary_goal_supported', 'Краткосрочный маршрут соответствует цели временного проживания.')];
}

function evaluateRoute(route, indexes, profile, context) {
  const income = incomeEvaluation(route, profile, context);
  const family = familyEvaluation(route, profile);
  const goal = goalEvaluation(route, profile);
  const application = [outcome(PUBLIC_STATUSES.SUITABLE, 'application_path_researched', 'Для маршрута подтверждён порядок подачи внутри Аргентины и/или из-за рубежа.')];
  const checks = [...application, ...income.checks, ...family, ...goal];
  const routeStatus = strictest(checks);
  const blockers = [...new Set(checks.filter((check) => check.status === PUBLIC_STATUSES.UNSUITABLE).map((check) => check.message))];
  const conditions = [...new Set(checks.filter((check) => check.status === PUBLIC_STATUSES.SUITABLE_WITH_CONDITIONS).map((check) => check.condition || check.message))];
  const actions = [...new Set(checks.map((check) => check.action).filter(Boolean))];
  const primarySourceId = route.source_ids?.[0] ?? null;
  const applicationGuidance = [route.application_inside_ru && `Внутри Аргентины: ${route.application_inside_ru}`, route.application_abroad_ru && `Из-за рубежа: ${route.application_abroad_ru}`].filter(Boolean).join(' ');
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
    clientMissingCount: conditions.length,
    conditionsCount: conditions.length,
    scenarioAffinity: route.route_id === 'AR_NOMAD' && REMOTE_INCOME_TYPES.has(profile.primaryIncome.type)
      || route.route_id === 'AR_RENTISTA' && profile.primaryIncome.type === 'PASSIVE_INCOME'
      || route.route_id === 'AR_PENSIONADO' && profile.primaryIncome.type === 'PENSION'
      ? 1 : 0,
    checks,
    conditions,
    blockers,
    missing: [],
    countryMissing: [],
    preliminary: [],
    clientMissing: conditions,
    review: [],
    actions,
    initialPermitRequirements: [],
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
  };
}

function evaluateLgbt(data, profile) {
  if (!profile.lgbt?.enabled || !data.lgbt) return null;
  const rule = data.lgbt;
  return {
    enabled: true,
    rules: [{ id: 'AR_LGBT', legalStatus: 'YES' }],
    rows: [
      ['Брак и переезд с супругом', rule.same_sex_marriage_rule_ru],
      ['Зарегистрированные отношения', rule.registered_partnership_rule_ru],
      ['Иностранные документы', rule.foreign_document_rule_ru],
      ['Международная защита', rule.international_protection_ru],
    ],
    safety: {
      level: rule.country_safety_category_ru,
      tone: 'safe',
      text: rule.safety_explanation_ru,
    },
    pendingChanges: Array.isArray(rule.pending_changes) ? rule.pending_changes : [],
  };
}

function determineCountryGroup(bestRoute, practical, profile, routes = []) {
  if (!bestRoute || routes.every((route) => route.routeStatus === PUBLIC_STATUSES.UNSUITABLE)) return 'UNSUITABLE';
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

export const argentinaAdapter = Object.freeze({
  id: 'argentina',
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
