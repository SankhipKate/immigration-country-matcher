import {
  calculateSpain,
  STATUS_LABELS_RU,
} from '../js/spain-calculator.js';
import { loadCalculationContext } from './fx-context.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $('#profile-form');
const questionnaireView = $('#questionnaireView');
const resultView = $('#resultView');
const resultRoot = $('#result');
const submitButton = $('#calculate');
const nextButton = $('#nextStep');
const prevButton = $('#prevStep');
const steps = $$('.wizard-step');
const TOTAL_STEPS = steps.length;
const STORAGE_KEY = 'immigration-matcher-spain-draft-v07';
const RESULT_KEY = 'immigration-matcher-spain-result-v06';
let currentStep = 1;
let spainData;
let calculationContext;
let lastCalculation;

const currency = (value, code = 'USD', digits = 0) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: code, maximumFractionDigits: digits,
  }).format(Number(value || 0));

const number = (value) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const radioValue = (name) => $(`input[name="${name}"]:checked`)?.value;
const setRadioValue = (name, value) => {
  const input = $(`input[name="${name}"][value="${CSS.escape(String(value))}"]`);
  if (input) input.checked = true;
};
const get = (id) => $(`#${id}`).value;
const checked = (id) => $(`#${id}`).checked;
const numberValue = (id) => get(id) === '' ? null : Number(get(id));
const specified = (value) => value !== null && value !== undefined && value !== '';

const BASIS_LABELS = {
  REMOTE_EMPLOYEE: 'Удалённая работа по найму',
  REMOTE_CONTRACTOR: 'Фриланс и контракты',
  FOREIGN_COMPANY_OWNER: 'Владелец иностранной компании',
  PASSIVE_INCOME: 'Пассивный доход',
  SELF_EMPLOYED_SPAIN: 'Работа на себя в Испании',
  INNOVATIVE_PROJECT: 'Инновационный проект',
  SPANISH_JOB_OFFER: 'Оффер испанского работодателя',
  STUDY: 'Учёба',
};
const GOAL_LABELS = {
  TEMPORARY_RESIDENCE: 'ВНЖ', PR_REQUIRED: 'ПМЖ', CITIZENSHIP_REQUIRED: 'Гражданство',
};
const LANGUAGE_LABELS = { NO: 'Нет', BASIC: 'Базовый уровень', YES: 'Да' };
const PET_LABELS = { NONE: 'Нет', DOG: 'Собака', CAT: 'Кошка' };
const LOCATION_LABELS = { THIRD_COUNTRY: 'В другой стране', SPAIN: 'В Испании', RUSSIA: 'В России' };
const CITY_DESCRIPTIONS = {
  Аликанте: 'Экономичный прибрежный город с мягким климатом.',
  Малага: 'Активный городской ритм и развитая инфраструктура.',
  Валенсия: 'Баланс семейной жизни и городской инфраструктуры.',
};

function readProfile() {
  return {
    applicationNationality: 'RU',
    plannedBasis: radioValue('plannedBasis'),
    currentLocation: get('currentLocation'),
    legalResidence: get('legalResidence') === '' ? null : get('legalResidence') === 'YES',
    monthlyIncomeUsd: numberValue('monthlyIncomeUsd'),
    bankCountry: get('bankCountry'),
    adults: numberValue('adults'),
    children: numberValue('children'),
    relationshipType: get('relationshipType'),
    sameSexFamily: Number(get('adults')) > 1 && checked('sameSexFamily'),
    needsFamilyVisa: Number(get('adults')) > 1 && checked('needsFamilyVisa'),
    schoolNeeded: checked('schoolNeeded'),
    goal: radioValue('goal'),
    monthsPerYear: numberValue('monthsPerYear'),
    languageReadiness: radioValue('languageReadiness'),
    keepRuCitizenship: get('keepRuCitizenship'),
    monthlyBudgetUsd: numberValue('monthlyBudgetUsd'),
    citySize: get('citySize'),
    pet: get('pet'),
    dogBreed: get('dogBreed'),
    medicineRequired: checked('medicineRequired'),
  };
}

