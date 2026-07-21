import { STATUS_LABELS_RU } from '../js/spain-calculator.js';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { spainAdapter } from '../js/countries/spain-adapter.js';
import { loadCalculationContext } from '../pilot/fx-context.js';
import { countryOptions, parseCountryCode, searchCountries } from './countries.js';
import { buildUserProfile, describeIncomeRequirement, describeResultIntro, sortRoutesForDisplay, validateAgainstSchema, validateUserProfile } from './profile.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $('#matcherForm');
const steps = $$('.wizard-step');
const TOTAL_STEPS = steps.length;
const DRAFT_KEY = 'immigration-matcher-universal-draft-v1';
let currentStep = 1;
let spainData;
let uruguayData;
let calculationContext;
let currentProfile;
let profileSchema;

const value = (id) => $(`#${id}`)?.value ?? '';
const checked = (id) => Boolean($(`#${id}`)?.checked);
const radio = (name) => $(`input[name="${name}"]:checked`)?.value || '';
const checkboxValues = (name) => $$(`input[name="${name}"]:checked`).map((input) => input.value);
const html = (text) => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const currency = (amount, code = 'USD') => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(Number(amount || 0));

const INCOME_FIELDS = (prefix, title) => `<h3>${title}</h3><div class="field-grid two-col">
  <label class="field"><span>Тип дохода</span><select id="${prefix}Type"><option value="">Не выбрано</option><option value="REMOTE_EMPLOYMENT">Удалённая работа по трудовому договору</option><option value="CONTRACTOR">Контракт с заказчиком (без трудовых отношений)</option><option value="FREELANCE_OR_SELF_EMPLOYED">Фриланс или самозанятость</option><option value="SOLE_PROPRIETOR">ИП</option><option value="COMPANY_OWNER">Владелец компании</option><option value="PASSIVE_INCOME">Пассивный доход</option><option value="OTHER_REGULAR_REMOTE_INCOME">Другой регулярный доход</option></select></label>
  <label id="${prefix}SourceCountryField" class="field"><span>Страна работодателя или источника</span><input id="${prefix}SourceCountry" list="countryOptions" placeholder="Начните вводить название"><small>Для фриланса без одного постоянного заказчика можно не указывать.</small></label>
  <label class="field"><span>Страна банка</span><input id="${prefix}BankCountry" list="countryOptions" placeholder="Начните вводить название"><small>Используется для проверки пригодности выписок, а не для выбора маршрута.</small></label>
  <label class="field"><span>Сколько можете подтвердить в месяц?</span><div class="money-combo"><input id="${prefix}Amount" type="number" min="0"><select id="${prefix}Currency"><option>USD</option><option>EUR</option><option>RUB</option></select></div></label>
  <label class="field"><span>Какими документами подтверждается доход?</span><select id="${prefix}Evidence"><option value="">Не выбрано</option><option value="FULL">Полностью: договор и движение денег</option><option value="PARTIAL">Частично</option><option value="NONE">Пока нет документов</option></select></label>
</div>`;

$('#additionalIncomeBlock').innerHTML = INCOME_FIELDS('additional', 'Дополнительный доход заявителя');
$('#partnerIncomeBlock').innerHTML = INCOME_FIELDS('partner', 'Доход партнёра');
$('#countryOptions').innerHTML = countryOptions().map(({ label }) => `<option value="${html(label)}"></option>`).join('');

function enhanceCountrySearch(input) {
  if (input.dataset.searchReady) return;
  input.dataset.searchReady = 'true';
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');
  const menu = document.createElement('div');
  menu.className = 'country-search-results';
  menu.hidden = true;
  input.insertAdjacentElement('afterend', menu);
  const render = () => {
    const matches = searchCountries(input.value);
    menu.replaceChildren(...matches.map((country) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = country.label;
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        input.value = country.label;
        menu.hidden = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return button;
    }));
    menu.hidden = matches.length === 0;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { menu.hidden = true; }, 100));
}

$$('input[list="countryOptions"]').forEach(enhanceCountrySearch);

