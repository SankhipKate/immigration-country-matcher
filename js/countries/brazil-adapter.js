import { CalculationContextError } from '../engine/calculate-country.js?v=7.0.2';
import { convertMoney } from '../engine/currency.js?v=7.0.2';
import { ROUTE_STATUSES, STATUS_LABELS_RU } from '../engine/status-contract.js?v=7.0.2';

const PUBLIC_ROUTE_IDS = new Set([
  'BR_DIGITAL_NOMAD',
  'BR_RETIREMENT',
  'BR_LOCAL_EMPLOYMENT',
  'BR_BRAZIL_GRADUATE_WORK',
  'BR_STUDY',
  'BR_FAMILY_REUNIFICATION',
  'BR_PRODUCTIVE_INVESTOR',
  'BR_REAL_ESTATE_INVESTOR',
]);

const FOREIGN_ACTIVE_INCOME_TYPES = new Set([
  'REMOTE_EMPLOYMENT',
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
  'OTHER_REGULAR_REMOTE_INCOME',
]);

const REGULAR_TOP_UP_TYPES = new Set([
  'REMOTE_EMPLOYMENT',
  'CONTRACTOR',
  'FREELANCE_OR_SELF_EMPLOYED',
  'SOLE_PROPRIETOR',
  'COMPANY_OWNER',
  'PASSIVE_INCOME',
  'PENSION',
  'OTHER_REGULAR_REMOTE_INCOME',
]);

const DIRECT_OR_DEFINED_LONG_TERM_ROUTE_IDS = new Set([
  'BR_PRODUCTIVE_INVESTOR',
  'BR_REAL_ESTATE_INVESTOR',
]);

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

function affirmative(value) {
  return value === true || ['YES', 'READY', 'CONFIRMED', 'WILL_DO', 'WILL_SEEK', 'PLANNED'].includes(value);
}

function explicitlyNegative(value) {
  return value === false || ['NO', 'REFUSE', 'NOT_INTERESTED', 'NOT_PLANNED'].includes(value);
}

function moneyTo(source, targetCurrency, context, field) {
  const provable = convertMoney(source?.monthly_provable ?? null, targetCurrency, context, `${field}.monthly_provable`);
  const total = convertMoney(
    source?.monthly_total ?? source?.monthly_provable ?? null,
    targetCurrency,
    context,
    `${field}.monthly_total`,
  );
  return {
    ...source,
    provableConverted: provable?.convertedAmount ?? null,
    totalConverted: total?.convertedAmount ?? null,
    conversion: provable,
  };
}

function normalizeProfile(profile = {}, context) {
  const family = profile.family || {};
  const primary = moneyTo(profile.income?.primary || {}, 'USD', context, 'income.primary');
  const additional = (profile.income?.additional_sources || []).map((source, index) =>
    moneyTo(source, 'USD', context, `income.additional_sources[${index}]`));
  const partner = (profile.income?.partner?.sources || []).map((source, index) =>
    moneyTo(source, 'USD', context, `income.partner.sources[${index}]`));
  const applicantSources = [primary, ...additional];
  const allSources = [...applicantSources, ...partner];
  const budget = profile.preferences?.monthly_budget;
  const budgetConversion = convertMoney(budget, 'USD', context, 'preferences.monthly_budget');
  const savingsConversion = convertMoney(profile.income?.savings ?? null, 'USD', context, 'income.savings');
  const totalMonthlyIncomeUsd = allSources.reduce((sum, source) => sum + Number(source.totalConverted || 0), 0) || null;

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
    monthlyBudgetUsd: budgetConversion?.convertedAmount ?? (budget?.currency === 'USD' && Number.isFinite(Number(budget?.amount)) ? Number(budget.amount) : null) ?? totalMonthlyIncomeUsd,
    budgetMoney: budget ?? null,
    budgetConversion,
    budgetDerivedFromIncome: budget == null && totalMonthlyIncomeUsd != null,
    citySize: profile.preferences?.city_size ?? 'ANY',
    petTypes: profile.pets?.types ?? ['NONE'],
    routeSpecificAnswers: profile.route_specific_answers || {},
  };
}