function profileSummaryRows(profile, forResult = false) {
  const family = specified(profile.adults) && specified(profile.children) ? `${profile.adults} ${profile.adults === 1 ? 'взрослый' : 'взрослых'}, ${profile.children} ${profile.children === 1 ? 'ребёнок' : 'детей'}` : 'Не указано';
  const amount = (value) => specified(value) ? `${number(value)} USD/мес` : 'Не указано';
  const rows = [
    ['⌘', 'Основание для ВНЖ', BASIS_LABELS[profile.plannedBasis] || 'Не указано'],
    ['▣', forResult ? 'Доход после пересчёта' : 'Доход', forResult && lastCalculation?.bestRoute ? currency(lastCalculation.bestRoute.incomeEur, 'EUR') : amount(profile.monthlyIncomeUsd)],
    ['♙', 'Состав семьи', family],
    ['◎', 'Цель', GOAL_LABELS[profile.goal] || 'Не указано'],
    ['▤', 'Бюджет без школы', amount(profile.monthlyBudgetUsd)],
  ];
  if (!forResult) rows.push(
    ['⌖', 'Где вы сейчас', LOCATION_LABELS[profile.currentLocation] || 'Не указано'],
    ['◇', 'Школа', hasMeaningfulFormData() ? (profile.schoolNeeded ? 'Нужна' : 'Не нужна') : 'Не указано'],
    ['♢', 'Животное', PET_LABELS[profile.pet] || 'Не указано'],
    ['文', 'Испанский', LANGUAGE_LABELS[profile.languageReadiness] || 'Не указано'],
  );
  return rows;
}

function renderSummary(root, profile, forResult = false) {
  const emptyMessage = !forResult && !hasMeaningfulFormData() ? '<p class="empty-profile-message">Профиль пока не заполнен</p>' : '';
  root.innerHTML = emptyMessage + profileSummaryRows(profile, forResult).map(([icon, label, value]) => `
    <div class="summary-row"><span class="summary-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>
  `).join('');
}

function updateProfileSummary() {
  const profile = readProfile();
  renderSummary($('#profileSummary'), profile);
  if (currentStep === TOTAL_STEPS) renderReview(profile);
}

function hasMeaningfulFormData() {
  return Boolean(radioValue('plannedBasis') || radioValue('goal') || radioValue('languageReadiness') ||
    ['currentLocation','legalResidence','monthlyIncomeUsd','bankCountry','adults','children','relationshipType','monthsPerYear','keepRuCitizenship','monthlyBudgetUsd','citySize','pet','dogBreed'].some((id) => specified(get(id))) ||
    ['sameSexFamily','needsFamilyVisa','schoolNeeded','medicineRequired'].some(checked));
}

function isFormComplete() {
  const profile = readProfile();
  return Boolean(profile.plannedBasis && profile.currentLocation && profile.legalResidence !== null &&
    profile.monthlyIncomeUsd > 0 && profile.bankCountry &&
    profile.adults >= 1 && profile.children >= 0 && profile.goal && specified(profile.monthsPerYear) &&
    profile.languageReadiness && profile.keepRuCitizenship && profile.monthlyBudgetUsd > 0 && profile.citySize && profile.pet &&
    (profile.adults < 2 || profile.relationshipType));
}

function updateActionAvailability() {
  submitButton.disabled = !spainData || !calculationContext || !isFormComplete();
}

