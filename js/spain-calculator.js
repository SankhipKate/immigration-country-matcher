export const ROUTE_STATUSES = Object.freeze({
  SUITABLE: 'SUITABLE',
  PRELIMINARY_SUITABLE: 'PRELIMINARY_SUITABLE',
  SUITABLE_WITH_CONDITIONS: 'SUITABLE_WITH_CONDITIONS',
  UNSUITABLE: 'UNSUITABLE',
  INSUFFICIENT_COUNTRY_DATA: 'INSUFFICIENT_COUNTRY_DATA',
  INDIVIDUAL_REVIEW_REQUIRED: 'INDIVIDUAL_REVIEW_REQUIRED',
});

export const STATUS_LABELS_RU = Object.freeze({
  SUITABLE: 'Подходит',
  PRELIMINARY_SUITABLE: 'Предварительно подходит',
  SUITABLE_WITH_CONDITIONS: 'Подходит с условиями',
  UNSUITABLE: 'Не подходит',
  INSUFFICIENT_COUNTRY_DATA: 'Недостаточно данных о стране',
  INDIVIDUAL_REVIEW_REQUIRED: 'Нужна индивидуальная проверка',
});

export const COUNTRY_GROUP_LABELS_RU = Object.freeze({
  SUITABLE: 'Подходит',
  PRELIMINARY: 'Предварительный результат',
  REQUIRES_REVIEW: 'Требует дополнительной проверки',
  LEGAL_BUT_PRACTICALLY_UNSUITABLE: 'Юридически доступна, но не проходит практические условия',
  UNSUITABLE: 'Не подходит',
});

// The two maps intentionally differ. The calculation specification forbids using
// one enum order both for conflict resolution and for selecting the best option.
export const CONFLICT_SEVERITY_RANK = Object.freeze({
  UNSUITABLE: 6,
  INDIVIDUAL_REVIEW_REQUIRED: 5,
  INSUFFICIENT_COUNTRY_DATA: 4,
  PRELIMINARY_SUITABLE: 3,
  SUITABLE_WITH_CONDITIONS: 2,
  SUITABLE: 1,
});

export const SELECTION_PREFERENCE_RANK = Object.freeze({
  SUITABLE: 6,
  SUITABLE_WITH_CONDITIONS: 5,
  PRELIMINARY_SUITABLE: 4,
  INSUFFICIENT_COUNTRY_DATA: 3,
  INDIVIDUAL_REVIEW_REQUIRED: 2,
  UNSUITABLE: 1,
});

const BASIS_ROUTE = Object.freeze({
  REMOTE_EMPLOYEE: 'ES_DNV',
  REMOTE_CONTRACTOR: 'ES_DNV',
  FOREIGN_COMPANY_OWNER: 'ES_DNV',
  PASSIVE_INCOME: 'ES_NLV',
  SELF_EMPLOYED_SPAIN: 'ES_SELF_EMPLOYED',
  INNOVATIVE_PROJECT: 'ES_ENTREPRENEUR',
  SPANISH_JOB_OFFER: 'ES_HIGHLY_QUALIFIED',
  STUDY: 'ES_STUDENT',
});

const BASIS_INCOME_TYPE = Object.freeze({
  REMOTE_EMPLOYEE: 'EMPLOYEE',
  REMOTE_CONTRACTOR: 'CONTRACTOR',
  FOREIGN_COMPANY_OWNER: 'COMPANY_OWNER',
  PASSIVE_INCOME: 'PASSIVE',
  STUDY: 'OTHER',
});

const ROUTE_NAMES_RU = Object.freeze({
  ES_DNV: 'ВНЖ международного телеработника',
  ES_NLV: 'ВНЖ без права на работу',
  ES_SELF_EMPLOYED: 'ВНЖ и работа на себя',
  ES_ENTREPRENEUR: 'ВНЖ инновационного предпринимателя',
  ES_HIGHLY_QUALIFIED: 'ВНЖ высококвалифицированного специалиста',
  ES_STUDENT: 'Студенческое разрешение',
});

function result(status, code, message, options = {}) {
  return {
    status,
    code,
    message,
    condition: options.condition ?? null,
    field: options.field ?? null,
  };
}

