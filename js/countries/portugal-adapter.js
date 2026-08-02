import { CalculationContextError } from '../engine/calculate-country.js?v=7.0.2';
import { convertMoney } from '../engine/currency.js?v=7.0.2';
import { ROUTE_STATUSES, STATUS_LABELS_RU } from '../engine/status-contract.js?v=7.0.2';

const REMOTE_INCOME_TYPES = new Set([
  'REMOTE_EMPLOYMENT',
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
]);

const INDEPENDENT_INCOME_TYPES = new Set([
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
]);

const ACTIVE_WORK_TYPES = new Set([
  ...REMOTE_INCOME_TYPES,
  'OTHER_REGULAR_REMOTE_INCOME',
]);

const D7_INCOME_TYPES = new Set(['PASSIVE_INCOME', 'PENSION']);

const outcome = (status, code, message, options = {}) => ({
  status,
  code,
  message,
  condition: options.condition ?? null,
  action: options.action ?? null,
  requirement: options.requirement ?? null,
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

function sourceWithCurrencies(source, context, field) {
  const provableEur = convertMoney(source?.monthly_provable ?? null, 'EUR', context, `${field}.monthly_provable`);
  const provableUsd = convertMoney(source?.monthly_provable ?? null, 'USD', context, `${field}.monthly_provable`);
  const totalUsd = convertMoney(
    source?.monthly_total ?? source?.monthly_provable ?? null,
    'USD',
    context,
    `${field}.monthly_total`,
  );
  return {
    ...source,
    provableEur: provableEur?.convertedAmount ?? null,
    provableUsd: provableUsd?.convertedAmount ?? null,
    totalUsd: totalUsd?.convertedAmount ?? null,
    conversionEur: provableEur,
    conversionUsd: provableUsd,
  };
}

function normalizeProfile(profile = {}, context) {
  const family = profile.family || {};
  const primary = sourceWithCurrencies(profile.income?.primary || {}, context, 'income.primary');
  const additional = (profile.income?.additional_sources || []).map((source, index) =>
    sourceWithCurrencies(source, context, `income.additional_sources[${index}]`));
  const partner = (profile.income?.partner?.sources || []).map((source, index) =>
    sourceWithCurrencies(source, context, `income.partner.sources[${index}]`));
  const applicantSources = [primary, ...additional];
  const allSources = [...applicantSources, ...partner];
  const budget = profile.preferences?.monthly_budget;
  const budgetConversion = convertMoney(budget, 'USD', context, 'preferences.monthly_budget');
  const totalMonthlyIncomeUsd = allSources.reduce((sum, source) => sum + Number(source.totalUsd || 0), 0) || null;

  return {
    citizenships: [...profile.citizenships],
    applicationNationality: 'RU',
    currentCountry: profile.residence?.current_country ?? null,
    currentStatus: profile.residence?.current_status ?? null,
    applicationMethods: profile.application_preferences?.methods ?? [],
    primaryIncome: primary,
    monthlyProvableEur: primary.provableEur,
    monthlyProvableUsd: primary.provableUsd,
    applicantSources,
    partnerSources: partner,
    allSources,
    totalMonthlyIncomeUsd,
    incomeMoney: primary.monthly_provable ?? null,
    incomeConversion: primary.conversionEur,
    adults: family.adults_count ?? 1,
    children: Array.isArray(family.children) ? family.children.map((child) => ({ ...child })) : [],
    partnerIncluded: Boolean(family.partner_included),
    relationshipType: family.relationship_type ?? null,
    schoolNeeded: Boolean(family.school_needed),
    lgbt: profile.lgbt ?? null,
    goal: profile.goal?.long_term ?? null,
    physicalPresence: profile.goal?.physical_presence ?? null,
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
  const rate = context?.fx?.base_currency === 'EUR' ? 1 : Number(context?.fx?.rates?.EUR);
  const asOf = Date.parse(context?.fx?.as_of);
  const calculationDate = Date.parse(context?.calculation_date);
  const maxAge = Number(context?.fx?.max_age_hours);
  const stale = Number.isFinite(asOf) && Number.isFinite(calculationDate) && Number.isFinite(maxAge)
    ? calculationDate - asOf > maxAge * 3600000
    : true;
  if (!(rate > 0) || stale) {
    throw new CalculationContextError('Для расчёта Португалии необходим актуальный положительный курс EUR.', { currency: 'EUR' });
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
    route.publishable === true
    && route.available_to_russian_citizen === true);
}

function routeAnswers(profile, routeId) {
  return profile.routeSpecificAnswers?.[routeId] || {};
}

function affirmative(value) {
  return value === true || ['YES', 'READY', 'WILL_DO', 'WILL_SEEK'].includes(value);
}

function explicitlyNegative(value) {
  return value === false || ['NO', 'REFUSE', 'NOT_INTERESTED'].includes(value);
}

function matchingIncome(sources, acceptedTypes) {
  const matches = sources.filter((source) => acceptedTypes.has(source.type));
  return {
    sources: matches,
    amountEur: matches.reduce((sum, source) => sum + Number(source.provableEur || 0), 0),
    amountUsd: matches.reduce((sum, source) => sum + Number(source.provableUsd || 0), 0),
    original: matches.length === 1 ? matches[0].monthly_provable : null,
    conversion: matches.length === 1 ? matches[0].conversionEur : null,
  };
}

function familyThreshold(route, profile) {
  const base = Number(route.income_threshold_amount);
  if (!Number.isFinite(base)) return null;
  const percentages = String(route.income_formula || '')
    .match(/\d+(?:[.,]\d+)?%/g)
    ?.map((value) => Number(value.replace('%', '').replace(',', '.')) / 100);
  if (!percentages || percentages.length < 3 || percentages.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`Portugal route ${route.route_id} has no parseable family income formula`);
  }
  const [mainApplicantRate, additionalAdultRate, childRate] = percentages;
  return base * mainApplicantRate
    + Math.max(0, Number(profile.adults || 1) - 1) * base * additionalAdultRate
    + (profile.children?.length || 0) * base * childRate;
}

function d8IncomeEvaluation(route, profile) {
  const income = matchingIncome(profile.applicantSources, REMOTE_INCOME_TYPES);
  const thresholdEur = Number(route.income_threshold_amount);
  const checks = [];

  if (income.sources.length === 0) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'd8_income_type_incompatible',
      'Для D8 нужна активная удалённая работа или самостоятельные услуги зарубежному работодателю или заказчикам.',
      { action: 'Создать реальное основание зарубежной удалённой работы или услуг и подтвердить поступления.' },
    ));
  } else {
    const confirmedForeign = income.sources.filter((source) => source.source_country && source.source_country !== 'PT');
    const portuguese = income.sources.filter((source) => source.source_country === 'PT');
    const unknownForeign = income.sources.filter((source) => source.source_country == null);
    const confirmedForeignAmount = confirmedForeign.reduce((sum, source) => sum + Number(source.provableEur || 0), 0);
    const unknownForeignAmount = unknownForeign.reduce((sum, source) => sum + Number(source.provableEur || 0), 0);
    const eligibleAmount = confirmedForeignAmount + unknownForeignAmount;

    if (confirmedForeign.length === 0 && unknownForeign.length === 0 && portuguese.length > 0) {
      checks.push(outcome(
        ROUTE_STATUSES.UNSUITABLE,
        'd8_foreign_source_required',
        'Португальский работодатель или заказчик не создаёт основное зарубежное основание D8.',
        { action: 'Подтвердить работодателя или заказчиков с местом нахождения за пределами Португалии.' },
      ));
    } else if (eligibleAmount < thresholdEur) {
      checks.push(outcome(
        ROUTE_STATUSES.UNSUITABLE,
        'd8_income_below_threshold',
        `Подтверждаемый подходящий доход составляет около ${Math.round(eligibleAmount)} EUR в месяц, обязательный порог D8 — ${Math.round(thresholdEur)} EUR.`,
        { action: `Маршрут недоступен при доходе ниже ${Math.ceil(thresholdEur)} EUR в месяц.` },
      ));
    } else {
      if (unknownForeign.length > 0) {
        checks.push(outcome(
          ROUTE_STATUSES.SUITABLE,
          'd8_foreign_clients_document_requirement',
          'Маршрут доступен; для подачи нужно документально показать, что заказчики находятся за пределами Португалии.',
          { requirement: 'Подготовить договоры, предложения, счета или другие доказательства услуг зарубежным заказчикам.' },
        ));
      }
      if (checks.length === 0) {
        checks.push(outcome(
          ROUTE_STATUSES.SUITABLE,
          'd8_income_confirmed',
          `Зарубежный удалённый доход достигает порога ${Math.round(thresholdEur)} EUR. Период выписок из правил маршрута показывается как требование к подаче и не влияет на статус.`,
        ));
      }
    }
  }

  return {
    checks,
    thresholdEur,
    amountEur: income.amountEur,
    amountUsd: income.amountUsd,
    incomeOriginal: income.original,
    incomeConversion: income.conversion,
    incomeTypeFit: income.sources.length ? 'MEETS' : 'DOES_NOT_MEET',
    incomeFit: income.sources.length ? fit(checks) : 'NOT_APPLICABLE',
    basisMissing: income.sources.length === 0,
  };
}