function renderReview(profile) {
  const items = [
    ['Кто переезжает', `${profile.adults} взросл., ${profile.children} дет.`],
    ['Основание для ВНЖ', BASIS_LABELS[profile.plannedBasis]],
    ['Доход', `${number(profile.monthlyIncomeUsd)} USD/мес`],
    ['Место подачи', `${LOCATION_LABELS[profile.currentLocation]}, резидентство: ${profile.legalResidence ? 'есть' : 'нет'}`],
    ['Цель', GOAL_LABELS[profile.goal]],
    ['Бюджет', `${number(profile.monthlyBudgetUsd)} USD/мес`],
    ['Школа', profile.schoolNeeded ? 'Нужна' : 'Не нужна'],
    ['Животное', PET_LABELS[profile.pet]],
  ];
  $('#reviewSummary').innerHTML = items.map(([label, value]) => `<div class="review-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
}

function showStep(step, shouldScroll = true) {
  currentStep = Math.max(1, Math.min(TOTAL_STEPS, step));
  steps.forEach((section, index) => {
    const active = index + 1 === currentStep;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });
  $('#stepLabel').textContent = `Шаг ${currentStep} из ${TOTAL_STEPS}`;
  $('#progressBar').style.width = `${currentStep / TOTAL_STEPS * 100}%`;
  prevButton.hidden = currentStep === 1;
  nextButton.hidden = currentStep === TOTAL_STEPS;
  submitButton.hidden = currentStep !== TOTAL_STEPS;
  if (currentStep === TOTAL_STEPS) renderReview(readProfile());
  if (shouldScroll) $('.wizard-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validateStep(step) {
  const errors = [];
  if (step === 1 && (!specified(get('adults')) || !specified(get('children')))) errors.push('Укажите состав семьи.');
  if (step === 2 && (!radioValue('plannedBasis') || !get('currentLocation') || !get('legalResidence'))) errors.push('Выберите основание для ВНЖ и место подачи.');
  if (step === 3 && (numberValue('monthlyIncomeUsd') <= 0 || !get('bankCountry'))) errors.push('Заполните данные о доходе и подтверждении.');
  if (step === 4 && (!radioValue('goal') || !specified(get('monthsPerYear')) || !radioValue('languageReadiness') || !get('keepRuCitizenship'))) errors.push('Заполните долгосрочную цель.');
  if (step === 5 && (numberValue('monthlyBudgetUsd') <= 0 || !get('citySize') || !get('pet'))) errors.push('Заполните бюджет и практические условия.');
  const root = $('#formError');
  root.hidden = errors.length === 0;
  root.textContent = errors.join(' ');
  return errors.length === 0;
}

function statusClass(status) {
  if (status === 'SUITABLE') return 'positive';
  if (status === 'SUITABLE_WITH_CONDITIONS' || status === 'PRELIMINARY_SUITABLE') return 'conditional';
  if (status === 'UNSUITABLE') return 'negative';
  return 'review';
}

function statusIcon(status) {
  const icons = {
    SUITABLE: { symbol: '✓', className: 'positive' },
    SUITABLE_WITH_CONDITIONS: { symbol: '!', className: 'conditional' },
    PRELIMINARY_SUITABLE: { symbol: 'i', className: 'conditional information-symbol' },
    UNSUITABLE: { symbol: '×', className: 'negative' },
    INSUFFICIENT_COUNTRY_DATA: { symbol: '?', className: 'insufficient' },
    INDIVIDUAL_REVIEW_REQUIRED: { symbol: 'i', className: 'information' },
  };
  return icons[status] || icons.INSUFFICIENT_COUNTRY_DATA;
}

function unique(items) { return [...new Set((items || []).filter(Boolean))]; }

function userFacingText(value) {
  return String(value ?? '')
    .replaceAll('Маршрута', 'Варианта легализации')
    .replaceAll('Маршруте', 'Варианте легализации')
    .replaceAll('Маршрутом', 'Вариантом легализации')
    .replaceAll('Маршрут', 'Вариант легализации')
    .replaceAll('маршрута', 'варианта легализации')
    .replaceAll('маршруте', 'варианте легализации')
    .replaceAll('маршрутом', 'вариантом легализации')
    .replaceAll('маршрут', 'вариант легализации')
    .replaceAll('переезда', 'иммиграции')
    .replaceAll('переезде', 'иммиграции')
    .replaceAll('переезд', 'иммиграцию');
}

function friendlyWhy(calculation) {
  const route = calculation.bestRoute;
  const items = [];
  if (route.thresholdEur != null && route.incomeEur >= route.thresholdEur) {
    items.push(`Доход после пересчёта — ${currency(route.incomeEur, 'EUR')} в месяц — превышает необходимый доход ${currency(route.thresholdEur, 'EUR')}.`);
  }
  const confirmedChecks = (route.checks || [])
    .filter((check) => check.status === 'SUITABLE' && check.message)
    .map((check) => check.message);
  if (calculation.recommendedCity?.budgetFit === 'MEETS') {
    items.push(`Бюджет ${currency(calculation.profile.monthlyBudgetUsd)} в месяц покрывает рассчитанные расходы в городе ${calculation.recommendedCity.cityName}.`);
  }
  return unique([...items, ...confirmedChecks]).slice(0, 3);
}

function friendlyChecks(calculation) {
  const route = calculation.bestRoute;
  const combined = unique([...route.conditions, ...route.missing, ...route.review, ...route.preliminary, ...calculation.practicalMissing]);
  if (!combined.length) return ['Перед подачей подтвердить актуальный список документов и требования консульства.'];
  return combined.slice(0, 3);
}

function knownFacts(route) {
  const items = [];
  if (route.thresholdEur != null) items.push(`Необходимый доход для семьи: ${currency(route.thresholdEur, 'EUR')} в месяц.`);
  if (route.incomeEur != null) items.push(`Доход после пересчёта: ${currency(route.incomeEur, 'EUR')} в месяц.`);
  return unique([...items, ...route.conditions, ...route.preliminary]).slice(0, 3);
}

function changeRequirements(route) {
  const items = [];
  if (route.thresholdEur != null && route.incomeEur < route.thresholdEur) {
    items.push(`Подтверждаемый доход должен составлять не менее ${currency(route.thresholdEur, 'EUR')} в месяц; сейчас после пересчёта — ${currency(route.incomeEur, 'EUR')}.`);
  }
  return unique([...items, ...route.conditions, ...(items.length || route.conditions?.length ? [] : route.blockers)]).slice(0, 3);
}

function insightCard(title, items, className = '') {
  return `<section class="insight-card ${className}"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(userFacingText(item))}</li>`).join('')}</ul></section>`;
}