export function resolveStatusConflict(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return ROUTE_STATUSES.PRELIMINARY_SUITABLE;
  }
  return statuses.reduce((strictest, current) =>
    CONFLICT_SEVERITY_RANK[current] > CONFLICT_SEVERITY_RANK[strictest]
      ? current
      : strictest
  );
}

export function selectBestVariant(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  return [...variants].sort((a, b) => {
    const statusDifference =
      SELECTION_PREFERENCE_RANK[b.routeStatus] -
      SELECTION_PREFERENCE_RANK[a.routeStatus];
    if (statusDifference !== 0) return statusDifference;
    return (b.selectionScore ?? 0) - (a.selectionScore ?? 0);
  })[0];
}

function normaliseProfile(profile = {}) {
  const adults = Math.max(1, Number(profile.adults || 1));
  const children = Math.max(0, Number(profile.children || 0));
  const eurUsdRate = Number(profile.eurUsdRate || 1.144);
  return {
    applicationNationality: profile.applicationNationality || 'RU',
    plannedBasis: profile.plannedBasis || 'REMOTE_EMPLOYEE',
    currentLocation: profile.currentLocation || 'THIRD_COUNTRY',
    legalResidence: profile.legalResidence !== false,
    monthlyIncomeUsd: Math.max(0, Number(profile.monthlyIncomeUsd || 0)),
    eurUsdRate: eurUsdRate > 0 ? eurUsdRate : 1.144,
    bankCountry: profile.bankCountry || 'OTHER',
    socialSecurityPlan: profile.socialSecurityPlan || 'REGISTER_SPAIN',
    adults,
    children,
    relationshipType: adults > 1
      ? (profile.relationshipType || 'MARRIAGE')
      : 'NONE',
    sameSexFamily: Boolean(profile.sameSexFamily && adults > 1),
    needsFamilyVisa: Boolean(profile.needsFamilyVisa && adults > 1),
    schoolNeeded: Boolean(profile.schoolNeeded && children > 0),
    goal: profile.goal || 'TEMPORARY_RESIDENCE',
    monthsPerYear: Math.min(12, Math.max(0, Number(profile.monthsPerYear || 12))),
    languageReadiness: profile.languageReadiness || 'YES',
    keepRuCitizenship: profile.keepRuCitizenship || 'DESIRABLE',
    monthlyBudgetUsd: Math.max(0, Number(profile.monthlyBudgetUsd || 0)),
    citySize: profile.citySize || 'ANY',
    pet: profile.pet || 'NONE',
    dogBreed: String(profile.dogBreed || '').trim(),
    medicineRequired: Boolean(profile.medicineRequired),
  };
}

function indexData(data) {
  return {
    routeIncome: new Map(data.route_income.map((row) => [
      `${row.route_id}:${row.accepted_income_type}`,
      row,
    ])),
    routeFamily: new Map(data.route_family.map((row) => [row.route_id, row])),
    routeStatus: new Map(data.route_status.map((row) => [row.route_id, row])),
    routeWork: new Map(data.route_work.map((row) => [row.route_id, row])),
    sources: new Map(data.sources.map((row) => [row.source_id, row])),
  };
}

function calculateFamilyThreshold(incomeRule, profile) {
  const dependants = Math.max(0, profile.adults + profile.children - 1);
  let threshold = Number(incomeRule.minimum_income_main_applicant || 0);
  if (dependants === 0) return threshold;

  const partnerIncrement = Number(incomeRule.partner_increment_value || 0);
  const additionalIncrement = Number(incomeRule.child_increment_value || 0);
  threshold += partnerIncrement;
  if (dependants > 1) threshold += additionalIncrement * (dependants - 1);
  return threshold;
}