function collectAnswers() {
  const childAges = $$('#childAges input').map((input) => input.value);
  const inRussia = radio('inRussia') === 'YES';
  const returning = radio('returnToRussia') === 'YES';
  const applicationMethods = inRussia ? ['RUSSIA'] : returning ? ['ANY'] : ['CURRENT_COUNTRY', 'IN_COUNTRY_AFTER_ENTRY'];
  return {
    inRussia, returnToRussia: returning, currentCountry: inRussia ? 'RU' : value('currentCountry'), currentStatus: inRussia ? 'CITIZENSHIP' : value('currentStatus'), applicationMethods,
    hasPartner: radio('partnerIncluded') === 'YES', partnerIncluded: radio('partnerIncluded') === 'YES', relationshipType: value('relationshipType'), lgbtEnabled: checked('lgbtEnabled'),
    childAges: radio('hasChildren') === 'YES' ? childAges : [], schoolNeeded: radio('schoolType') === 'INTERNATIONAL', schoolType: radio('schoolType'), kindergartenNeeded: radio('kindergartenNeeded') === 'YES',
    primaryType: value('primaryType'), primarySourceCountry: value('primarySourceCountry'), primaryBankCountry: value('primaryBankCountry'), primaryAmount: value('primaryAmount'), primaryCurrency: value('primaryCurrency'), primaryEvidence: value('primaryEvidence'),
    hasAdditionalIncome: checked('hasAdditionalIncome'), additionalType: value('additionalType'), additionalSourceCountry: value('additionalSourceCountry'), additionalBankCountry: value('additionalBankCountry'), additionalAmount: value('additionalAmount'), additionalCurrency: value('additionalCurrency'), additionalEvidence: value('additionalEvidence'),
    partnerHasIncome: checked('partnerHasIncome'), partnerType: value('partnerType'), partnerSourceCountry: value('partnerSourceCountry'), partnerBankCountry: value('partnerBankCountry'), partnerAmount: value('partnerAmount'), partnerCurrency: value('partnerCurrency'), partnerEvidence: value('partnerEvidence'),
    longTermGoal: value('longTermGoal'), physicalPresence: 'DEPENDS_ON_COUNTRY', languageExamReadiness: 'DEPENDS_ON_LANGUAGE', keepRuCitizenship: value('longTermGoal') === 'TEMPORARY_RESIDENCE_SUFFICIENT' ? 'NOT_IMPORTANT' : (radio('keepRuCitizenship') || 'NOT_IMPORTANT'),
    budgetUnknown: checked('budgetUnknown'), monthlyBudget: value('monthlyBudget'), budgetCurrency: value('budgetCurrency'),
    petTypes: radio('hasPets') === 'NO' ? ['NONE'] : radio('petType') ? [radio('petType')] : [], dogBreedChoice: value('dogBreed'), dogBreed: value('dogBreed') === 'OTHER_KNOWN' ? value('dogBreedName') : value('dogBreed'), otherPetNotes: radio('petType') === 'CAT' ? `HYBRID_CAT:${radio('hybridCat') || 'UNKNOWN'}` : null,
    specialCircumstances: ['NONE'], medicalEnabled: false, specificMedicineRequired: false, regularCareRequired: false, medicalDetails: '',
    routeSpecificAnswers: currentProfile?.route_specific_answers || {},
  };
}

function profile() { return buildUserProfile(collectAnswers()); }

function syncChildren() {
  const hasChildren = radio('hasChildren') === 'YES';
  const count = hasChildren ? Number(value('childrenCount') || 0) : 0;
  const existing = $$('#childAges input').map((input) => input.value);
  $('#childrenQuestionBlock').hidden = !hasChildren;
  $('#educationBlock').hidden = !hasChildren;
  $('#childAges').innerHTML = Array.from({ length: count }, (_, index) => `<label class="field"><span>Возраст ребёнка ${index + 1}</span><input data-child-age type="number" min="0" max="25" value="${html(existing[index] || '')}" placeholder="Лет"></label>`).join('');
}

function syncConditional() {
  const inRussia = radio('inRussia') === 'YES';
  const partner = radio('partnerIncluded') === 'YES';
  $('#outsideRussiaBlock').hidden = inRussia || !radio('inRussia');
  $('#partnerBlock').hidden = !partner;
  $('#partnerIncomeQuestion').hidden = !partner;
  $('#partnerIncomeBlock').hidden = !partner || !checked('partnerHasIncome');
  $('#additionalIncomeBlock').hidden = !checked('hasAdditionalIncome');
  $('#citizenshipRetentionBlock').hidden = !value('longTermGoal') || value('longTermGoal') === 'TEMPORARY_RESIDENCE_SUFFICIENT';
  const hasPets = radio('hasPets') === 'YES';
  const pet = hasPets ? radio('petType') : '';
  $('#petTypeBlock').hidden = !hasPets;
  $('#dogBlock').hidden = pet !== 'DOG';
  $('#dogBreedNameBlock').hidden = pet !== 'DOG' || value('dogBreed') !== 'OTHER_KNOWN';
  $('#catBlock').hidden = pet !== 'CAT';
  for (const prefix of ['primary', 'additional', 'partner']) {
    const freelance = value(`${prefix}Type`) === 'FREELANCE_OR_SELF_EMPLOYED';
    const sourceField = $(`#${prefix}SourceCountryField`);
    if (sourceField) sourceField.hidden = freelance;
  }
  $('#monthlyBudget').disabled = checked('budgetUnknown');
}