function validateContext(profile, countryPackage, context) {
  const brlRate = Number(context?.fx?.rates?.BRL);
  const asOf = Date.parse(context?.fx?.as_of);
  const calculationDate = Date.parse(context?.calculation_date);
  const maxAge = Number(context?.fx?.max_age_hours);
  const stale = Number.isFinite(asOf) && Number.isFinite(calculationDate) && Number.isFinite(maxAge)
    ? calculationDate - asOf > maxAge * 3600000
    : true;
  if (!(brlRate > 0) || stale) {
    throw new CalculationContextError('Для расчёта Бразилии необходим актуальный положительный курс BRL к USD.', { currency: 'BRL' });
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

function thresholdInUsd(route, context, overrideAmount = null) {
  const amount = overrideAmount ?? route.income_threshold_amount;
  if (amount == null || !route.income_threshold_currency) {
    return { amount: null, conversion: null };
  }
  const conversion = convertMoney(
    { amount: Number(amount), currency: route.income_threshold_currency },
    'USD',
    context,
    `routes.${route.route_id}.income_threshold_amount`,
  );
  return { amount: conversion.convertedAmount, conversion };
}

function applicantIncome(profile, allowedTypes, { foreignOnly = false } = {}) {
  const accepted = profile.applicantSources.filter((source) => allowedTypes.has(source.type));
  const eligible = accepted.filter((source) => {
    if (!foreignOnly) return true;
    if (source.type === 'FREELANCE_OR_SELF_EMPLOYED' && source.source_country == null) return true;
    return source.source_country && source.source_country !== 'BR';
  });
  const local = accepted.filter((source) => source.source_country === 'BR');
  const unknown = accepted.filter((source) => source.source_country == null && source.type !== 'FREELANCE_OR_SELF_EMPLOYED');
  return {
    accepted,
    eligible,
    local,
    unknown,
    amountUsd: eligible.reduce((sum, source) => sum + Number(source.provableConverted || 0), 0),
    original: eligible.length === 1 ? eligible[0].monthly_provable : null,
    conversion: eligible.length === 1 ? eligible[0].conversion : null,
  };
}

function russianBankRequirement(sources) {
  return sources.some((source) => source.bank_country === 'RU')
    ? [outcome(
      ROUTE_STATUSES.SUITABLE,
      'brazil_russian_bank_document_requirement',
      'Финансовый порог выполнен; требования выбранного консульства к российским банковским документам относятся к подготовке подачи.',
      { requirement: 'До подачи проверить требования конкретного консульства к переводу, заверению и подтверждению доступа к средствам по российским выпискам.' },
    )]
    : [];
}

function digitalNomadEvaluation(route, profile, context) {
  const income = applicantIncome(profile, FOREIGN_ACTIVE_INCOME_TYPES, { foreignOnly: true });
  const threshold = thresholdInUsd(route, context);
  const answers = routeAnswers(profile, route.route_id);
  const savingsUsd = Number(answers.savings_usd ?? answers.available_savings_usd ?? profile.savingsUsd ?? 0);
  const incomeMeets = income.amountUsd >= threshold.amount;
  const savingsMeets = savingsUsd >= 18000;
  const checks = [];

  if (income.accepted.length > 0 && income.eligible.length === 0 && income.local.length > 0 && !savingsMeets) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_nomad_foreign_basis_required',
      'Доход только от бразильского работодателя не создаёт основание цифрового кочевника.',
      { action: 'Использовать рабочий маршрут по бразильскому договору либо подтвердить зарубежную удалённую деятельность.' },
    ));
  } else if (incomeMeets || savingsMeets) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      incomeMeets ? 'brazil_nomad_income_met' : 'brazil_nomad_savings_met',
      incomeMeets
        ? 'Подтверждаемый зарубежный удалённый доход достигает 1 500 USD в месяц.'
        : 'Подтверждены доступные банковские средства не менее 18 000 USD.',
    ));
    checks.push(...russianBankRequirement(income.eligible));
  } else if (income.eligible.length > 0) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_nomad_finance_below_threshold',
      'Зарубежное удалённое основание есть, но подтверждаемый доход ниже 1 500 USD в месяц и доступные средства ниже 18 000 USD.',
      { action: 'Маршрут недоступен, пока не выполнена хотя бы одна из двух финансовых альтернатив.' },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_nomad_basis_absent',
      'Нет подтверждаемой зарубежной удалённой деятельности и не выполнена финансовая альтернатива по накоплениям.',
      { action: 'Выбрать маршрут, соответствующий текущему основанию и подтверждаемым средствам.' },
    ));
  }

  return {
    checks,
    thresholdUsd: threshold.amount,
    thresholdConversion: threshold.conversion,
    amountUsd: income.amountUsd,
    incomeOriginal: income.original,
    incomeConversion: income.conversion,
    incomeTypeFit: income.accepted.length > 0 ? (income.eligible.length > 0 ? 'MEETS' : 'DOES_NOT_MEET') : 'DOES_NOT_MEET',
    incomeFit: incomeMeets || savingsMeets ? 'MEETS' : 'DOES_NOT_MEET',
    basisMissing: false,
    incomeGuidance: route.income_rule_ru,
  };
}