function evaluateApplication(route, profile) {
  const checks = [];
  if (route.russian_citizens_allowed !== 'YES' && profile.applicationNationality === 'RU') {
    checks.push(result(
      ROUTE_STATUSES.UNSUITABLE,
      'nationality_not_allowed',
      'Маршрут не подтверждён для подачи по гражданству РФ.'
    ));
  } else {
    checks.push(result(
      ROUTE_STATUSES.SUITABLE,
      'nationality_allowed',
      'Подача по гражданству РФ юридически предусмотрена.'
    ));
  }

  if (profile.currentLocation === 'SPAIN') {
    checks.push(route.in_country_application_allowed === 'YES'
      ? result(ROUTE_STATUSES.SUITABLE, 'application_in_spain', 'Подача внутри Испании предусмотрена.')
      : result(ROUTE_STATUSES.UNSUITABLE, 'application_in_spain_blocked', 'Для этого маршрута подача внутри Испании не предусмотрена.'));
  } else if (profile.currentLocation === 'RUSSIA') {
    checks.push(route.application_from_russia === 'YES'
      ? result(ROUTE_STATUSES.SUITABLE, 'application_from_russia', 'Подача из России предусмотрена.')
      : result(ROUTE_STATUSES.UNSUITABLE, 'application_from_russia_blocked', 'Подача из России не подтверждена.'));
  } else if (route.requires_legal_residence_in_application_country === 'YES' && !profile.legalResidence) {
    checks.push(result(
      ROUTE_STATUSES.UNSUITABLE,
      'legal_residence_required',
      'Для подачи в текущей стране требуется законное резидентство, которого нет в профиле.'
    ));
  } else {
    checks.push(result(
      ROUTE_STATUSES.SUITABLE,
      'application_location_ok',
      'Место подачи соответствует известным правилам маршрута.'
    ));
  }
  return checks;
}

function evaluateIncome(route, indexes, profile) {
  const expectedType = BASIS_INCOME_TYPE[profile.plannedBasis];
  if (!expectedType) {
    if (route.route_id === 'ES_HIGHLY_QUALIFIED') {
      return {
        checks: [result(
          ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA,
          'hq_salary_missing',
          'Официальный зарплатный порог 2026 для выбранного вида разрешения ещё не внесён.',
          { field: 'minimum_income_main_applicant' }
        )],
        thresholdEur: null,
        incomeEur: profile.monthlyIncomeUsd / profile.eurUsdRate,
        incomeFit: 'UNKNOWN',
      };
    }
    if (route.route_id === 'ES_SELF_EMPLOYED' || route.route_id === 'ES_ENTREPRENEUR') {
      return {
        checks: [result(
          ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED,
          'business_case_review',
          'Маршрут зависит от бизнес-плана, квалификации, инвестиций или оценки проекта.'
        )],
        thresholdEur: null,
        incomeEur: profile.monthlyIncomeUsd / profile.eurUsdRate,
        incomeFit: 'INDIVIDUAL_REVIEW_REQUIRED',
      };
    }
  }

  const incomeRule = indexes.routeIncome.get(`${route.route_id}:${expectedType}`);
  if (!incomeRule) {
    return {
      checks: [result(
        ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA,
        'income_rule_missing',
        'Для выбранного типа дохода в маршруте нет подтверждённого правила.'
      )],
      thresholdEur: null,
      incomeEur: profile.monthlyIncomeUsd / profile.eurUsdRate,
      incomeFit: 'UNKNOWN',
    };
  }

  const thresholdEur = calculateFamilyThreshold(incomeRule, profile);
  const incomeEur = profile.monthlyIncomeUsd / profile.eurUsdRate;
  const checks = [];

  if (profile.monthlyIncomeUsd <= 0) {
    checks.push(result(
      ROUTE_STATUSES.PRELIMINARY_SUITABLE,
      'income_missing',
      'Подтверждаемый доход не указан.',
      { field: 'monthlyIncomeUsd' }
    ));
  } else if (incomeEur < thresholdEur) {
    checks.push(result(
      ROUTE_STATUSES.UNSUITABLE,
      'income_below_threshold',
      `Доход после пересчёта составляет около ${Math.round(incomeEur)} EUR, требование маршрута — ${Math.round(thresholdEur)} EUR в месяц.`
    ));
  } else if (incomeEur < thresholdEur * 1.1) {
    checks.push(result(
      ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
      'income_close_to_threshold',
      'Доход превышает порог менее чем на 10%; нужен запас на валютные колебания и удержания.',
      { condition: 'Поддерживать подтверждаемый доход минимум на 10% выше порога.' }
    ));
  } else {
    checks.push(result(
      ROUTE_STATUSES.SUITABLE,
      'income_meets_threshold',
      'Подтверждаемый доход превышает рассчитанный семейный порог.'
    ));
  }

  if (route.route_id === 'ES_DNV') {
    if (profile.bankCountry === 'RU') {
      checks.push(result(
        ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA,
        'russian_bank_documents_open',
        'Приём выписок российского банка требует отдельного подтверждения.',
        { field: 'russian_bank_statements_accepted' }
      ));
    }

    if (profile.socialSecurityPlan === 'REGISTER_SPAIN') {
      checks.push(result(
        ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
        'spanish_social_security_required',
        'Маршрут возможен при оформлении испанского социального страхования.',
        { condition: 'Оформить применимую регистрацию в Seguridad Social.' }
      ));
    } else if (profile.socialSecurityPlan === 'FOREIGN_CERTIFICATE') {
      checks.push(result(
        ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA,
        'foreign_social_security_certificate_open',
        'Допустимость иностранного сертификата для российского кейса не подтверждена.',
        { field: 'social_contribution_required' }
      ));
    } else {
      checks.push(result(
        ROUTE_STATUSES.PRELIMINARY_SUITABLE,
        'social_security_plan_missing',
        'Не выбран способ выполнения требования по социальному страхованию.'
      ));
    }
  }

  return {
    checks,
    thresholdEur,
    incomeEur,
    incomeFit: incomeEur >= thresholdEur ? 'MEETS' : 'DOES_NOT_MEET',
  };
}