function fieldError(ids, message) {
  const key = ids[0];
  const first = ids.map((id) => $(`#${id}`) || $(`[name="${id}"]`)).find(Boolean);
  return { first, key, message };
}

function clearInlineErrors() {
  $$('.inline-field-error').forEach((node) => node.remove());
  $$('.has-field-error').forEach((node) => node.classList.remove('has-field-error'));
}

function showInlineError(error) {
  clearInlineErrors();
  const control = error?.first;
  if (!control) return;
  const container = control.closest('fieldset, label.field, .conditional-card') || control.parentElement;
  container.classList.add('has-field-error');
  const message = document.createElement('p');
  message.className = 'inline-field-error';
  message.setAttribute('role', 'alert');
  message.textContent = error.message;
  container.append(message);
  control.focus();
  message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function validateStep(step) {
  let error;
  if (step === 1 && !radio('inRussia')) error = fieldError(['inRussia'], 'Ответьте, находитесь ли вы сейчас в России.');
  else if (step === 1 && radio('inRussia') === 'NO' && !parseCountryCode(value('currentCountry'))) error = fieldError(['currentCountry'], 'Укажите страну, где вы сейчас находитесь.');
  else if (step === 1 && radio('inRussia') === 'NO' && !value('currentStatus')) error = fieldError(['currentStatus'], 'Укажите ваш легальный статус в этой стране.');
  else if (step === 1 && radio('inRussia') === 'NO' && !radio('returnToRussia')) error = fieldError(['returnToRussia'], 'Ответьте, готовы ли вы вернуться в Россию для подачи.');
  if (step === 2) {
    if (!radio('partnerIncluded')) error = fieldError(['partnerIncluded'], 'Ответьте, переезжаете ли вы с партнёром.');
    else if (radio('partnerIncluded') === 'YES' && !value('relationshipType')) error = fieldError(['relationshipType'], 'Укажите, как оформлены отношения.');
    else if (!radio('hasChildren')) error = fieldError(['hasChildren'], 'Ответьте, переезжаете ли вы с детьми.');
    else if (radio('hasChildren') === 'YES' && (!Number.isInteger(Number(value('childrenCount'))) || Number(value('childrenCount')) < 1 || Number(value('childrenCount')) > 12)) error = fieldError(['childrenCount'], 'Укажите количество детей от 1 до 12.');
    else if ($$('#childAges input').some((input) => input.value === '' || Number(input.value) < 0 || Number(input.value) > 25)) error = fieldError(['childAges'], 'Укажите возраст каждого ребёнка от 0 до 25 лет.');
    else if (!radio('hasPets')) error = fieldError(['hasPets'], 'Ответьте, переезжают ли с вами домашние животные.');
    else if (radio('hasPets') === 'YES' && !radio('petType')) error = fieldError(['petType'], 'Выберите вид животного.');
    else if (radio('petType') === 'DOG' && !value('dogBreed')) error = fieldError(['dogBreed'], 'Выберите вариант породы собаки.');
    else if (radio('petType') === 'DOG' && value('dogBreed') === 'OTHER_KNOWN' && !value('dogBreedName').trim()) error = fieldError(['dogBreedName'], 'Укажите породу собаки.');
    else if (radio('petType') === 'CAT' && !radio('hybridCat')) error = fieldError(['hybridCat'], 'Ответьте, является ли кошка гибридной породой.');
  }
  const incomeError = (prefix) => !value(`${prefix}Type`) ? fieldError([`${prefix}Type`], 'Укажите тип дохода.') : value(`${prefix}Type`) !== 'FREELANCE_OR_SELF_EMPLOYED' && !parseCountryCode(value(`${prefix}SourceCountry`)) ? fieldError([`${prefix}SourceCountry`], 'Укажите страну источника дохода.') : !parseCountryCode(value(`${prefix}BankCountry`)) ? fieldError([`${prefix}BankCountry`], 'Укажите страну банковского счёта.') : Number(value(`${prefix}Amount`)) <= 0 ? fieldError([`${prefix}Amount`], 'Укажите сумму, которую можете подтвердить.') : !value(`${prefix}Evidence`) ? fieldError([`${prefix}Evidence`], 'Укажите, какими документами подтверждается доход.') : null;
  if (step === 3) error = incomeError('primary') || (checked('hasAdditionalIncome') ? incomeError('additional') : null) || (radio('partnerIncluded') === 'YES' && checked('partnerHasIncome') ? incomeError('partner') : null);
  if (step === 4 && !value('longTermGoal')) error = fieldError(['longTermGoal'], 'Выберите долгосрочную цель.');
  else if (step === 4 && value('longTermGoal') !== 'TEMPORARY_RESIDENCE_SUFFICIENT' && !radio('keepRuCitizenship')) error = fieldError(['keepRuCitizenship'], 'Укажите, обязательно ли сохранить гражданство РФ.');
  if (step === 5 && !checked('budgetUnknown') && Number(value('monthlyBudget')) <= 0) error = fieldError(['monthlyBudget'], 'Укажите комфортный бюджет или выберите «Пока не знаю».');
  else if (step === 5 && radio('hasChildren') === 'YES' && !radio('schoolType')) error = fieldError(['schoolType'], 'Выберите планируемый тип школы или вариант «Не нужна».');
  else if (step === 5 && radio('hasChildren') === 'YES' && !radio('kindergartenNeeded')) error = fieldError(['kindergartenNeeded'], 'Ответьте, нужен ли детский сад.');
  const root = $('#formError');
  root.hidden = true;
  root.textContent = '';
  if (error) showInlineError(error); else clearInlineErrors();
  return !error;
}

function showStep(step, scroll = true) {
  currentStep = Math.max(1, Math.min(TOTAL_STEPS, step));
  steps.forEach((section, index) => { section.hidden = index + 1 !== currentStep; section.classList.toggle('is-active', index + 1 === currentStep); });
  $('#stepLabel').textContent = `Шаг ${currentStep} из ${TOTAL_STEPS}`;
  $('#progressBar').style.width = `${currentStep / TOTAL_STEPS * 100}%`;
  $('#prevStep').hidden = currentStep === 1;
  $('#nextStep').hidden = currentStep === TOTAL_STEPS;
  $('#calculate').hidden = currentStep !== TOTAL_STEPS;
  $('#formError').hidden = true;
  clearInlineErrors();
  renderProfileSummary(profile());
  if (scroll) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function familyLabel(p, allowPending = false) {
  if (allowPending && (!radio('partnerIncluded') || !radio('hasChildren'))) return 'Не указан';
  const adults = `${p.family.adults_count} ${p.family.adults_count === 1 ? 'взрослый' : 'взрослых'}`;
  const children = p.family.children.length;
  return children ? `${adults}, ${children} ${children === 1 ? 'ребёнок' : 'детей'}` : adults;
}

function renderProfileSummary(p) {
  const rows = [
    ['Гражданство', 'РФ'], ['Семья', familyLabel(p, true)],
    ['Доход', p.income.primary.monthly_provable?.amount ? `${p.income.primary.monthly_provable.amount} ${p.income.primary.monthly_provable.currency}/мес` : 'Не указан'],
    ['Цель', value('longTermGoal') ? $('#longTermGoal').selectedOptions[0].textContent : 'Не указана'],
    ['Семейный бюджет', p.preferences.monthly_budget ? `${p.preferences.monthly_budget.amount} ${p.preferences.monthly_budget.currency}/мес` : checked('budgetUnknown') ? 'Пока не определён' : 'Не указан'],
  ];
  $('#profileSummary').innerHTML = rows.map(([label, val]) => `<div class="summary-row"><span>${html(label)}</span><b>${html(val)}</b></div>`).join('');
}

function statusClass(status) { return status === 'SUITABLE' ? 'positive' : status === 'UNSUITABLE' ? 'negative' : 'conditional'; }

const LGBT_TOPIC_LABELS = {
  SAME_SEX_MARRIAGE: 'Брак и семейная иммиграция', MARRIAGE: 'Брак и семейная иммиграция',
  UNREGISTERED_PARTNER: 'Незарегистрированный партнёр', PARENTHOOD_AND_CHILDREN: 'Дети и родительство',
  ANTI_DISCRIMINATION: 'Защита от дискриминации', GENDER_IDENTITY: 'Права транс-людей',
  HATE_CRIME: 'Преступления ненависти', CONVERSION_PRACTICES: 'Конверсионные практики',
  PRACTICAL_SAFETY: 'Практическая безопасность',
};

function renderLgbtResearch(calculation) {
  if (!calculation.lgbt?.rules?.length) return '';
  return `<section class="lgbt-research"><div class="section-title-row"><div><h3>ЛГБТ: право и реальная жизнь</h3><p>Законы, признание семьи и практическая безопасность оцениваются отдельно.</p></div></div><div class="lgbt-grid">${calculation.lgbt.rules.map((rule) => `<article class="research-card"><h4>${html(LGBT_TOPIC_LABELS[rule.topic] || rule.topic)}</h4><p>${html(rule.notes || 'Описание подтверждённого правила отсутствует.')}</p>${rule.source?.url ? `<a href="${html(rule.source.url)}" target="_blank" rel="noopener">Источник: ${html(rule.source.title || rule.source.authority_name || 'документ')}</a>` : '<span class="research-gap">Источник не приложен</span>'}</article>`).join('')}</div><p class="research-caveat">Важно: высокий уровень правовой защиты не означает отсутствие дискриминации или насилия. Общенациональная статистика не позволяет честно ранжировать отдельные города без сопоставимых городских данных.</p></section>`;
}

function longTermConditions(route) {
  if (!route.longTerm || ['TEMPORARY_RESIDENCE_SUFFICIENT', 'UNDECIDED'].includes(currentProfile?.goal?.long_term)) return '';
  const rule = route.longTerm;
  const items = [];
  const languageNames = { es: 'испанский', en: 'английский', pt: 'португальский', fr: 'французский', de: 'немецкий' };
  const levelNames = { FUNCTIONAL: 'разговорный уровень', A2: 'уровень A2', B1: 'уровень B1', B2: 'уровень B2' };
  if (rule.language_exam_required === 'YES') items.push(`Язык: требуется ${languageNames[rule.required_language] || rule.required_language || 'местный язык'}${rule.required_language_level ? `, ${levelNames[rule.required_language_level] || `уровень ${rule.required_language_level}`}` : ''}.`);
  else if (rule.language_exam_required === 'UNKNOWN') items.push('Язык: точное требование нужно подтвердить перед выбором долгосрочной стратегии.');
  if (rule.notes) items.push(rule.notes);
  else items.push('Срок фактического проживания и допустимые выезды нужно проверить для выбранной долгосрочной цели.');
  return `<div class="route-client-items"><h4>Условия ПМЖ или гражданства</h4><ul>${items.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>`;
}

function routeCard(route, countryName, main = false) {
  const unsuitable = route.routeStatus === 'UNSUITABLE';
  const incomeTypeBlocked = route.incomeTypeFit === 'DOES_NOT_MEET';
  const requirement = describeIncomeRequirement(route, currency);
  const visibleBlockers = (route.blockers || []).filter((item) => !incomeTypeBlocked || !item.includes('Тип дохода несовместим'));
  const reasons = [...(incomeTypeBlocked ? [requirement] : []), ...visibleBlockers];
  const reasonsBlock = reasons.length ? `<div class="route-reasons"><h4>${reasons.length > 1 ? 'Почему не подходит — несколько независимых причин' : 'Почему не подходит'}</h4><ul>${reasons.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const countryMissing = route.countryMissing || route.missing || [];
  const missingBlock = !unsuitable && countryMissing.length ? `<div class="route-open-items"><h4>Что ещё не подтверждено для этого варианта</h4><ul>${countryMissing.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const clientMissing = (route.clientMissing || route.preliminary || []).filter((item) => !route.actions?.includes(item));
  const clientMissingBlock = !unsuitable && clientMissing.length ? `<div class="route-client-items"><h4>Что потребуется для этого маршрута</h4><ul>${clientMissing.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const actionsBlock = route.actions?.length ? `<div class="route-actions"><h4>Что сделать, чтобы маршрут подходил</h4><ol>${route.actions.map((item) => `<li>${html(item)}</li>`).join('')}</ol></div>` : '';
  const permitRequirementsBlock = route.initialPermitRequirements?.length ? `<div class="route-requirements"><h4>Обязательные документы и действия для первоначального ВНЖ</h4><ul>${route.initialPermitRequirements.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const sourceBlock = route.primarySource?.url ? `<p class="route-source"><a href="${html(route.primarySource.url)}" target="_blank" rel="noopener">Официальные требования: ${html(route.primarySource.title || route.routeName)}</a></p>` : '';
  const applicationBlock = route.applicationGuidance ? `<div class="route-requirements"><h4>Где и как подаваться</h4><p>${html(route.applicationGuidance)}</p></div>` : '';
  const exampleSourceBlock = route.incomeGuidance && route.incomeExampleSource?.url ? `<p class="route-source"><a href="${html(route.incomeExampleSource.url)}" target="_blank" rel="noopener">Неофициальный личный опыт о принятой сумме</a></p>` : '';
  const finance = incomeTypeBlocked || route.incomeTypeFit === 'NOT_APPLICABLE' ? '' : `<p class="financial-rule">${html(requirement)}</p>`;
  return `<article class="route-result ${main ? 'best' : ''}"><div><span class="status-pill ${statusClass(route.routeStatus)}">${html(STATUS_LABELS_RU[route.routeStatus])}</span><h3>${html(route.routeName)}</h3></div>${finance}${applicationBlock}${reasonsBlock}${actionsBlock}${permitRequirementsBlock}${missingBlock}${clientMissingBlock}${sourceBlock}${exampleSourceBlock}${unsuitable ? '' : longTermConditions(route)}</article>`;
}

function renderCountryResult(calculation, changed = false) {
  const sortedRoutes = sortRoutesForDisplay(calculation.routes);
  const best = sortedRoutes[0] || calculation.bestRoute;
  const children = calculation.profile.children?.length || 0;
  const family = `${calculation.profile.adults} ${calculation.profile.adults === 1 ? 'взрослый' : 'взрослых'}${children ? `, ${children} ${children === 1 ? 'ребёнок' : 'детей'}` : ''}`;
  const { heading: resultHeading, routeLabel } = describeResultIntro(calculation.routes, changed);
  const countryName = calculation.country.name;
  const countryId = calculation.country.countryId;
  const flag = countryId === 'ES' ? '🇪🇸' : countryId === 'UY' ? '🇺🇾' : '🌍';
  const thresholdLabel = best?.incomeTypeFit === 'DOES_NOT_MEET' ? 'Финансовый порог' : 'Необходимый доход';
  const thresholdValue = best?.incomeTypeFit === 'DOES_NOT_MEET' ? 'Не оценивается: тип дохода не подходит' : best?.thresholdEur == null ? 'Нужен расчёт по документам' : currency(best.thresholdEur, 'EUR');
  const otherPetWarning = currentProfile?.pets?.types?.includes('OTHER') ? '<div class="route-open-items practical-warning"><h4>Нужна отдельная проверка животного</h4><p>У вас указано другое животное. Правила его ввоза зависят от конкретного вида и страны происхождения. Перед переездом потребуется отдельная проверка правил для этой страны.</p></div>' : '';
  const incomeAmount = countryId === 'ES' ? best?.incomeEur : best?.incomeUsd;
  const incomeCurrency = countryId === 'ES' ? 'EUR' : 'USD';
  const citySizeLabels = { LARGE: 'Крупный город', MEDIUM: 'Средний город', SMALL: 'Небольшой город' };
  const cityBudgets = ['LARGE', 'MEDIUM', 'SMALL'].map((size) => calculation.cities.find((city) => city.populationCategory === size)).filter(Boolean);
  const climateCities = cityBudgets.filter((city) => city.avgTempColdestMonthC != null && city.avgTempHottestMonthC != null);
  return `<details class="country-comparison"><summary class="country-result-banner" data-country-id="${html(countryId)}"><span class="country-flag" aria-hidden="true">${flag}</span><div class="country-summary-text"><small>Страна расчёта</small><h2>${html(countryName)}</h2><p>${routeLabel}: <b>${html(best?.routeName || 'не определён')}</b></p></div><span class="status-pill ${statusClass(best?.routeStatus)}">${html(STATUS_LABELS_RU[best?.routeStatus] || 'Требует проверки')}</span><span class="country-toggle" aria-hidden="true">⌄</span></summary><div class="country-comparison-body"><div class="result-head"><div><h2>${resultHeading}</h2><p>Все варианты ниже относятся только к стране «${html(countryName)}».</p></div></div>
    <div class="kpi-grid three"><div class="kpi"><span>Состав семьи</span><b>${html(family)}</b></div><div class="kpi"><span>Подтверждаемый доход после пересчёта</span><b>${incomeAmount == null ? 'Не рассчитан' : currency(incomeAmount, incomeCurrency)}</b></div><div class="kpi"><span>${thresholdLabel}</span><b>${thresholdValue}</b></div></div>${otherPetWarning}
    <section><div class="section-title-row"><div><h3>Все проверенные варианты</h3><p>Сначала показаны подходящие, затем предварительно подходящие и требующие проверки, в конце — неподходящие.</p></div></div><div class="alternative-routes">${sortedRoutes.map((route) => routeCard(route, countryName, route.routeId === best?.routeId)).join('')}</div></section>
    <section><div class="section-title-row"><div><h3>Практический семейный бюджет</h3><p>Три ориентира для вашего состава семьи. Школа и детский сад в суммы не включены.</p></div></div>${cityBudgets.length ? `<div class="city-budget-grid">${cityBudgets.map((city) => `<div class="city-card"><small>${html(citySizeLabels[city.populationCategory])}</small><h4>${html(city.cityName)}</h4><strong>${currency(city.costUsd)}/мес</strong></div>`).join('')}</div>` : '<p>Для этой страны пока нет модели стоимости жизни.</p>'}</section>
    <section><div class="section-title-row"><div><h3>Климат: конкретные температуры</h3><p>Средняя температура самого холодного и самого жаркого месяца — это не дневной минимум и максимум.</p></div></div>${climateCities.length ? `<div class="city-budget-grid climate-grid">${climateCities.map((city) => `<div class="city-card"><small>${html(citySizeLabels[city.populationCategory])}</small><h4>${html(city.cityName)}</h4><span>Холодный месяц: <b>${html(city.avgTempColdestMonthC)} °C</b></span><span>Жаркий месяц: <b>${html(city.avgTempHottestMonthC)} °C</b></span>${city.climateSource?.url ? `<a href="${html(city.climateSource.url)}" target="_blank" rel="noopener">Источник температур</a>` : ''}</div>`).join('')}</div>` : '<p>Точные городские температуры ещё не исследованы.</p>'}</section>
    ${renderLgbtResearch(calculation)}
    <p class="result-note">Юридические правила маршрутов проверены по указанным источникам. Стоимость жизни — ориентировочная практическая оценка. Расчёт: ${html(calculation.calculatedAt?.slice(0, 10))}. Курс валют: ${html(calculationContext.fx.as_of?.slice(0, 10))}, источник ${html(calculationContext.fx.source)}. Результат предварительный и не является юридическим обещанием.</p></div></details>`;
}

function calculateAllCountries() {
  return calculateCountries(currentProfile, [spainData, uruguayData], calculationContext, () => spainAdapter);
}

function renderResult(calculation, changed = false) {
  $('#result').innerHTML = `<div class="comparison-intro"><h2>Сравнение стран</h2><p>Одна анкета независимо проверена для каждой доступной страны.</p></div>${calculation.results.map((country) => renderCountryResult(country, changed)).join('')}`;
}

function switchToResult(calculation, changed = false) {
  renderResult(calculation, changed);
  $('#questionnaireView').hidden = true;
  $('#resultView').hidden = false;
  $('#heroTitle').textContent = 'Ваш результат';
  $('#heroSubtitle').textContent = 'Мы независимо проверили доступные страны и отдельно оценили семейные условия.';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600); }

function draft() { return { version: 1, savedAt: new Date().toISOString(), answers: collectAnswers() }; }

function setRadio(name, val) { const input = $(`input[name="${name}"][value="${CSS.escape(String(val))}"]`); if (input) input.checked = true; }
function setCheckboxes(name, values = []) { $$(`input[name="${name}"]`).forEach((input) => { input.checked = values.includes(input.value); }); }

function restoreDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (stored?.version !== 1 || !stored.answers) return false;
    const a = stored.answers;
    const simple = ['currentCountry','currentStatus','relationshipType','primaryType','primarySourceCountry','primaryBankCountry','primaryAmount','primaryCurrency','primaryEvidence','additionalType','additionalSourceCountry','additionalBankCountry','additionalAmount','additionalCurrency','additionalEvidence','partnerType','partnerSourceCountry','partnerBankCountry','partnerAmount','partnerCurrency','partnerEvidence','longTermGoal','monthlyBudget','budgetCurrency'];
    simple.forEach((id) => { if ($(`#${id}`) && a[id] != null) $(`#${id}`).value = a[id]; });
    if (a.dogBreed) { $('#dogBreed').value = a.dogBreedChoice || (['MIXED', 'UNKNOWN'].includes(a.dogBreed) ? a.dogBreed : 'OTHER_KNOWN'); $('#dogBreedName').value = $('#dogBreed').value === 'OTHER_KNOWN' ? a.dogBreed : ''; }
    setRadio('inRussia', a.inRussia || parseCountryCode(a.currentCountry) === 'RU' ? 'YES' : 'NO'); setRadio('returnToRussia', a.returnToRussia ? 'YES' : 'NO'); setRadio('partnerIncluded', a.partnerIncluded ? 'YES' : 'NO'); setRadio('hasChildren', a.childAges?.length ? 'YES' : 'NO'); setRadio('hasPets', a.petTypes?.[0] && a.petTypes[0] !== 'NONE' ? 'YES' : 'NO'); setRadio('petType', a.petTypes?.[0]); setRadio('hybridCat', a.otherPetNotes?.startsWith('HYBRID_CAT:') ? a.otherPetNotes.split(':')[1] : ''); setRadio('keepRuCitizenship', a.keepRuCitizenship); setRadio('schoolType', a.schoolType); setRadio('kindergartenNeeded', a.kindergartenNeeded ? 'YES' : 'NO');
    ['lgbtEnabled','hasAdditionalIncome','partnerHasIncome','budgetUnknown'].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).checked = Boolean(a[id]); });
    $('#childrenCount').value = a.childAges?.length ? String(a.childAges.length) : ''; syncChildren(); $$('#childAges input').forEach((input, index) => { input.value = a.childAges[index] ?? ''; });
    currentProfile = a.routeSpecificAnswers ? { route_specific_answers: a.routeSpecificAnswers } : null;
    syncConditional(); return true;
  } catch { localStorage.removeItem(DRAFT_KEY); return false; }
}