function retirementEvaluation(route, profile, context) {
  const pensionSources = profile.applicantSources.filter((source) => source.type === 'PENSION');
  const topUpSources = profile.applicantSources.filter((source) => REGULAR_TOP_UP_TYPES.has(source.type));
  const amountUsd = topUpSources.reduce((sum, source) => sum + Number(source.provableConverted || 0), 0);
  const threshold = thresholdInUsd(route, context);
  const checks = [];

  if (pensionSources.length === 0) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_retirement_basis_required',
      'Маршрут требует государственную или частную пенсию либо выплату по потере кормильца.',
      { action: 'Выбрать этот маршрут только при наличии подтверждаемой пенсионной выплаты.' },
    ));
  } else if (amountUsd >= threshold.amount) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'brazil_retirement_income_met',
      'Пенсия и допустимые регулярные доходы достигают 2 000 USD в месяц.',
    ));
    checks.push(...russianBankRequirement(topUpSources));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_retirement_income_below',
      'Пенсионное основание подтверждено, но общая документируемая сумма ниже 2 000 USD в месяц.',
      { action: 'Увеличить допустимый регулярный доход либо выбрать другой маршрут.' },
    ));
  }

  return {
    checks,
    thresholdUsd: threshold.amount,
    thresholdConversion: threshold.conversion,
    amountUsd,
    incomeOriginal: pensionSources.length === 1 ? pensionSources[0].monthly_provable : null,
    incomeConversion: pensionSources.length === 1 ? pensionSources[0].conversion : null,
    incomeTypeFit: pensionSources.length > 0 ? 'MEETS' : 'DOES_NOT_MEET',
    incomeFit: pensionSources.length > 0 && amountUsd >= threshold.amount ? 'MEETS' : 'DOES_NOT_MEET',
    basisMissing: false,
    incomeGuidance: route.income_rule_ru,
  };
}

function localEmploymentEvaluation(route, profile) {
  const answers = routeAnswers(profile, route.route_id);
  const inferredLocalEmployment = profile.applicantSources.some((source) =>
    source.type === 'REMOTE_EMPLOYMENT' && source.source_country === 'BR');
  const offerConfirmed = affirmative(answers.local_job_offer_confirmed ?? answers.brazil_job_offer_confirmed) || inferredLocalEmployment;
  const willing = answers.willing_local_job ?? answers.ready_to_get_local_offer;
  if (offerConfirmed) {
    return {
      checks: [outcome(ROUTE_STATUSES.SUITABLE, 'brazil_local_job_confirmed', 'Есть бразильский трудовой договор или подтверждённая местная оферта.')],
      basisMissing: false,
      scenarioAffinity: 1,
    };
  }
  if (explicitlyNegative(willing)) {
    return {
      checks: [outcome(
        ROUTE_STATUSES.UNSUITABLE,
        'brazil_local_job_rejected',
        'Маршрут требует бразильский трудовой договор, а местную работу пользователь не рассматривает.',
        { action: 'Выбрать маршрут, не зависящий от местного работодателя.' },
      )],
      basisMissing: false,
      scenarioAffinity: 0,
    };
  }
  return {
    checks: [outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_local_job_offer_required',
      'Для рабочего маршрута нужен реальный бразильский трудовой договор и процедура через MigranteWeb.',
      {
        condition: 'Получить предложение работы и участие бразильского работодателя в процедуре.',
        action: 'Найти работодателя в Бразилии, согласовать договор и проверить подачу по RN 02/2017.',
      },
    )],
    basisMissing: !affirmative(willing),
    scenarioAffinity: affirmative(willing) ? 1 : 0,
  };
}