function evaluateFamily(route, indexes, profile) {
  const dependants = profile.adults + profile.children - 1;
  if (dependants <= 0) {
    return [result(ROUTE_STATUSES.SUITABLE, 'no_dependants', 'Зависимые члены семьи в профиле отсутствуют.')];
  }

  const familyRule = indexes.routeFamily.get(route.route_id);
  if (!familyRule) {
    return [result(
      ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA,
      'family_rule_missing',
      'Для этого маршрута семейные правила ещё не структурированы.'
    )];
  }

  const checks = [];
  if (profile.adults > 1 && profile.needsFamilyVisa) {
    if (familyRule.partner_allowed !== 'YES') {
      checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'partner_not_allowed', 'Партнёр не может быть включён в этот маршрут.'));
    } else {
      checks.push(result(ROUTE_STATUSES.SUITABLE, 'partner_allowed', 'Партнёр может быть включён в маршрут.'));
    }

    const relationshipTypes = familyRule.accepted_relationship_types || [];
    if (!relationshipTypes.includes(profile.relationshipType)) {
      checks.push(result(
        familyRule.unregistered_partner_allowed === 'UNKNOWN'
          ? ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA
          : ROUTE_STATUSES.UNSUITABLE,
        'relationship_not_confirmed',
        'Выбранный тип отношений не подтверждён для семейного статуса.'
      ));
    }

    if (profile.sameSexFamily && familyRule.same_sex_partner_allowed !== 'YES') {
      checks.push(result(
        familyRule.same_sex_partner_allowed === 'UNKNOWN'
          ? ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA
          : ROUTE_STATUSES.UNSUITABLE,
        'same_sex_partner_not_confirmed',
        'Семейный статус для однополой пары не подтверждён.'
      ));
    }
  }

  if (profile.children > 0 && familyRule.children_allowed !== 'YES') {
    checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'children_not_allowed', 'Дети не могут быть включены в этот маршрут.'));
  } else if (profile.children > 0) {
    checks.push(result(ROUTE_STATUSES.SUITABLE, 'children_allowed', 'Дети могут быть включены в маршрут.'));
  }

  return checks.length ? checks : [result(ROUTE_STATUSES.SUITABLE, 'family_ok', 'Семейная конфигурация соответствует маршруту.')];
}