function renderRouteTable(routes) {
  return `<details class="details-bar"><summary>⚖ Сравнить все варианты легализации</summary><div class="route-list">${routes.map((route) => `
    <article class="route-row"><div><b>${escapeHtml(route.routeName)}</b><small>${route.thresholdEur == null ? 'Необходимый доход определяется индивидуально' : `Необходимый доход для семьи: ${currency(route.thresholdEur, 'EUR')}/мес`}</small></div><span class="status-pill ${statusClass(route.routeStatus)}">${escapeHtml(route.statusLabel)}</span></article>
  `).join('')}</div></details>`;
}

function renderCities(calculation, isUnsuitable, canRecommend) {
  const cities = calculation.cities.slice(0, 3);
  const title = isUnsuitable ? 'Практическое сравнение городов' : 'Города для жизни';
  const subtitle = isUnsuitable ? 'Эти данные пригодятся, если условия легализации изменятся.' : 'Сравнение бюджета по исследованным городам.';
  return `<div class="section-title-row"><div><h3>${title}</h3><p>${subtitle}</p></div></div><div class="city-grid">${cities.map((city, index) => `
    <article class="city-card ${canRecommend && index === 0 ? 'recommended' : ''}">${canRecommend && index === 0 ? '<span class="recommend-badge">Рекомендуем</span>' : ''}${isUnsuitable && index === 0 ? '<span class="availability-badge">Самый доступный из исследованных городов</span>' : ''}<h4>${escapeHtml(city.cityName)}</h4><p>${escapeHtml(CITY_DESCRIPTIONS[city.cityName] || 'Исследованный город с доступной оценкой бюджета.')}</p><strong>${currency(city.costUsd)}/мес</strong><small>${city.budgetFit === 'MEETS' ? 'Ваш бюджет проходит' : 'Бюджет требует пересмотра'}</small></article>
  `).join('')}</div>`;
}

