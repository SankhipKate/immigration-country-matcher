import { parseCountryCode } from './countries.js';

const money = (amount, currency) => amount === '' || amount == null ? null : ({ amount: Number(amount), currency });

const incomeSource = (prefix, owner, answers) => ({
  owner,
  type: answers[`${prefix}Type`],
  source_country: answers[`${prefix}Type`] === 'FREELANCE_OR_SELF_EMPLOYED'
    ? null : parseCountryCode(answers[`${prefix}SourceCountry`]),
  bank_country: parseCountryCode(answers[`${prefix}BankCountry`]),
  monthly_provable: money(answers[`${prefix}Amount`], answers[`${prefix}Currency`]),
  evidence_level: answers[`${prefix}Evidence`],
  history_months: null,
  stability: null,
  continues_after_move: null,
  contract_remaining_months: null,
  business_age_months: null,
});

export function buildUserProfile(answers) {
  const partnerIncluded = answers.partnerIncluded === true;
  const children = (answers.childAges || []).map((age) => ({ age_years: age === '' || age == null ? null : Number(age) }));
  const additional = answers.hasAdditionalIncome ? [incomeSource('additional', 'APPLICANT', answers)] : [];
  const partnerSources = partnerIncluded && answers.partnerHasIncome ? [incomeSource('partner', 'PARTNER', answers)] : [];
  const petTypes = answers.petTypes?.length ? answers.petTypes : ['NONE'];
  const medical = answers.medicalEnabled ? {
    specific_medicine_required: Boolean(answers.specificMedicineRequired),
    regular_care_required: Boolean(answers.regularCareRequired),
    prefer_not_to_say: false,
    details: answers.medicalDetails?.trim() || null,
  } : undefined;

  return {
    schema_version: 'user-profile-v1',
    citizenships: ['RU'],
    residence: {
      current_country: parseCountryCode(answers.currentCountry),
      current_status: answers.currentStatus,
    },
    application_preferences: { methods: answers.applicationMethods?.length ? answers.applicationMethods : answers.applicationMethod ? [answers.applicationMethod] : [] },
    family: {
      adults_count: partnerIncluded ? 2 : 1,
      partner_included: partnerIncluded,
      relationship_type: partnerIncluded ? answers.relationshipType : null,
      children,
      school_needed: children.length > 0 && Boolean(answers.schoolNeeded),
    },
    lgbt: {
      enabled: Boolean(answers.lgbtEnabled),
      consent_for_personalization: Boolean(answers.lgbtEnabled),
      family_recognition_relevant: partnerIncluded && answers.lgbtEnabled ? true : null,
      safety_relevant: answers.lgbtEnabled ? true : null,
    },
    income: {
      primary: incomeSource('primary', 'APPLICANT', answers),
      has_additional_sources: Boolean(answers.hasAdditionalIncome),
      additional_sources: additional,
      partner: { has_income: partnerSources.length > 0, sources: partnerSources },
      savings: null,
    },
    goal: {
      long_term: answers.longTermGoal,
      physical_presence: answers.physicalPresence,
      language_exam_readiness: ['PR_REQUIRED', 'CITIZENSHIP_DESIRED', 'CITIZENSHIP_MAIN_GOAL', 'CITIZENSHIP_REQUIRED'].includes(answers.longTermGoal)
        ? answers.languageExamReadiness : 'DEPENDS_ON_LANGUAGE',
      keep_russian_citizenship: answers.keepRuCitizenship,
    },
    preferences: {
      monthly_budget: answers.budgetUnknown ? null : money(answers.monthlyBudget, answers.budgetCurrency),
      city_size: answers.citySize,
      climate: answers.climates?.length ? answers.climates : answers.climate ? [answers.climate] : [],
    },
    pets: {
      types: petTypes,
      dogs: petTypes.includes('DOG') ? [{ breed: answers.dogBreed?.trim() || null }] : [],
      other_pet_notes: petTypes.includes('CAT') ? answers.otherPetNotes?.trim() || null : null,
    },
    special_circumstances: answers.specialCircumstances?.length ? answers.specialCircumstances : ['NONE'],
    ...(medical ? { optional_modules: { medical } } : {}),
    route_specific_answers: answers.routeSpecificAnswers || {},
  };
}

const code = (value) => typeof value === 'string' && /^[A-Z]{2}$/.test(value);
const positiveMoney = (value) => value && Number(value.amount) >= 0 && /^[A-Z]{3}$/.test(value.currency || '');