function evaluateLongTerm(route, indexes, profile) {
  const statusRule = indexes.routeStatus.get(route.route_id);
  if (!statusRule) {
    return [result(ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, 'long_term_rule_missing', 'Долгосрочный путь маршрута не заполнен.')];
  }

  if (profile.goal === 'TEMPORARY_RESIDENCE') {
    return [result(ROUTE_STATUSES.SUITABLE, 'temporary_goal', 'Маршрут предоставляет первоначальный статус проживания.')];
  }

  const checks = [];
  if (profile.goal === 'PR_REQUIRED') {
    if (statusRule.path_to_pr === 'YES') {
      checks.push(result(ROUTE_STATUSES.SUITABLE, 'pr_path_available', 'Маршрут засчитывается в путь к ПМЖ.'));
    } else if (statusRule.path_to_pr === 'CONDITIONAL') {
      checks.push(result(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'pr_path_conditional', 'Зачёт маршрута в путь к ПМЖ зависит от перехода на другой статус.'));
    } else {
      checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'pr_path_unavailable', 'Подтверждённого пути к ПМЖ по маршруту нет.'));
    }
    if (profile.monthsPerYear < 10) {
      checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'pr_presence_too_low', 'Для непрерывного пятилетнего проживания планируется слишком мало времени в стране.'));
    }
  }

  if (profile.goal === 'CITIZENSHIP_REQUIRED') {
    if (statusRule.path_to_citizenship === 'YES') {
      checks.push(result(ROUTE_STATUSES.SUITABLE, 'citizenship_path_available', 'Маршрут засчитывается в путь к гражданству.'));
    } else if (statusRule.path_to_citizenship === 'CONDITIONAL') {
      checks.push(result(ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED, 'citizenship_path_conditional', 'Для гражданства требуется переход на резиденцию, которая засчитывается в срок.'));
    } else {
      checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'citizenship_path_unavailable', 'Подтверждённого пути к гражданству нет.'));
    }

    if (profile.languageReadiness === 'NO') {
      checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'language_refused', 'Для гражданства требуется испанский язык, а профиль исключает экзамен.'));
    } else if (profile.languageReadiness === 'BASIC') {
      checks.push(result(
        ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
        'language_condition',
        'Для гражданства потребуется подтвердить испанский язык на уровне A2 и пройти CCSE.',
        { condition: 'Подготовиться к DELE A2 и CCSE.' }
      ));
    }

    if (profile.keepRuCitizenship === 'REQUIRED') {
      checks.push(result(ROUTE_STATUSES.UNSUITABLE, 'renunciation_conflict', 'Испанское право требует декларации отказа от прежнего гражданства, а его сохранение указано как обязательное.'));
    } else if (profile.keepRuCitizenship === 'DESIRABLE') {
      checks.push(result(
        ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS,
        'renunciation_condition',
        'Вопрос декларации отказа и последствия для гражданства РФ требуют персональной проверки.',
        { condition: 'До подачи на гражданство получить индивидуальную консультацию по двум правопорядкам.' }
      ));
    }

    if (profile.monthsPerYear < 10) {
      checks.push(result(
        ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA,
        'citizenship_absence_rule_open',
        'Для выбранного режима проживания недостаточно подтверждённых данных о допустимых отсутствиях при натурализации.',
        { field: 'allowed_absence_for_citizenship_days' }
      ));
    }
  }

  return checks.length ? checks : [result(ROUTE_STATUSES.SUITABLE, 'long_term_ok', 'Долгосрочная цель соответствует маршруту.')];
}