function graduateWorkEvaluation(route, profile) {
  const answers = routeAnswers(profile, route.route_id);
  const degreeCompleted = affirmative(answers.brazil_degree_completed ?? answers.qualifying_brazil_degree_completed);
  const studying = affirmative(answers.studying_in_brazil ?? answers.brazil_degree_in_progress);
  const inBrazil = profile.currentCountry === 'BR' || affirmative(answers.currently_in_brazil);
  if (degreeCompleted && inBrazil) {
    return {
      checks: [outcome(ROUTE_STATUSES.SUITABLE, 'brazil_graduate_work_basis_met', 'Завершено подходящее высшее образование в Бразилии и заявитель находится в стране.')],
      basisMissing: false,
      scenarioAffinity: 1,
    };
  }
  if (degreeCompleted && !inBrazil) {
    return {
      checks: [outcome(
        ROUTE_STATUSES.SUITABLE,
        'brazil_graduate_in_country_application_requirement',
        'Образовательное основание подтверждено; подать заявление нужно после законного въезда в Бразилию.',
        { requirement: 'Законно въехать в Бразилию и подать заявление через MigranteWeb из страны.' },
      )],
      basisMissing: false,
      scenarioAffinity: 1,
    };
  }
  if (studying) {
    return {
      checks: [outcome(
        ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
        'brazil_graduate_degree_to_finish',
        'Маршрут станет доступен после завершения подходящей graduação или pós-graduação stricto sensu в Бразилии.',
        {
          condition: 'Завершить подходящую программу в Бразилии.',
          action: 'Получить диплом и проверить комплект документов RN 50/2024 перед подачей.',
        },
      )],
      basisMissing: false,
      scenarioAffinity: 1,
    };
  }
  return {
    checks: [outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_graduate_basis_required',
      'Маршрут требует завершённую в Бразилии graduação или pós-graduação stricto sensu и подачу из страны.',
      {
        condition: 'Получить подходящее бразильское высшее образование.',
        action: 'Рассматривать маршрут после завершения соответствующей программы в Бразилии.',
      },
    )],
    basisMissing: true,
    scenarioAffinity: 0,
  };
}

function studyEvaluation(route, profile) {
  const answers = routeAnswers(profile, route.route_id);
  const admissionConfirmed = affirmative(answers.admission_confirmed ?? answers.brazil_study_admission_confirmed);
  const fundsConfirmed = affirmative(answers.study_funds_confirmed ?? answers.financial_means_confirmed);
  const willing = answers.willing_to_study ?? answers.study_plan;
  const checks = [];

  if (admissionConfirmed && fundsConfirmed) {
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'brazil_study_basis_met', 'Есть зачисление на подходящую программу и подтверждение средств.'));
  } else if (admissionConfirmed) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_study_funds_required',
      'Зачисление есть, но нужно подтвердить средства, стипендию или содержание ответственным лицом.',
      {
        condition: 'Подтвердить финансовое обеспечение обучения и проживания.',
        action: 'Подготовить банковские документы, стипендию или обязательство о содержании.',
      },
    ));
  } else if (explicitlyNegative(willing)) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_study_not_planned',
      'Студенческий маршрут требует реального зачисления, а обучение пользователь не рассматривает.',
      { action: 'Выбрать другое основание проживания.' },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_study_admission_required',
      'Для студенческого маршрута требуется зачисление на предусмотренную программу и подтверждение средств.',
      {
        condition: 'Получить зачисление и подготовить финансовые документы.',
        action: 'Выбрать признанное учебное учреждение, получить письмо о зачислении и подтвердить средства.',
      },
    ));
  }

  return {
    checks,
    basisMissing: !admissionConfirmed && !affirmative(willing),
    scenarioAffinity: admissionConfirmed || affirmative(willing) ? 1 : 0,
  };
}