export function validateUserProfile(profile) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  if (profile?.schema_version !== 'user-profile-v1') add('schema_version', 'Неверная версия профиля.');
  if (JSON.stringify(profile?.citizenships) !== '["RU"]') add('citizenships', 'Анкета предназначена только для граждан РФ.');
  if (!code(profile?.residence?.current_country)) add('currentCountry', 'Укажите двухбуквенный код текущей страны.');
  if (!profile?.residence?.current_status) add('currentStatus', 'Укажите ваш текущий статус.');
  if (!profile?.application_preferences?.methods?.[0]) add('applicationMethods', 'Выберите хотя бы один способ подачи.');
  if (![1, 2].includes(profile?.family?.adults_count)) add('partnerIncluded', 'Укажите, переезжает ли партнёр.');
  if (profile?.family?.partner_included && !profile.family.relationship_type) add('relationshipType', 'Укажите, как оформлены отношения.');
  if ((profile?.family?.children || []).some((child) => !Number.isInteger(child.age_years) || child.age_years < 0 || child.age_years > 25)) add('childAges', 'Укажите возраст каждого ребёнка от 0 до 25 лет.');
  const sources = [profile?.income?.primary, ...(profile?.income?.additional_sources || []), ...(profile?.income?.partner?.sources || [])];
  for (const source of sources) {
    if (!source?.type) add('primaryType', 'Укажите тип дохода.');
    if (source?.source_country !== null && !code(source?.source_country)) add('primarySourceCountry', 'Укажите двухбуквенный код страны источника дохода.');
    if (source?.source_country === null && source?.type !== 'FREELANCE_OR_SELF_EMPLOYED') add('primarySourceCountry', 'Укажите страну источника дохода.');
    if (!code(source?.bank_country)) add('primaryBankCountry', 'Укажите двухбуквенный код страны банка.');
    if (!positiveMoney(source?.monthly_provable) || source.monthly_provable.amount <= 0) add('primaryAmount', 'Укажите положительную подтверждаемую сумму и валюту.');
    if (!source?.evidence_level) add('primaryEvidence', 'Укажите полноту подтверждения дохода.');
  }
  if (!profile?.goal?.long_term) add('longTermGoal', 'Выберите долгосрочную цель.');
  if (!profile?.goal?.physical_presence) add('physicalPresence', 'Укажите, сколько времени готовы жить в стране.');
  if (!profile?.goal?.language_exam_readiness) add('languageExamReadiness', 'Укажите готовность к языковому экзамену.');
  if (!profile?.goal?.keep_russian_citizenship) add('keepRuCitizenship', 'Укажите важность сохранения гражданства РФ.');
  if (profile?.preferences?.monthly_budget !== null && (!positiveMoney(profile?.preferences?.monthly_budget) || profile.preferences.monthly_budget.amount <= 0)) add('monthlyBudget', 'Укажите положительный семейный бюджет или выберите «Пока не знаю».');
  if (!profile?.preferences?.city_size) add('citySize', 'Выберите размер города.');
  if (!profile?.preferences?.climate?.length) add('climates', 'Выберите хотя бы один климат.');
  if (!profile?.pets?.types?.length) add('petTypes', 'Укажите домашних животных.');
  if (!profile?.special_circumstances?.length) add('specialCircumstances', 'Ответьте на вопрос об особых обстоятельствах.');
  return { valid: errors.length === 0, errors };
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const typeMatches = (value, type) => type === 'null' ? value === null
  : type === 'array' ? Array.isArray(value)
    : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : type === 'integer' ? Number.isInteger(value)
        : typeof value === type;