function d7IncomeEvaluation(route, profile) {
  const income = matchingIncome(profile.allSources, D7_INCOME_TYPES);
  const thresholdEur = familyThreshold(route, profile);
  const checks = [];

  if (income.sources.length === 0) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'd7_income_type_incompatible',
      'Для этого маршрута нужна подтверждаемая пенсия или регулярный собственный пассивный доход.',
      { action: 'Указать подтверждаемую пенсию или регулярный пассивный доход отдельным источником.' },
    ));
  } else if (income.amountEur < thresholdEur) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'd7_income_below_threshold',
      `Подтверждаемый подходящий доход составляет около ${Math.round(income.amountEur)} EUR, семейная формула D7 требует ${Math.round(thresholdEur)} EUR в месяц.`,
      { action: `Маршрут недоступен при доходе ниже ${Math.ceil(thresholdEur)} EUR в месяц.` },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'd7_income_confirmed',
      `Пенсия или пассивный доход достигает семейного порога ${Math.round(thresholdEur)} EUR в месяц.`,
    ));
  }

  return {
    checks,
    thresholdEur,
    amountEur: income.amountEur,
    amountUsd: income.amountUsd,
    incomeOriginal: income.original,
    incomeConversion: income.conversion,
    incomeTypeFit: income.sources.length ? 'MEETS' : 'DOES_NOT_MEET',
    incomeFit: income.sources.length ? (income.amountEur >= thresholdEur ? 'MEETS' : fit(checks)) : 'NOT_APPLICABLE',
    basisMissing: income.sources.length === 0,
  };
}