function familyRouteEvaluation(route, profile) {
  const answers = routeAnswers(profile, route.route_id);
  const sponsorConfirmed = affirmative(
    answers.brazil_family_sponsor
      ?? answers.family_link_confirmed
      ?? answers.brazilian_or_resident_relative_confirmed,
  );
  const sponsorAbsent = explicitlyNegative(
    answers.brazil_family_sponsor
      ?? answers.family_link_confirmed
      ?? answers.brazilian_or_resident_relative_confirmed,
  );
  const checks = [];

  if (sponsorConfirmed) {
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'brazil_family_link_met', 'Есть предусмотренная законом семейная связь с гражданином или резидентом Бразилии.'));
  } else if (sponsorAbsent) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_family_link_absent',
      'Нет предусмотренного законом родственника или партнёра — гражданина либо резидента Бразилии.',
      { action: 'Использовать самостоятельный миграционный маршрут.' },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_family_link_to_confirm',
      'Семейный маршрут возможен только при подтверждаемой связи с гражданином или резидентом Бразилии.',
      {
        condition: 'Подтвердить статус спонсора и предусмотренную законом степень семейной связи.',
        action: 'Уточнить гражданство или резиденцию родственника и подготовить документы о браке, партнёрстве, родстве или зависимости.',
      },
    ));
  }

  return {
    checks,
    basisMissing: !sponsorConfirmed && !sponsorAbsent,
    scenarioAffinity: sponsorConfirmed ? 1 : 0,
  };
}

function answerMoneyInBrl(answers, keys, context, field) {
  for (const key of keys) {
    const value = answers[key];
    if (value == null || value === '') continue;
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) return Number(value);
    if (typeof value === 'object' && value.amount != null && value.currency) {
      return convertMoney(value, 'BRL', context, `${field}.${key}`).convertedAmount;
    }
  }
  return null;
}

function productiveInvestorEvaluation(route, profile, context) {
  const answers = routeAnswers(profile, route.route_id);
  const capitalBrl = answerMoneyInBrl(
    answers,
    ['investment_capital_brl', 'productive_investment_brl', 'investment_capital'],
    context,
    `route_specific_answers.${route.route_id}`,
  );
  const projectReady = affirmative(answers.investment_project_ready ?? answers.brazil_company_and_plan_ready);
  const innovationProject = affirmative(answers.innovation_project ?? answers.special_innovation_project);
  const standardThreshold = Number(route.income_threshold_amount);
  const threshold = thresholdInUsd(route, context);
  const checks = [];

  if (capitalBrl == null) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_productive_capital_required',
      'Для расчёта инвесторского маршрута нужно указать доступный капитал и готовность бразильского проекта.',
      {
        condition: 'Подтвердить инвестиционный капитал и подготовить компанию с бизнес-планом.',
        action: 'Подтвердить не менее 500 000 BRL внешних средств либо специальный инновационный проект от 150 000 BRL.',
      },
    ));
  } else if (capitalBrl >= standardThreshold && projectReady) {
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'brazil_productive_standard_met', 'Стандартный порог 500 000 BRL и готовность инвестиционного проекта подтверждены.'));
  } else if (capitalBrl >= standardThreshold) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_productive_project_required',
      'Капитал достигает стандартного порога, но нужно оформить бразильскую компанию и инвестиционный план.',
      {
        condition: 'Подготовить юридическое лицо, перевод капитала и бизнес-план.',
        action: 'Оформить проект и комплект документов для MigranteWeb.',
      },
    ));
  } else if (capitalBrl >= 150000 && innovationProject) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_productive_innovation_review',
      'Капитал попадает в специальный инновационный диапазон 150 000–500 000 BRL, который требует индивидуального подтверждения всех критериев проекта.',
      {
        condition: 'Доказать инновационный или научно-технологический характер проекта.',
        action: 'Подготовить подробный бизнес-план и пройти индивидуальную оценку специального порога.',
      },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_productive_capital_below',
      'Доступный капитал ниже стандартных 500 000 BRL, а специальный инновационный проект не подтверждён.',
      { action: 'Увеличить капитал либо подготовить проект, соответствующий специальным инновационным критериям.' },
    ));
  }

  return {
    checks,
    thresholdUsd: threshold.amount,
    thresholdConversion: threshold.conversion,
    amountUsd: capitalBrl == null ? null : convertMoney({ amount: capitalBrl, currency: 'BRL' }, 'USD', context, `route_specific_answers.${route.route_id}.investment_capital`).convertedAmount,
    incomeTypeFit: 'NOT_APPLICABLE',
    incomeFit: capitalBrl != null && capitalBrl >= standardThreshold ? 'MEETS' : 'DOES_NOT_MEET',
    basisMissing: capitalBrl == null,
    scenarioAffinity: capitalBrl != null ? 1 : 0,
    incomeGuidance: route.income_rule_ru,
  };
}