function sourceAuthority(source) {
  const name = `${source.title} ${source.authority_name}`.toLowerCase();
  if (name.includes('boletín') || name.includes('boe')) return 'BOE';
  if (name.includes('inclusión') || name.includes('migraciones')) return 'Ministerio de Inclusión';
  if (name.includes('tributaria')) return 'Agencia Tributaria';
  if (name.includes('numbeo')) return 'Numbeo';
  return source.authority_name || 'Официальный источник';
}

function renderSources(sources) {
  return `<div class="section-title-row"><div><h3>На чём основан результат</h3><p>Ключевые официальные и исследовательские источники.</p></div></div><div class="source-grid">${sources.slice(0, 5).map((source) => `
    <a class="source-card" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(sourceAuthority(source))}</b><span>${escapeHtml(source.title)}</span></a>
  `).join('')}</div>`;
}

function renderResult(calculation) {
  const route = calculation.bestRoute;
  if (!route) {
    resultRoot.innerHTML = '<div class="loading-state"><b>Расчёт не выполнен</b><p>В данных не найден доступный вариант легализации.</p></div>';
    return;
  }
  const status = route.routeStatus;
  const isUnsuitable = status === 'UNSUITABLE';
  const isPositive = ['SUITABLE', 'SUITABLE_WITH_CONDITIONS', 'PRELIMINARY_SUITABLE'].includes(status);
  const isInsufficient = status === 'INSUFFICIENT_COUNTRY_DATA';
  const isReview = status === 'INDIVIDUAL_REVIEW_REQUIRED';
  const why = friendlyWhy(calculation);
  const icon = statusIcon(route.routeStatus);
  const resultTitles = {
    SUITABLE: 'Испания подходит по вашим условиям',
    SUITABLE_WITH_CONDITIONS: 'Испания подходит с условиями',
    PRELIMINARY_SUITABLE: 'Испания предварительно подходит',
    UNSUITABLE: 'Испания не подходит по текущим условиям',
    INSUFFICIENT_COUNTRY_DATA: 'Для точного результата пока недостаточно данных',
    INDIVIDUAL_REVIEW_REQUIRED: 'Нужна индивидуальная проверка',
  };
  const resultTitle = resultTitles[status] || calculation.country.groupLabel;
  const resultSubtitle = isUnsuitable
    ? 'Ни один из проверенных вариантов легализации сейчас не проходит полностью.'
    : null;
  const variantLabel = isUnsuitable ? 'Наиболее близкий вариант' : 'Подходящий вариант иммиграции';
  const longTermTitle = isUnsuitable ? 'Перспективы при выполнении условий' : 'ПМЖ и гражданство';
  let insightCards = '';
  if (status === 'SUITABLE') {
    insightCards = insightCard('Почему подходит', why, 'good');
  } else if (status === 'SUITABLE_WITH_CONDITIONS') {
    insightCards = `${insightCard('Почему подходит', why, 'good')}${insightCard('Что нужно выполнить', unique([...route.conditions, ...calculation.practicalMissing]), 'warning')}`;
  } else if (status === 'PRELIMINARY_SUITABLE') {
    insightCards = `${insightCard('Почему подходит', why, 'good')}${insightCard('Что ещё нужно подтвердить', unique([...route.preliminary, ...route.missing, ...calculation.practicalMissing]), 'warning')}`;
  } else if (isUnsuitable) {
    insightCards = `${insightCard('Почему не подходит', route.blockers, 'danger')}${insightCard('Что должно измениться', changeRequirements(route), 'warning')}`;
  } else if (isInsufficient) {
    insightCards = `${insightCard('Что уже известно', knownFacts(route), 'known')}${insightCard('Что ещё нужно уточнить', unique([...route.missing, ...calculation.practicalMissing]), 'warning')}`;
  } else if (isReview) {
    insightCards = insightCard('Что требует индивидуальной проверки', unique([...route.review, ...calculation.practicalMissing]), 'information');
  }
  resultRoot.innerHTML = `
    <div class="result-head">
      <div class="result-heading"><span class="result-icon ${icon.className}" aria-hidden="true">${icon.symbol}</span><div><h2>${escapeHtml(resultTitle)}</h2>${resultSubtitle ? `<p class="result-subtitle">${escapeHtml(resultSubtitle)}</p>` : ''}<p>${variantLabel}: <b>${escapeHtml(route.routeName)}</b></p></div></div>
      <span class="status-pill ${statusClass(route.routeStatus)}">${escapeHtml(STATUS_LABELS_RU[route.routeStatus])}</span>
    </div>
    <div class="kpi-grid ${isPositive ? '' : 'three'}">
      <div class="kpi"><span>Доход после пересчёта</span><b>${currency(route.incomeEur, 'EUR')}</b></div>
      <div class="kpi"><span>Необходимый доход</span><b>${route.thresholdEur == null ? 'Индивидуально' : currency(route.thresholdEur, 'EUR')}</b></div>
      <div class="kpi"><span>Состав семьи</span><b>${calculation.profile.adults} ${calculation.profile.adults === 1 ? 'взрослый' : 'взрослых'}</b></div>
      ${isPositive ? `<div class="kpi"><span>Рекомендуемый город</span><b>${escapeHtml(calculation.recommendedCity?.cityName || 'Не выбран')}</b></div>` : ''}
    </div>
    <div class="insight-grid">
      ${insightCards}
      <section class="insight-card"><h3>${longTermTitle}</h3><div class="long-term-list"><div>◇ ПМЖ: через ${escapeHtml(route.longTerm?.years_to_pr ?? '—')} лет</div><div>◎ Гражданство: обычно через ${escapeHtml(route.longTerm?.nominal_years_to_citizenship ?? '—')} лет</div><div>文 Испанский: ${escapeHtml(route.longTerm?.required_language_level || 'требует проверки')}</div></div></section>
    </div>
    ${renderCities(calculation, isUnsuitable, isPositive)}
    ${renderRouteTable(calculation.routes)}
    ${renderSources(calculation.sources)}
    <p class="result-note">Результат является предварительной оценкой и не заменяет проверку документов и актуальных требований перед подачей.</p>
  `;
}