function d2IncomeEvaluation(route, profile) {
  const income = matchingIncome(profile.applicantSources, INDEPENDENT_INCOME_TYPES);
  const thresholdEur = familyThreshold(route, profile);
  const answers = routeAnswers(profile, route.route_id);
  const hasExistingBasis = income.sources.length > 0;
  const activeWork = profile.applicantSources.some((source) => ACTIVE_WORK_TYPES.has(source.type));
  const readyToCreate = affirmative(
    answers.ready_to_create_basis
    ?? answers.ready_to_prepare_project
    ?? answers.willing_independent_activity,
  );
  const checks = [];

  if (hasExistingBasis) {
    if (income.amountEur < thresholdEur) {
      checks.push(outcome(
        ROUTE_STATUSES.UNSUITABLE,
        'd2_subsistence_below_threshold',
        `Самостоятельное основание есть, но подтверждаемые средства около ${Math.round(income.amountEur)} EUR ниже семейной формулы ${Math.round(thresholdEur)} EUR.`,
        { action: `Маршрут недоступен при подтверждаемых средствах ниже ${Math.ceil(thresholdEur)} EUR в месяц.` },
      ));
    } else {
      checks.push(outcome(
        ROUTE_STATUSES.SUITABLE,
        'd2_existing_basis_confirmed',
        'Тип деятельности соответствует самостоятельной профессиональной или предпринимательской модели, а средства достигают семейной формулы.',
      ));
    }
  } else if (readyToCreate || activeWork) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'd2_basis_creation_required',
      'Текущий профиль не подтверждает готовый договор самостоятельных услуг или предпринимательский проект.',
      {
        condition: 'Создать реальное договорное или предпринимательское основание D2 и подтвердить средства.',
        action: 'Получить договор или предложение договора на самостоятельные услуги либо подготовить жизнеспособный проект и подтверждение намерения инвестировать.',
      },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'd2_basis_absent',
      'Профиль не содержит самостоятельной деятельности, предпринимательского сценария или готовности создать такое основание.',
      { action: 'Подтвердить готовность вести реальную самостоятельную деятельность или предпринимательский проект.' },
    ));
  }

  return {
    checks,
    thresholdEur,
    amountEur: income.amountEur,
    amountUsd: income.amountUsd,
    incomeOriginal: income.original,
    incomeConversion: income.conversion,
    incomeTypeFit: hasExistingBasis ? 'MEETS' : activeWork || readyToCreate ? 'UNKNOWN' : 'DOES_NOT_MEET',
    incomeFit: hasExistingBasis ? (income.amountEur >= thresholdEur ? 'MEETS' : 'DOES_NOT_MEET') : 'NOT_APPLICABLE',
    basisMissing: !hasExistingBasis,
  };
}