function realEstateInvestorEvaluation(route, profile, context) {
  const answers = routeAnswers(profile, route.route_id);
  const capitalBrl = answerMoneyInBrl(
    answers,
    ['real_estate_investment_brl', 'property_investment_brl', 'investment_capital'],
    context,
    `route_specific_answers.${route.route_id}`,
  );
  const region = String(answers.property_region ?? answers.investment_region ?? '').toUpperCase();
  const reducedRegion = ['NORTH', 'NORTHEAST', 'NORTH_OR_NORTHEAST', 'NORTE', 'NORDESTE'].includes(region);
  const requiredBrl = reducedRegion ? 700000 : 1000000;
  const propertySelected = affirmative(answers.property_selected ?? answers.property_documents_ready);
  const threshold = thresholdInUsd(route, context, requiredBrl);
  const checks = [];

  if (capitalBrl == null) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_property_capital_required',
      'Для расчёта маршрута нужно указать капитал, регион и готовность городской недвижимости.',
      {
        condition: 'Подтвердить применимый порог и выбрать допустимый городской объект.',
        action: 'Подтвердить 1 000 000 BRL либо 700 000 BRL для Северного/Северо-Восточного региона и документы объекта.',
      },
    ));
  } else if (capitalBrl >= requiredBrl && propertySelected) {
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'brazil_property_threshold_met', `Капитал достигает применимого порога ${requiredBrl.toLocaleString('ru-RU')} BRL и объект выбран.`));
  } else if (capitalBrl >= requiredBrl) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_property_selection_required',
      'Капитал достигает применимого порога, но нужно выбрать объект и подтвердить международный перевод средств.',
      {
        condition: 'Оформить допустимый городской объект и документы перевода капитала.',
        action: 'Проверить объект, регистрацию собственности и комплект MigranteWeb.',
      },
    ));
  } else {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_property_capital_below',
      `Доступный капитал ниже применимого порога ${requiredBrl.toLocaleString('ru-RU')} BRL.`,
      { action: 'Увеличить капитал либо выбрать иной маршрут.' },
    ));
  }

  return {
    checks,
    thresholdUsd: threshold.amount,
    thresholdConversion: threshold.conversion,
    amountUsd: capitalBrl == null ? null : convertMoney({ amount: capitalBrl, currency: 'BRL' }, 'USD', context, `route_specific_answers.${route.route_id}.real_estate_investment`).convertedAmount,
    incomeTypeFit: 'NOT_APPLICABLE',
    incomeFit: capitalBrl != null && capitalBrl >= requiredBrl ? 'MEETS' : 'DOES_NOT_MEET',
    basisMissing: capitalBrl == null,
    scenarioAffinity: capitalBrl != null ? 1 : 0,
    incomeGuidance: route.income_rule_ru,
  };
}

function basisEvaluation(route, profile, context) {
  if (route.route_id === 'BR_DIGITAL_NOMAD') return digitalNomadEvaluation(route, profile, context);
  if (route.route_id === 'BR_RETIREMENT') return retirementEvaluation(route, profile, context);
  if (route.route_id === 'BR_LOCAL_EMPLOYMENT') return {
    ...localEmploymentEvaluation(route, profile),
    thresholdUsd: null,
    thresholdConversion: null,
    amountUsd: null,
    incomeTypeFit: 'NOT_APPLICABLE',
    incomeFit: 'NOT_APPLICABLE',
    incomeGuidance: route.income_rule_ru,
  };
  if (route.route_id === 'BR_BRAZIL_GRADUATE_WORK') return {
    ...graduateWorkEvaluation(route, profile),
    thresholdUsd: null,
    thresholdConversion: null,
    amountUsd: null,
    incomeTypeFit: 'NOT_APPLICABLE',
    incomeFit: 'NOT_APPLICABLE',
    incomeGuidance: route.income_rule_ru,
  };
  if (route.route_id === 'BR_STUDY') return {
    ...studyEvaluation(route, profile),
    thresholdUsd: null,
    thresholdConversion: null,
    amountUsd: null,
    incomeTypeFit: 'NOT_APPLICABLE',
    incomeFit: 'NOT_APPLICABLE',
    incomeGuidance: route.income_rule_ru,
  };
  if (route.route_id === 'BR_FAMILY_REUNIFICATION') return {
    ...familyRouteEvaluation(route, profile),
    thresholdUsd: null,
    thresholdConversion: null,
    amountUsd: null,
    incomeTypeFit: 'NOT_APPLICABLE',
    incomeFit: 'NOT_APPLICABLE',
    incomeGuidance: route.income_rule_ru,
  };
  if (route.route_id === 'BR_PRODUCTIVE_INVESTOR') return productiveInvestorEvaluation(route, profile, context);
  if (route.route_id === 'BR_REAL_ESTATE_INVESTOR') return realEstateInvestorEvaluation(route, profile, context);
  throw new TypeError(`Unsupported Brazil route: ${route.route_id}`);
}