function evaluateRoute(route, indexes, profile) {
  const checks = [];
  const targetRouteId = BASIS_ROUTE[profile.plannedBasis];
  if (route.route_id !== targetRouteId) {
    checks.push(result(
      ROUTE_STATUSES.UNSUITABLE,
      'basis_mismatch',
      'Маршрут не соответствует выбранному основанию переезда.'
    ));
  } else {
    checks.push(result(ROUTE_STATUSES.SUITABLE, 'basis_match', 'Маршрут соответствует выбранному основанию переезда.'));
  }

  checks.push(...evaluateApplication(route, profile));
  const income = evaluateIncome(route, indexes, profile);
  checks.push(...income.checks);
  checks.push(...evaluateFamily(route, indexes, profile));
  checks.push(...evaluateLongTerm(route, indexes, profile));

  const routeStatus = resolveStatusConflict(checks.map((check) => check.status));
  const conditions = checks.filter((check) => check.status === ROUTE_STATUSES.SUITABLE_WITH_CONDITIONS).map((check) => check.condition || check.message);
  const blockers = checks.filter((check) => check.status === ROUTE_STATUSES.UNSUITABLE).map((check) => check.message);
  const missing = checks.filter((check) => check.status === ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA).map((check) => check.message);
  const preliminary = checks.filter((check) => check.status === ROUTE_STATUSES.PRELIMINARY_SUITABLE).map((check) => check.message);
  const review = checks.filter((check) => check.status === ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED).map((check) => check.message);

  return {
    routeId: route.route_id,
    routeName: route.name_ru || ROUTE_NAMES_RU[route.route_id] || route.official_name,
    routeStatus,
    statusLabel: STATUS_LABELS_RU[routeStatus],
    applicationNationality: profile.applicationNationality,
    selectionScore: (route.route_id === targetRouteId ? 100 : 0) + (income.incomeFit === 'MEETS' ? 10 : 0),
    thresholdEur: income.thresholdEur,
    incomeEur: income.incomeEur,
    incomeFit: income.incomeFit,
    checks,
    conditions: [...new Set(conditions)],
    blockers: [...new Set(blockers)],
    missing: [...new Set(missing)],
    preliminary: [...new Set(preliminary)],
    review: [...new Set(review)],
    primarySourceId: route.primary_source_id,
    longTerm: indexes.routeStatus.get(route.route_id) || null,
    work: indexes.routeWork.get(route.route_id) || null,
    family: indexes.routeFamily.get(route.route_id) || null,
  };
}

function familyCost(city, profile) {
  if (profile.adults === 1 && profile.children === 0) {
    return Number(city.estimated_monthly_cost_single_usd || 0);
  }
  if (profile.adults === 2 && profile.children === 0) {
    return Number(city.estimated_monthly_cost_couple_usd || 0);
  }
  if (profile.adults === 2 && profile.children === 1) {
    return Number(city.estimated_monthly_cost_family_1_child_usd || 0);
  }

  const base = Number(city.estimated_monthly_cost_single_usd || 0);
  const extraAdults = Math.max(0, profile.adults - 1) * Number(city.additional_adult_cost_usd || 0);
  const children = profile.children * Number(city.additional_child_cost_usd || 0);
  return base + extraAdults + children;
}

function evaluateCities(data, profile) {
  const candidates = data.cities
    .filter((city) => profile.citySize === 'ANY' || city.population_category === profile.citySize)
    .map((city) => {
      const costUsd = familyCost(city, profile);
      let budgetFit = 'NOT_APPLICABLE';
      let budgetProximity = 'NOT_APPLICABLE';
      if (profile.monthlyBudgetUsd > 0) {
        budgetFit = costUsd <= profile.monthlyBudgetUsd ? 'MEETS' : 'DOES_NOT_MEET';
        budgetProximity = Math.abs(profile.monthlyBudgetUsd - costUsd) <= profile.monthlyBudgetUsd * 0.1
          ? 'WITHIN_MARGIN'
          : 'OUTSIDE_MARGIN';
      }

      const missing = [];
      if (city.general_safety === 'UNKNOWN') missing.push('Сопоставимая городская оценка безопасности ещё не подтверждена.');
      if (profile.pet !== 'NONE' && city.pet_friendly_housing === 'UNKNOWN') missing.push('Доступность аренды с животными ещё не подтверждена.');
      if (profile.schoolNeeded && city.international_school_available !== 'YES') missing.push('Международная школа не подтверждена.');

      let practicalEvaluation = 'MEETS';
      if (budgetFit === 'DOES_NOT_MEET') practicalEvaluation = 'DOES_NOT_MEET';
      else if (profile.pet !== 'NONE' && missing.some((item) => item.includes('животными'))) practicalEvaluation = 'UNKNOWN';

      return {
        cityId: city.city_id,
        cityName: city.name_ru,
        populationCategory: city.population_category,
        costUsd,
        budgetFit,
        budgetProximity,
        practicalEvaluation,
        missing,
        airport: city.airport_name,
        climate: city.climate_category,
        primarySourceId: city.primary_source_id,
      };
    })
    .sort((a, b) => {
      const fitRank = { MEETS: 3, UNKNOWN: 2, DOES_NOT_MEET: 1, NOT_APPLICABLE: 2 };
      return fitRank[b.practicalEvaluation] - fitRank[a.practicalEvaluation] || a.costUsd - b.costUsd;
    });

  return {
    cities: candidates,
    recommendedCity: candidates[0] || null,
  };
}