function d1IncomeEvaluation(route, profile) {
  const localEmployment = profile.applicantSources.filter((source) =>
    source.type === 'REMOTE_EMPLOYMENT' && source.source_country === 'PT');
  const income = matchingIncome(localEmployment, new Set(['REMOTE_EMPLOYMENT']));
  const answers = routeAnswers(profile, route.route_id);
  const willingness = answers.willing_local_job ?? answers.ready_to_get_local_contract;
  const activeWork = profile.applicantSources.some((source) => ACTIVE_WORK_TYPES.has(source.type));
  const checks = [];

  if (localEmployment.length > 0) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'd1_local_contract_confirmed',
      'Профиль содержит трудовой доход от португальского работодателя, который соответствует договорному основанию D1.',
    ));
  } else if (explicitlyNegative(willingness) || (!activeWork && !affirmative(willingness))) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'd1_local_employment_declined',
      'Португальского трудового договора нет, и профиль не подтверждает готовность получить местную работу.',
      { action: 'Подтвердить готовность получить договор или обещание договора от работодателя в Португалии.' },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'd1_local_contract_required',
      'D1 станет доступен после получения договора или обещания договора с работодателем в Португалии.',
      {
        condition: 'Найти местного работодателя и получить договор или обещание трудового договора.',
        action: 'Найти работодателя в Португалии и получить документально подтверждённое предложение или трудовой договор.',
      },
    ));
  }

  return {
    checks,
    thresholdEur: null,
    amountEur: income.amountEur || null,
    amountUsd: income.amountUsd || null,
    incomeOriginal: income.original,
    incomeConversion: income.conversion,
    incomeTypeFit: localEmployment.length ? 'MEETS' : activeWork || affirmative(willingness) ? 'UNKNOWN' : 'DOES_NOT_MEET',
    incomeFit: 'NOT_APPLICABLE',
    basisMissing: localEmployment.length === 0,
  };
}