function applicationEvaluation(route, profile) {
  const methods = new Set(profile.applicationMethods || []);
  const any = methods.has('ANY');
  const wantsInside = any || methods.has('IN_COUNTRY_AFTER_ENTRY');
  const wantsAbroad = any || methods.has('RUSSIA') || methods.has('CURRENT_COUNTRY');
  const insideOnly = route.route_id === 'BR_BRAZIL_GRADUATE_WORK';
  const available = insideOnly ? wantsInside : wantsInside || wantsAbroad;
  if (!available) {
    return [outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_application_method_mismatch',
      'Пользователь не выбрал ни одного способа подачи, доступного для этого маршрута.',
      { action: insideOnly ? 'Рассмотреть законный въезд и подачу из Бразилии.' : 'Рассмотреть консульскую подачу или подачу после законного въезда.' },
    )];
  }
  if (insideOnly && !profile.currentCountry?.includes('BR')) {
    return [outcome(
      ROUTE_STATUSES.SUITABLE,
      'brazil_inside_application_requirement',
      'Этот маршрут подаётся из Бразилии; текущее местонахождение не блокирует доступность маршрута.',
      { requirement: 'Организовать законный въезд и подать заявление через MigranteWeb из Бразилии.' },
    )];
  }
  return [outcome(ROUTE_STATUSES.SUITABLE, 'brazil_application_available', 'Выбран хотя бы один допустимый способ подачи.')];
}

function familyEvaluation(route, profile) {
  const checks = [outcome(ROUTE_STATUSES.SUITABLE, 'brazil_family_general_available', 'Семейное воссоединение предусмотрено для супруга, партнёра, детей и других установленных родственников.')];
  if (profile.partnerIncluded && profile.relationshipType === 'UNREGISTERED_PARTNER') {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'brazil_unregistered_union_document_requirement',
      'Незарегистрированный партнёр может использовать união estável; существующий устойчивый союз подтверждается документами.',
      { requirement: 'Подготовить документы о совместной жизни, общих обязательствах и иных признаках união estável.' },
    ));
  }
  return checks;
}

function goalEvaluation(route, profile) {
  const prRequired = profile.goal === 'PR_REQUIRED';
  const citizenshipRequired = ['CITIZENSHIP_MAIN_GOAL', 'CITIZENSHIP_REQUIRED'].includes(profile.goal);
  const citizenshipRelevant = citizenshipRequired || profile.goal === 'CITIZENSHIP_DESIRED';
  const checks = [];

  const longTermConfirmed = route.long_term_path?.chain_confirmed_for_required_citizenship === true
    || DIRECT_OR_DEFINED_LONG_TERM_ROUTE_IDS.has(route.route_id);
  if ((prRequired || citizenshipRequired) && !longTermConfirmed) {
    checks.push(outcome(
      ROUTE_STATUSES.UNSUITABLE,
      'brazil_required_long_term_chain_not_confirmed',
      'Первоначальный ВНЖ доступен, но для этого маршрута не подтверждена непрерывная цепочка до резиденции на неопределённый срок и гражданства. Поэтому он не выполняет обязательную долгосрочную цель.',
      { action: 'Выбрать маршрут с подтверждённым переходом на долгосрочный статус либо указать отдельное уже существующее основание.' },
    ));
  } else if (citizenshipRelevant && !longTermConfirmed) {
    checks.push(outcome(
      ROUTE_STATUSES.SUITABLE,
      'brazil_citizenship_path_warning',
      'Первоначальный ВНЖ доступен, но этот маршрут сам по себе не подтверждает путь к гражданству; это предупреждение, а не условие первоначального ВНЖ.',
    ));
  } else {
    checks.push(outcome(ROUTE_STATUSES.SUITABLE, 'brazil_long_term_path_recorded', 'Для выбранной обязательной цели подтверждён долгосрочный путь маршрута.'));
  }

  if (citizenshipRelevant && profile.languageExamReadiness === 'NO') {
    checks.push(outcome(
      citizenshipRequired ? ROUTE_STATUSES.UNSUITABLE : ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'brazil_portuguese_required',
      'Для обычной натурализации нужно подтвердить способность общаться по-португальски.',
      {
        condition: 'Изучить португальский до уровня, достаточного для подтверждения требования.',
        action: 'Запланировать изучение португальского и проверить допустимый документ о языке.',
      },
    ));
  }
  return checks;
}