function clearAll() { localStorage.removeItem(DRAFT_KEY); form.reset(); $('#childAges').innerHTML = ''; currentProfile = null; syncChildren(); syncConditional(); showStep(1, false); showToast('Анкета очищена'); }

$('#gateYes').addEventListener('click', () => { $('#citizenshipGate').hidden = true; $('#questionnaireView').hidden = false; showStep(1); });
$('#gateNo').addEventListener('click', () => { $('#gateNotice').hidden = false; $('#gateNotice').focus(); });
$('#nextStep').addEventListener('click', () => { if (validateStep(currentStep)) showStep(currentStep + 1); });
$('#prevStep').addEventListener('click', () => showStep(currentStep - 1));
$('#childrenCount').addEventListener('input', () => { syncChildren(); renderProfileSummary(profile()); });
form.addEventListener('change', (event) => { if (event.target?.name === 'hasChildren') syncChildren(); syncConditional(); renderProfileSummary(profile()); });
form.addEventListener('input', () => renderProfileSummary(profile()));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validateStep(currentStep) || !spainData || !uruguayData || !calculationContext) return;
  currentProfile = profile();
  const validation = validateUserProfile(currentProfile);
  if (!validation.valid) { $('#formError').hidden = false; $('#formError').textContent = validation.errors[0].message; return; }
  const schemaErrors = validateAgainstSchema(currentProfile, profileSchema);
  if (schemaErrors.length) { $('#formError').hidden = false; $('#formError').textContent = `Проверьте ответы: ${schemaErrors[0].message}`; return; }
  try { switchToResult(calculateAllCountries()); }
  catch (error) { $('#formError').hidden = false; $('#formError').textContent = `Не удалось выполнить расчёт: ${error.message}`; }
});
$('#saveDraft').addEventListener('click', () => { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft())); showToast('Черновик сохранён в этом браузере'); });
$('#clearDraft').addEventListener('click', clearAll);
$('#editProfile').addEventListener('click', () => { $('#resultView').hidden = true; $('#questionnaireView').hidden = false; $('#heroTitle').textContent = 'Подберём вариант иммиграции'; showStep(1); });

async function init() {
  restoreDraft(); syncChildren(); syncConditional(); showStep(1, false);
  try {
    const [spainResponse, uruguayResponse, schemaResponse] = await Promise.all([fetch('../data/spain-research-v2.2.json'), fetch('../data/uruguay-research-v2.2.json'), fetch('../data/schemas/user-profile-v1.schema.json')]);
    if (!spainResponse.ok || !uruguayResponse.ok || !schemaResponse.ok) throw new Error(`HTTP ${spainResponse.status}/${uruguayResponse.status}/${schemaResponse.status}`);
    [spainData, uruguayData, profileSchema] = await Promise.all([spainResponse.json(), uruguayResponse.json(), schemaResponse.json()]);
    calculationContext = await loadCalculationContext();
  } catch (error) {
    $('#formError').hidden = false;
    $('#formError').textContent = error.code === 'CALCULATION_CONTEXT_INCOMPLETE' ? 'Расчёт временно недоступен: не удалось получить актуальный курс валют.' : `Не удалось загрузить данные: ${error.message}`;
  }
}

init();