function incomeEvaluation(route, profile) {
  if (route.route_id === 'PT_D8_REMOTE') return d8IncomeEvaluation(route, profile);
  if (route.route_id === 'PT_D7_OWN_INCOME') return d7IncomeEvaluation(route, profile);
  if (route.route_id === 'PT_D2_INDEPENDENT') return d2IncomeEvaluation(route, profile);
  if (route.route_id === 'PT_D1_EMPLOYMENT') return d1IncomeEvaluation(route, profile);
  throw new TypeError(`Unsupported publishable Portugal route: ${route.route_id}`);
}

function applicationEvaluation(route) {
  return [outcome(
    ROUTE_STATUSES.SUITABLE,
    'portugal_consular_route_available',
    'Первоначальная резидентская виза оформляется через компетентное португальское консульство, затем карта — через AIMA.',
  )];
}

function familyEvaluation(route, profile) {
  if (profile.partnerIncluded && profile.relationshipType === 'UNREGISTERED_PARTNER') {
    return [outcome(
      ROUTE_STATUSES.SUITABLE,
      'portugal_partnership_document_requirement',
      'Фактическое партнёрство допускается; существующие отношения нужно подтвердить документами по правилам воссоединения.',
      { requirement: 'Собрать документы о совместной жизни и подтвердить признанный фактический союз для AIMA.' },
    )];
  }
  return [outcome(
    ROUTE_STATUSES.SUITABLE,
    'portugal_family_rule_available',
    profile.partnerIncluded || profile.children.length > 0
      ? 'Семейная конфигурация предусмотрена правилами воссоединения; сроки ожидания и финансовая формула указаны в карточке маршрута.'
      : 'Сопровождающие члены семьи не указаны.',
  )];
}

function goalEvaluation() {
  return [outcome(
    ROUTE_STATUSES.SUITABLE,
    'portugal_long_term_path_available',
    'Маршрут ведёт к временной резиденции с общим путём к ПМЖ и гражданству при выполнении требований проживания.',
  )];
}

function initialPermitRequirements(route, checks) {
  return [...new Set([
    route.basis_ru,
    route.income_rule_ru,
    ...checks.map((check) => check.requirement).filter(Boolean),
  ].filter(Boolean))];
}