function switchToResult(calculation) {
  lastCalculation = calculation;
  renderResult(calculation);
  renderSummary($('#resultProfileSummary'), calculation.profile, true);
  questionnaireView.hidden = true;
  resultView.hidden = false;
  $('#heroTitle').innerHTML = 'Подходит ли вам Испания?';
  $('#heroSubtitle').textContent = 'Мы сравнили доступные варианты легализации и отдельно оценили бюджет, города, семью и долгосрочные цели.';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchToQuestionnaire() {
  resultView.hidden = true;
  questionnaireView.hidden = false;
  $('#heroTitle').textContent = 'Подберём страну для иммиграции';
  $('#heroSubtitle').textContent = 'Сравним способы получить ВНЖ, требования к доходу, условия для семьи и перспективы ПМЖ или гражданства.';
  showStep(1);
}

function draftData() {
  const profile = readProfile();
  return { version: 1, updatedAt: new Date().toISOString(), profile: { ...profile, legalResidence: profile.legalResidence === null ? '' : profile.legalResidence ? 'YES' : 'NO' } };
}

function restoreDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const draft = stored?.version === 1 && stored?.profile ? stored.profile : null;
    if (!draft) return false;
    setRadioValue('plannedBasis', draft.plannedBasis);
    setRadioValue('goal', draft.goal);
    setRadioValue('languageReadiness', draft.languageReadiness);
    ['currentLocation','monthlyIncomeUsd','bankCountry','relationshipType','monthsPerYear','keepRuCitizenship','monthlyBudgetUsd','citySize','pet','dogBreed'].forEach((id) => { if (draft[id] != null && $(`#${id}`)) $(`#${id}`).value = draft[id]; });
    $('#legalResidence').value = draft.legalResidence === true ? 'YES' : draft.legalResidence === false ? 'NO' : draft.legalResidence;
    ['sameSexFamily','needsFamilyVisa','schoolNeeded','medicineRequired'].forEach((id) => { if (draft[id] != null) $(`#${id}`).checked = Boolean(draft[id]); });
    setStepper('adults', draft.adults);
    setStepper('children', draft.children);
    syncConditionalFields();
    return true;
  } catch { localStorage.removeItem(STORAGE_KEY); }
  return false;
}