function followUpsFor(routeId) {
  const byRoute = {
    BR_LOCAL_EMPLOYMENT: [{ code: 'BR_LOCAL_JOB_OFFER', label: 'Есть ли уже предложение работы от работодателя в Бразилии?' }],
    BR_BRAZIL_GRADUATE_WORK: [{ code: 'BR_BRAZIL_DEGREE', label: 'Завершили ли вы подходящую программу высшего образования в Бразилии?' }],
    BR_STUDY: [{ code: 'BR_STUDY_ADMISSION', label: 'Есть ли зачисление в признанное учебное учреждение Бразилии?' }],
    BR_FAMILY_REUNIFICATION: [{ code: 'BR_FAMILY_SPONSOR', label: 'Есть ли у вас родственник или партнёр — гражданин либо резидент Бразилии?' }],
    BR_PRODUCTIVE_INVESTOR: [{ code: 'BR_PRODUCTIVE_CAPITAL', label: 'Какой капитал в BRL вы готовы вложить в бразильскую компанию?' }],
    BR_REAL_ESTATE_INVESTOR: [{ code: 'BR_PROPERTY_CAPITAL', label: 'Какой капитал в BRL вы готовы вложить в городскую недвижимость?' }],
  };
  return byRoute[routeId] || [];
}

function evaluateRoute(route, indexes, profile, context) {
  const basis = basisEvaluation(route, profile, context);
  const application = applicationEvaluation(route, profile);
  const family = familyEvaluation(route, profile);
  const goal = goalEvaluation(route, profile);
  const checks = [...application, ...basis.checks, ...family, ...goal];
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
    thresholdUsd: basis.thresholdUsd ?? null,
    thresholdEur: null,
    incomeUsd: basis.amountUsd ?? null,
    incomeEur: null,
    incomeOriginal: basis.incomeOriginal ?? profile.incomeMoney,
    incomeConversion: basis.incomeConversion ?? profile.incomeConversion,
    incomeRequirementConversion: basis.thresholdConversion ?? null,
    basisMissing: Boolean(basis.basisMissing),
    goalFit: fit(goal),
    applicationFit: fit(application),
    familyFit: fit(family),
    incomeTypeFit: basis.incomeTypeFit ?? 'NOT_APPLICABLE',
    incomeFit: basis.incomeFit ?? 'NOT_APPLICABLE',
    countryMissingCount: 0,
    clientMissingCount: conditions.length,
    conditionsCount: conditions.length,
    scenarioAffinity: basis.scenarioAffinity ?? (
      route.route_id === 'BR_DIGITAL_NOMAD' && FOREIGN_ACTIVE_INCOME_TYPES.has(profile.primaryIncome.type)
      || route.route_id === 'BR_RETIREMENT' && profile.primaryIncome.type === 'PENSION'
        ? 1
        : 0
    ),
    checks,
    conditions,
    blockers,
    missing: [],
    countryMissing: [],
    preliminary: [],
    clientMissing: conditions,
    review: route.open_questions || [],
    actions,
    initialPermitRequirements: [...new Set(checks.map((check) => check.requirement).filter(Boolean))],
    incomeGuidance: basis.incomeGuidance || route.income_rule_ru || null,
    applicationGuidance,
    followUpQuestions: followUpsFor(route.route_id),
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
    rules: [{ id: 'BR_LGBT', legalStatus: rule.same_sex_marriage_recognized ? 'YES' : 'NO' }],
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

export const brazilAdapter = Object.freeze({
  id: 'brazil',
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