export function validateAgainstSchema(value, schema, rootSchema = schema, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.$ref?.startsWith('#/')) {
    const target = schema.$ref.slice(2).split('/').reduce((current, key) => current?.[key], rootSchema);
    return validateAgainstSchema(value, target, rootSchema, path);
  }
  const errors = [];
  const add = (message) => errors.push({ path, message });
  if ('const' in schema && !same(value, schema.const)) add('Значение не соответствует контракту.');
  if (schema.enum && !schema.enum.some((item) => same(item, value))) add('Значение отсутствует в списке допустимых.');
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      add('Неверный тип значения.');
      return errors;
    }
  }
  if (schema.anyOf && !schema.anyOf.some((candidate) => validateAgainstSchema(value, candidate, rootSchema, path).length === 0)) add('Значение не соответствует ни одному допустимому варианту.');
  if (schema.allOf) {
    for (const candidate of schema.allOf) {
      if (candidate.if) {
        const matches = validateAgainstSchema(value, candidate.if, rootSchema, path).length === 0;
        errors.push(...validateAgainstSchema(value, matches ? candidate.then : candidate.else, rootSchema, path));
      } else errors.push(...validateAgainstSchema(value, candidate, rootSchema, path));
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) add(`Значение должно быть не меньше ${schema.minimum}.`);
    if (schema.maximum != null && value > schema.maximum) add(`Значение должно быть не больше ${schema.maximum}.`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) add('Значение слишком короткое.');
    if (schema.maxLength != null && value.length > schema.maxLength) add('Значение слишком длинное.');
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) add('Неверный формат значения.');
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) add(`Нужно выбрать не меньше ${schema.minItems}.`);
    if (schema.maxItems != null && value.length > schema.maxItems) add(`Допустимо не больше ${schema.maxItems}.`);
    if (schema.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) add('Значения не должны повторяться.');
    if (schema.items) value.forEach((item, index) => errors.push(...validateAgainstSchema(item, schema.items, rootSchema, `${path}[${index}]`)));
    if (schema.contains && !value.some((item, index) => validateAgainstSchema(item, schema.contains, rootSchema, `${path}[${index}]`).length === 0)) add('Не найдено обязательное значение.');
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push({ path: `${path}.${key}`, message: 'Обязательное поле отсутствует.' });
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validateAgainstSchema(child, schema.properties[key], rootSchema, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push({ path: `${path}.${key}`, message: 'Поле не предусмотрено контрактом.' });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validateAgainstSchema(child, schema.additionalProperties, rootSchema, `${path}.${key}`));
    }
  }
  return errors;
}

export function collectEligibleFollowUps(calculation) {
  const eligibleStatuses = new Set(['SUITABLE', 'SUITABLE_WITH_CONDITIONS', 'PRELIMINARY_SUITABLE']);
  const entries = (calculation?.routes || []).filter((route) => eligibleStatuses.has(route.routeStatus))
    .flatMap((route) => (route.followUpQuestions || []).map((question) => [question.code, { ...question, routeName: route.routeName }]));
  return [...new Map(entries).values()];
}

export function describeIncomeRequirement(route, formatCurrency) {
  if (route?.incomeTypeFit === 'DOES_NOT_MEET') {
    const acceptedByRoute = {
      ES_DNV: 'Подойдут удалённая работа по трудовому договору, договоры с иностранными заказчиками или доход владельца иностранной компании.',
      ES_NLV: 'Нужен пассивный доход, который не требует работы: например, аренда, дивиденды или пенсия.',
      ES_SELF_EMPLOYED: 'Нужен план самостоятельной деятельности или бизнеса в Испании.',
      ES_ENTREPRENEUR: 'Нужен инновационный предпринимательский проект, проходящий индивидуальную оценку.',
      ES_HIGHLY_QUALIFIED: 'Нужно предложение квалифицированной работы от работодателя в Испании.',
      ES_STUDENT: 'Нужно основание для обучения и средства на проживание; текущий рабочий доход сам по себе не создаёт студенческий маршрут.',
      UY_DIGITAL_NOMAD: 'Подойдут удалённая работа по найму, договоры с иностранными заказчиками или доход владельца иностранной компании.',
    };
    const change = acceptedByRoute[route.routeId] || 'Для этого маршрута требуется другой юридически допустимый источник средств.';
    return `Ваш текущий тип дохода не принимается для этого варианта. ${change} Сумма дохода не является причиной отказа.`;
  }
  if (route?.thresholdEur == null) return 'Финансовое требование для этого варианта не выражено единым порогом и проверяется по документам.';
  return `Минимальный подтверждаемый доход: ${formatCurrency(route.thresholdEur, 'EUR')} в месяц.`;
}

export function describeResultIntro(routes, changed = false) {
  const allUnsuitable = routes?.length > 0 && routes.every((route) => route.routeStatus === 'UNSUITABLE');
  return {
    heading: changed ? 'Результат обновлён после уточнения' : allUnsuitable ? 'Сейчас подходящих вариантов не найдено' : 'Предварительный результат',
    routeLabel: allUnsuitable ? 'Наиболее близкий вариант при изменении условий' : 'Лучший доступный вариант',
  };
}