function persistDraft() {
  if (hasMeaningfulFormData()) localStorage.setItem(STORAGE_KEY, JSON.stringify(draftData()));
}

function clearQuestionnaire() {
  localStorage.removeItem(STORAGE_KEY);
  form.reset();
  setStepper('adults', null);
  setStepper('children', null);
  lastCalculation = null;
  $('#formError').hidden = true;
  syncConditionalFields();
  updateProfileSummary();
  updateActionAvailability();
  showStep(1, false);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function setStepper(id, value) {
  if (!specified(value)) {
    $(`#${id}`).value = '';
    $(`#${id}Output`).textContent = '—';
    return;
  }
  const limits = id === 'adults' ? [1, 2] : [0, 3];
  const safe = Math.max(limits[0], Math.min(limits[1], Number(value)));
  $(`#${id}`).value = String(safe);
  $(`#${id}Output`).textContent = String(safe);
}

function syncConditionalFields() {
  $('#relationshipBlock').hidden = Number(get('adults')) < 2;
  $('#dogBreedField').hidden = get('pet') !== 'DOG';
}

async function init() {
  restoreDraft();
  syncConditionalFields();
  updateProfileSummary();
  showStep(1, false);
  try {
    const response = await fetch('../data/spain-research-v2.2.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    spainData = await response.json();
    calculationContext = await loadCalculationContext();
    updateActionAvailability();
  } catch (error) {
    $('#formError').hidden = false;
    $('#formError').dataset.code = error.code || 'DATA_LOAD_FAILED';
    $('#formError').textContent = error.code === 'CALCULATION_CONTEXT_INCOMPLETE'
      ? 'Расчёт временно недоступен: не удалось получить актуальный системный курс валют. Попробуйте позже.'
      : `Не удалось загрузить данные Испании: ${error.message}`;
  }
}

nextButton.addEventListener('click', () => { if (validateStep(currentStep)) { showStep(currentStep + 1); updateProfileSummary(); } });
prevButton.addEventListener('click', () => showStep(currentStep - 1));
form.addEventListener('input', () => { syncConditionalFields(); updateProfileSummary(); updateActionAvailability(); persistDraft(); });
form.addEventListener('change', () => { syncConditionalFields(); updateProfileSummary(); updateActionAvailability(); persistDraft(); });
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!spainData || !calculationContext || !validateStep(currentStep)) return;
  try { switchToResult(calculateSpain(readProfile(), spainData, calculationContext)); }
  catch (error) { $('#formError').hidden = false; $('#formError').textContent = `Ошибка расчёта: ${error.message}`; }
});

$$('[data-stepper]').forEach((stepper) => stepper.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const id = stepper.dataset.stepper;
  const delta = button.dataset.action === 'plus' ? 1 : -1;
  const current = specified(get(id)) ? Number(get(id)) : (id === 'adults' ? 0 : delta < 0 ? 1 : 0);
  setStepper(id, current + delta);
  syncConditionalFields();
  updateProfileSummary();
  updateActionAvailability();
  persistDraft();
}));

$('#saveDraft').addEventListener('click', () => { if (hasMeaningfulFormData()) { localStorage.setItem(STORAGE_KEY, JSON.stringify(draftData())); showToast('Анкета сохранена в этом браузере'); } else showToast('Сначала заполните хотя бы одно поле'); });
$('#clearDraft').addEventListener('click', () => { clearQuestionnaire(); showToast('Анкета очищена'); });
$('#saveResult').addEventListener('click', () => { if (lastCalculation) { localStorage.setItem(RESULT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), profile: readProfile(), calculation: lastCalculation })); showToast('Результат сохранён в этом браузере'); } });
$('#editProfile').addEventListener('click', switchToQuestionnaire);

init();