function determineCountryGroup(bestRoute, cityResult, profile) {
  if (!bestRoute || bestRoute.routeStatus === ROUTE_STATUSES.UNSUITABLE) return 'UNSUITABLE';
  if ([ROUTE_STATUSES.INSUFFICIENT_COUNTRY_DATA, ROUTE_STATUSES.INDIVIDUAL_REVIEW_REQUIRED].includes(bestRoute.routeStatus)) {
    return 'REQUIRES_REVIEW';
  }
  if (bestRoute.routeStatus === ROUTE_STATUSES.PRELIMINARY_SUITABLE) return 'PRELIMINARY';
  if (cityResult.recommendedCity?.practicalEvaluation === 'DOES_NOT_MEET') return 'LEGAL_BUT_PRACTICALLY_UNSUITABLE';
  if (profile.pet !== 'NONE' && cityResult.recommendedCity?.practicalEvaluation === 'UNKNOWN') return 'REQUIRES_REVIEW';
  return 'SUITABLE';
}

function collectSources(data, indexes, bestRoute, cityResult) {
  const sourceIds = new Set([
    bestRoute?.primarySourceId,
    bestRoute?.longTerm?.source_id,
    bestRoute?.work?.source_id,
    bestRoute?.family?.source_id,
    cityResult.recommendedCity?.primarySourceId,
    data.country.primary_source_id,
  ].filter(Boolean));

  for (const source of data.sources) {
    if (source.entity_id === bestRoute?.routeId && source.primary === 'YES') sourceIds.add(source.source_id);
    if (source.entity_id === 'ES' && ['citizenship_by_residence', 'long_term_residence', 'tax_residency_rule'].includes(source.fact_field)) {
      sourceIds.add(source.source_id);
    }
  }
  return [...sourceIds].map((id) => indexes.sources.get(id)).filter(Boolean);
}

export function calculateSpain(rawProfile, data) {
  if (!data || data.country?.country_id !== 'ES') {
    throw new TypeError('Ожидался исследовательский пакет Испании.');
  }
  const profile = normaliseProfile(rawProfile);
  const indexes = indexData(data);
  const routeEvaluations = data.routes.map((route) => evaluateRoute(route, indexes, profile));
  const bestRoute = selectBestVariant(routeEvaluations);
  const cityResult = evaluateCities(data, profile);
  const countryGroup = determineCountryGroup(bestRoute, cityResult, profile);
  const sources = collectSources(data, indexes, bestRoute, cityResult);

  const practicalMissing = [
    ...(cityResult.recommendedCity?.missing || []),
  ];
  if (profile.pet === 'DOG') {
    const dogRule = data.pet_rules.find((rule) => rule.animal_type === 'DOG');
    if (dogRule?.rabies_titer_required === 'UNKNOWN') practicalMissing.push('Необходимость титра антител для ввоза собаки из России требует актуальной проверки.');
  }
  if (profile.medicineRequired) practicalMissing.push('Наличие конкретного лекарства и правила ввоза личного запаса проверяются отдельно.');

  return {
    schemaVersion: data.schema_version,
    calculatedAt: new Date().toISOString(),
    profile,
    country: {
      countryId: data.country.country_id,
      name: data.country.name_ru,
      researchStatus: data.country.country_research_status,
      confidence: data.country.confidence,
      group: countryGroup,
      groupLabel: COUNTRY_GROUP_LABELS_RU[countryGroup],
    },
    bestRoute,
    routes: routeEvaluations,
    cities: cityResult.cities,
    recommendedCity: cityResult.recommendedCity,
    practicalMissing: [...new Set(practicalMissing)],
    sources,
  };
}