function evaluateRoute(route, indexes, profile) {
  const application = applicationEvaluation(route, profile);
  const income = incomeEvaluation(route, profile);
  const family = familyEvaluation(route, profile);
  const goal = goalEvaluation(route, profile);
  const checks = [...application, ...income.checks, ...family, ...goal];
  const routeStatus = strictest(checks);
  const blockers = [...new Set(checks
    .filter((check) => check.status === ROUTE_STATUSES.UNSUITABLE)
    .map((check) => check.message))];
  const conditions = [...new Set(checks
    .filter((check) => check.status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS)
    .map((check) => check.condition || check.message))];
  const actions = [...new Set(checks.map((check) => check.action).filter(Boolean))];
  const sourceIds = route.source_ids || [];
  const primarySourceId = sourceIds[0] ?? null;
  const applicationGuidance = [
    route.application_inside_ru && `В Португалии: ${route.application_inside_ru}`,
    route.application_abroad_ru && `До въезда: ${route.application_abroad_ru}`,
  ].filter(Boolean).join(' ');

  return {
    routeId: route.route_id,
    routeName: route.name_ru,
    routeStatus,
    statusLabel: STATUS_LABELS_RU[routeStatus],
    applicationNationality: profile.applicationNationality,
    viaSecondaryNationality: false,
    thresholdUsd: null,
    thresholdEur: income.thresholdEur,
    incomeUsd: income.amountUsd > 0 ? income.amountUsd : profile.monthlyProvableUsd,
    incomeEur: income.amountEur > 0 ? income.amountEur : profile.monthlyProvableEur,
    incomeOriginal: income.incomeOriginal ?? profile.incomeMoney,
    incomeConversion: income.incomeConversion ?? profile.incomeConversion,
    incomeRequirementConversion: null,
    basisMissing: Boolean(income.basisMissing),
    goalFit: fit(goal),
    applicationFit: fit(application),
    familyFit: fit(family),
    incomeTypeFit: income.incomeTypeFit,
    incomeFit: income.incomeFit,
    countryMissingCount: 0,
    clientMissingCount: conditions.length,
    conditionsCount: conditions.length,
    scenarioAffinity: route.route_id === 'PT_D8_REMOTE'
      && REMOTE_INCOME_TYPES.has(profile.primaryIncome.type)
      && profile.primaryIncome.source_country !== 'PT'
      || route.route_id === 'PT_D7_OWN_INCOME' && D7_INCOME_TYPES.has(profile.primaryIncome.type)
      || route.route_id === 'PT_D2_INDEPENDENT'
        && INDEPENDENT_INCOME_TYPES.has(profile.primaryIncome.type)
        && (['SOLE_PROPRIETOR', 'COMPANY_OWNER'].includes(profile.primaryIncome.type)
          || profile.primaryIncome.source_country === 'PT')
      || route.route_id === 'PT_D1_EMPLOYMENT' && profile.primaryIncome.type === 'REMOTE_EMPLOYMENT' && profile.primaryIncome.source_country === 'PT'
      ? 1 : 0,
    checks,
    conditions,
    blockers,
    missing: [],
    countryMissing: [],
    preliminary: [],
    clientMissing: conditions,
    review: [...new Set(route.open_questions || [])],
    actions,
    initialPermitRequirements: initialPermitRequirements(route, checks),
    incomeGuidance: route.income_rule_ru || null,
    applicationGuidance,
    followUpQuestions: [],
    sourceIds,
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
        route.local_work_allowed && 'работа по найму',
        route.remote_foreign_work_allowed && 'удалённая работа на зарубежный источник',
        route.business_allowed && 'самостоятельная или предпринимательская деятельность',
      ].filter(Boolean).join(', '),
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
  const allowedRoles = new Set(['Столица', 'Самый недорогой', 'Самый дорогой', 'Самый прохладный', 'Самый жаркий']);
  const cities = (data.cities || []).map((city) => {
    const costUsd = familyCost(city, profile);
    const budgetDifference = profile.monthlyBudgetUsd == null ? null : profile.monthlyBudgetUsd - costUsd;
    return {
      cityId: city.city_id,
      cityName: city.name_ru,
      populationCategory: sizeCode(city.size),
      roles: (city.roles_ru || []).filter((role) => allowedRoles.has(role)),
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
    rules: [{ id: 'PT_LGBT', legalStatus: 'YES' }],
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
  if (!bestRoute || routes.every((route) => route.routeStatus === ROUTE_STATUSES.UNSUITABLE)) {
    return ROUTE_STATUSES.UNSUITABLE;
  }
  return bestRoute.routeStatus;
}

function collectSources(data, indexes, bestRoute, practical) {
  const ids = new Set([
    ...(bestRoute?.sourceIds || []),
    ...(practical?.recommendedCity?.sourceIds || []),
  ]);
  return [...ids].map((id) => indexes.sources.get(id)).filter(Boolean);
}

function collectPracticalMissing(data, profile) {
  const missing = [];
  if (profile.petTypes?.includes('OTHER')) {
    missing.push('Правила ввоза другого вида животного проверяются отдельно.');
  }
  if (profile.schoolNeeded && (data.cities || []).every((city) => city.international_school_cost_ru == null)) {
    missing.push('Стоимость международной школы зависит от школы и класса и требует отдельной проверки.');
  }
  return missing;
}

export const portugalAdapter = Object.freeze({
  id: 'portugal',
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
