import { STATUS_LABELS_RU } from '../js/spain-calculator.js?v=0.12.6';
import { calculateCountries } from '../js/engine/calculate-countries.js?v=0.12.6';
import { spainAdapter } from '../js/countries/spain-adapter.js?v=0.12.6';
import { loadCalculationContext } from '../pilot/fx-context.js?v=0.12.6';
import { countryOptions, parseCountryCode, searchCountries } from './countries.js?v=0.12.6';
import { isKnownDogBreed, normalizeDogBreed, searchDogBreeds } from './dog-breeds.js?v=0.12.6';
import { buildUserProfile, describeIncomeRequirement, describeResultIntro, resolveProvableAmount, sortRoutesForDisplay, validateAgainstSchema, validateUserProfile } from './profile.js?v=0.12.6';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $('#matcherForm');
const steps = $$('.wizard-step');
const TOTAL_STEPS = steps.length;
const DRAFT_KEY = 'immigration-matcher-universal-draft-v2';
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
const CITY_COMPARISONS = {
  ES: [
    { name: 'Мадрид', size: 'LARGE', roles: ['Столица', 'Самый дорогой по индексу Expatistan'], cost: 2109, cold: ['январь', 2.7, 9.8], hot: ['июль', 19, 32.1] },
    { name: 'Кордова', size: 'MEDIUM', roles: ['Самый жаркий'], cost: 1310, cold: ['январь', 3.6, 14.9], hot: ['июль', 19, 36.9] },
    { name: 'Бургос', size: 'SMALL', roles: ['Самый прохладный'], cost: 1242, cold: ['январь', -0.8, 7], hot: ['июль', 11.5, 27.6] },
    { name: 'Пуэртольяно', size: 'SMALL', roles: ['Самый недорогой'], cost: 896 },
  ],
  UY: [
    { name: 'Монтевидео', size: 'LARGE', roles: ['Столица'], cost: 1539, cold: ['июль', 7.2, 15.1], hot: ['январь', 18.1, 28.4] },
    { name: 'Артигас', size: 'SMALL', roles: ['Самый жаркий'], cost: 992, cold: ['июль', 7.8, 17.8], hot: ['январь', 19.4, 32.8] },
    { name: 'Роча', size: 'SMALL', roles: ['Самый прохладный'], cost: 900, cold: ['июль', 6.1, 15], hot: ['январь', 17.8, 27.2] },
    { name: 'Пунта-дель-Эсте', size: 'SMALL', roles: ['Самый дорогой'], cost: 1629 },
    { name: 'Мело', size: 'SMALL', roles: ['Самый недорогой'], cost: 751 },
  ],
};

const INCOME_FIELDS = (prefix, title) => `<h3>${title}</h3><div class="field-grid two-col">
  <label class="field"><span>Тип дохода</span><select id="${prefix}Type"><option value="" disabled selected hidden>Выберите</option><option value="REMOTE_EMPLOYMENT">Удалённая работа по трудовому договору</option><option value="CONTRACTOR">Контракт с заказчиком (без трудовых отношений)</option><option value="FREELANCE_OR_SELF_EMPLOYED">Фриланс или самозанятость</option><option value="SOLE_PROPRIETOR">ИП</option><option value="COMPANY_OWNER">Владелец компании</option><option value="PASSIVE_INCOME">Пассивный доход</option><option value="OTHER_REGULAR_REMOTE_INCOME">Другой регулярный доход</option></select></label>
  <label id="${prefix}SourceCountryField" class="field"><span>Страна работодателя или источника</span><input id="${prefix}SourceCountry" list="countryOptions" placeholder="Начните вводить название"><small>Для фриланса без одного постоянного заказчика можно не указывать.</small></label>
  <label class="field"><span>Страна банка</span><input id="${prefix}BankCountry" list="countryOptions" placeholder="Начните вводить название"><small>Используется для проверки пригодности выписок, а не для выбора маршрута.</small></label>
  <label class="field"><span>Ваш регулярный доход в месяц</span><div class="money-combo"><input id="${prefix}TotalAmount" type="number" min="0"><select id="${prefix}Currency"><option>USD</option><option>EUR</option><option>RUB</option></select></div></label>
  <label class="field"><span>Какую часть дохода можете подтвердить документами?</span><select id="${prefix}Evidence"><option value="" disabled selected hidden>Выберите</option><option value="FULL">Весь доход</option><option value="PARTIAL">Только часть</option><option value="NONE">Пока не могу подтвердить</option></select><small>Подтверждаемая сумма сравнивается с финансовым порогом программы.</small></label>
  <label id="${prefix}AmountField" class="field income-partial-field" hidden><span>Какую сумму сможете подтвердить?</span><div class="money-combo money-combo-fixed-currency"><input id="${prefix}Amount" type="number" min="0"><span>в той же валюте</span></div></label>
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

function enhanceDogBreedSearch(input) {
  if (!input || input.dataset.searchReady) return;
  input.dataset.searchReady = 'true';
  input.setAttribute('autocomplete', 'off');
  const menu = document.createElement('div');
  menu.className = 'country-search-results dog-breed-search-results';
  menu.hidden = true;
  input.insertAdjacentElement('afterend', menu);
  const render = () => {
    const matches = searchDogBreeds(input.value);
    menu.replaceChildren(...matches.map((label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        input.value = label;
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

enhanceDogBreedSearch($('#dogBreed'));

const resolvedIncomeAmount = (prefix) => resolveProvableAmount(
  value(`${prefix}TotalAmount`),
  value(`${prefix}Evidence`),
  value(`${prefix}Amount`),
);

function collectAnswers() {
  const childAges = $$('#childAges input').map((input) => input.value);
  const inRussia = radio('inRussia') === 'YES';
  const returning = radio('returnToRussia') === 'YES';
  const applicationMethods = inRussia ? ['RUSSIA'] : returning ? ['ANY'] : ['CURRENT_COUNTRY', 'IN_COUNTRY_AFTER_ENTRY'];
  return {
    inRussia, returnToRussia: returning, currentCountry: inRussia ? 'RU' : value('currentCountry'), currentStatus: inRussia ? 'CITIZENSHIP' : value('currentStatus'), applicationMethods,
    hasPartner: radio('partnerIncluded') === 'YES', partnerIncluded: radio('partnerIncluded') === 'YES', relationshipType: value('relationshipType'), lgbtEnabled: checked('lgbtEnabled'),
    childAges: radio('hasChildren') === 'YES' ? childAges : [], schoolNeeded: radio('schoolType') === 'INTERNATIONAL', schoolType: radio('schoolType'), kindergartenNeeded: radio('kindergartenNeeded') === 'YES',
    primaryType: value('primaryType'), primarySourceCountry: value('primarySourceCountry'), primaryBankCountry: value('primaryBankCountry'), primaryTotalAmount: value('primaryTotalAmount'), primaryAmount: resolvedIncomeAmount('primary'), primaryCurrency: value('primaryCurrency'), primaryEvidence: value('primaryEvidence'),
    hasAdditionalIncome: checked('hasAdditionalIncome'), additionalType: value('additionalType'), additionalSourceCountry: value('additionalSourceCountry'), additionalBankCountry: value('additionalBankCountry'), additionalTotalAmount: value('additionalTotalAmount'), additionalAmount: resolvedIncomeAmount('additional'), additionalCurrency: value('additionalCurrency'), additionalEvidence: value('additionalEvidence'),
    partnerHasIncome: checked('partnerHasIncome'), partnerType: value('partnerType'), partnerSourceCountry: value('partnerSourceCountry'), partnerBankCountry: value('partnerBankCountry'), partnerTotalAmount: value('partnerTotalAmount'), partnerAmount: resolvedIncomeAmount('partner'), partnerCurrency: value('partnerCurrency'), partnerEvidence: value('partnerEvidence'),
    longTermGoal: value('longTermGoal'), physicalPresence: 'DEPENDS_ON_COUNTRY', languageExamReadiness: 'DEPENDS_ON_LANGUAGE', keepRuCitizenship: value('longTermGoal') === 'TEMPORARY_RESIDENCE_SUFFICIENT' ? 'NOT_IMPORTANT' : (radio('keepRuCitizenship') || 'NOT_IMPORTANT'),
    budgetUnknown: checked('budgetUnknown'), monthlyBudget: value('monthlyBudget'), budgetCurrency: value('budgetCurrency'),
    petTypes: radio('hasPets') === 'NO' ? ['NONE'] : radio('petType') ? [radio('petType')] : [], dogBreedChoice: normalizeDogBreed(value('dogBreed')), dogBreed: normalizeDogBreed(value('dogBreed')), otherPetNotes: radio('petType') === 'CAT' ? `HYBRID_CAT:${radio('hybridCat') || 'UNKNOWN'}` : null,
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
  $('#catBlock').hidden = pet !== 'CAT';
  for (const prefix of ['primary', 'additional', 'partner']) {
    const freelance = value(`${prefix}Type`) === 'FREELANCE_OR_SELF_EMPLOYED';
    const sourceField = $(`#${prefix}SourceCountryField`);
    if (sourceField) sourceField.hidden = freelance;
    const partialField = $(`#${prefix}AmountField`);
    const partialInput = $(`#${prefix}Amount`);
    const showPartial = value(`${prefix}Evidence`) === 'PARTIAL';
    if (partialField) partialField.hidden = !showPartial;
    if (partialInput) partialInput.disabled = !showPartial;
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
    else if (radio('petType') === 'DOG' && !value('dogBreed')) error = fieldError(['dogBreed'], 'Укажите породу собаки.');
    else if (radio('petType') === 'DOG' && !isKnownDogBreed(value('dogBreed'))) error = fieldError(['dogBreed'], 'Выберите породу из списка, «Метис» или «Не знаю».');
    else if (radio('petType') === 'CAT' && !radio('hybridCat')) error = fieldError(['hybridCat'], 'Ответьте, является ли кошка гибридной породой.');
  }
  const incomeError = (prefix) => {
    if (!value(`${prefix}Type`)) return fieldError([`${prefix}Type`], 'Укажите тип дохода.');
    if (value(`${prefix}Type`) !== 'FREELANCE_OR_SELF_EMPLOYED' && !parseCountryCode(value(`${prefix}SourceCountry`))) return fieldError([`${prefix}SourceCountry`], 'Укажите страну источника дохода.');
    if (!parseCountryCode(value(`${prefix}BankCountry`))) return fieldError([`${prefix}BankCountry`], 'Укажите страну банковского счёта.');
    if (value(`${prefix}TotalAmount`).trim() === '' || Number(value(`${prefix}TotalAmount`)) <= 0) return fieldError([`${prefix}TotalAmount`], 'Укажите ваш регулярный доход.');
    const evidence = value(`${prefix}Evidence`);
    if (!evidence) return fieldError([`${prefix}Evidence`], 'Выберите, какую часть дохода можете подтвердить.');
    if (evidence === 'PARTIAL') {
      const partial = value(`${prefix}Amount`);
      if (partial.trim() === '' || Number(partial) <= 0) return fieldError([`${prefix}Amount`], 'Укажите сумму, которую сможете подтвердить.');
      if (Number(partial) > Number(value(`${prefix}TotalAmount`))) return fieldError([`${prefix}Amount`], 'Подтверждаемая сумма не может быть больше общего дохода.');
    }
    return null;
  };
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
    ['Семейный бюджет', p.preferences.monthly_budget ? `${p.preferences.monthly_budget.amount} ${p.preferences.monthly_budget.currency}/мес` : checked('budgetUnknown') ? 'Автоматически равен общему доходу' : 'Не указан'],
  ];
  $('#profileSummary').innerHTML = rows.map(([label, val]) => `<div class="summary-row"><span>${html(label)}</span><b>${html(val)}</b></div>`).join('');
}

function statusClass(status) { return status === 'SUITABLE' ? 'positive' : status === 'UNSUITABLE' ? 'negative' : 'conditional'; }

const LGBT_ROWS = {
  ES: [
    ['Брак и переезд с супругом', 'Однополый брак признаётся. Супруг или супруга может участвовать в семейной иммиграции на тех же условиях, что и в разнополом браке.'],
    ['Незарегистрированные отношения', 'Партнёра без брака можно включить в некоторые программы, но потребуется доказать устойчивые отношения.'],
    ['Защита от дискриминации', 'Закон защищает от дискриминации в работе, жилье, образовании, медицине и услугах — в том числе иностранцев.'],
    ['Международная защита', 'Можно просить убежище или дополнительную защиту, если есть личный риск преследования из-за сексуальной ориентации или гендерной идентичности и страна происхождения не может защитить. Решение принимают по обстоятельствам и доказательствам.'],
  ],
  UY: [
    ['Брак и переезд с супругом', 'Однополый брак признаётся. Супруг или супруга может участвовать в семейной иммиграции на тех же условиях, что и в разнополом браке.'],
    ['Незарегистрированные отношения', 'Без брака семейный союз обычно нужно официально признать. Для unión concubinaria требуется не менее пяти лет совместной жизни и судебное признание.'],
    ['Защита от дискриминации', 'Дискриминация по сексуальной ориентации и гендерной идентичности запрещена законом. Доступ к защите на практике может отличаться.'],
    ['Международная защита', 'Можно просить статус беженца, если есть личный риск преследования из-за сексуальной ориентации или гендерной идентичности. Решение принимают по обстоятельствам и доказательствам.'],
  ],
};

const LGBT_SAFETY = {
  ES: { level: 'Достаточно безопасно', tone: 'safe', text: 'Сильная правовая защита и в целом открытая общественная среда. Уровень личной безопасности может отличаться по районам и ситуациям.' },
  UY: { level: 'Достаточно безопасно', tone: 'safe', text: 'Страна в целом открыта и имеет сильную правовую защиту. Уровень личной безопасности может отличаться по районам и ситуациям.' },
};

const LGBT_CHANGES = {
  ES: 'В Испании рассматривается законопроект об уголовной ответственности за конверсионные практики. Конгресс одобрил его и направил в Сенат, но закон пока не принят. На правила въезда, ВНЖ и семейной иммиграции этот проект не влияет.',
  UY: 'В Монтевидео действует План разнообразия 2026–2030 с новыми мерами в здравоохранении, занятости, жилье и защите от дискриминации. Это городская программа, а не новый национальный закон.',
};

function renderLgbtResearch(calculation) {
  if (!calculation.lgbt?.rules?.length) return '';
  const countryId = calculation.country.countryId;
  const rows = LGBT_ROWS[countryId] || [];
  const safety = LGBT_SAFETY[countryId];
  const change = LGBT_CHANGES[countryId];
  return `<section class="lgbt-research"><div class="section-title-row"><div><h3>ЛГБТ: права, семья и иммиграция</h3><p>Кратко о том, что важно при переезде и жизни в стране.</p></div></div><div class="lgbt-list">${rows.map(([title, text]) => `<div class="lgbt-row"><h4>${html(title)}</h4><p>${html(text)}</p></div>`).join('')}${safety ? `<div class="lgbt-row"><h4>Безопасность</h4><div><span class="lgbt-safety ${html(safety.tone)}">${html(safety.level)}</span><p>${html(safety.text)}</p></div></div>` : ''}${change ? `<div class="lgbt-row"><h4>Что меняется</h4><p>${html(change)}</p></div>` : ''}</div></section>`;
}

function longTermConditions(route) {
  if (!route.longTerm) return '';
  const rule = route.longTerm;
  const items = [];
  const languageNames = { es: 'испанский', en: 'английский', pt: 'португальский', fr: 'французский', de: 'немецкий' };
  const levelNames = { FUNCTIONAL: 'разговорный уровень', A2: 'уровень A2', B1: 'уровень B1', B2: 'уровень B2' };
  const countryId = route.routeId.startsWith('UY_') ? 'UY' : route.routeId.startsWith('ES_') ? 'ES' : null;
  if (countryId === 'ES') {
    if (rule.residence_counted_for_citizenship === 'NO_AS_STAY_GENERAL_RULE') items.push('Срок до гражданства: период студенческого пребывания обычно не засчитывается как обычная резиденция; после перехода на засчитываемый статус действует общий срок 10 лет до подачи.');
    else items.push('Срок до гражданства: минимум 10 лет засчитываемого проживания до подачи; рассмотрение заявления занимает дополнительное время.');
  } else if (countryId === 'UY') {
    const withFamily = route.routeId === 'UY_FAMILY_LINK' || Boolean(currentProfile?.family?.partner_included || currentProfile?.family?.children?.length);
    const years = withFamily ? 3 : 5;
    const countNote = route.routeId === 'UY_DIGITAL_NOMAD' || route.routeId === 'UY_TEMPORARY' ? ' Засчитывается ли весь срок именно по этому разрешению, нужно подтвердить перед долгосрочным планированием.' : '';
    items.push(`Срок до гражданства: обычно ${years} ${years === 3 ? 'года' : 'лет'} обычного проживания ${withFamily ? 'при семье, фактически живущей с вами в Уругвае' : 'без семьи, живущей с вами в Уругвае'}.${countNote}`);
  }
  if (rule.language_exam_required === 'YES') items.push(`Язык: требуется ${languageNames[rule.required_language] || rule.required_language || 'местный язык'}${rule.required_language_level ? `, ${levelNames[rule.required_language_level] || `уровень ${rule.required_language_level}`}` : ''}.`);
  else if (rule.language_exam_required === 'UNKNOWN') items.push('Язык: точное требование нужно подтвердить перед выбором долгосрочной стратегии.');
  const genericSpainContinuityNote = 'Для гражданства фиксированный универсальный числовой лимит отсутствий в первичном источнике не найден; непрерывность оценивается индивидуально.';
  if (rule.notes && rule.notes !== genericSpainContinuityNote) items.push(rule.notes);
  else if (countryId !== 'ES') items.push('Срок фактического проживания и допустимые выезды нужно проверить для выбранной долгосрочной цели.');
  return `<div class="route-client-items"><h4>Путь к ПМЖ и гражданству</h4><ul>${items.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>`;
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
  return `<article class="route-result ${main ? 'best' : ''}"><div><span class="status-pill ${statusClass(route.routeStatus)}">${html(STATUS_LABELS_RU[route.routeStatus])}</span><h3>${html(route.routeName)}</h3></div>${finance}${applicationBlock}${reasonsBlock}${actionsBlock}${permitRequirementsBlock}${missingBlock}${clientMissingBlock}${sourceBlock}${exampleSourceBlock}${longTermConditions(route)}</article>`;
}

function countryPresentation(calculation) {
  const sortedRoutes = sortRoutesForDisplay(calculation.routes);
  const best = sortedRoutes[0] || calculation.bestRoute;
  const countryId = calculation.country.countryId;
  return {
    sortedRoutes,
    best,
    countryId,
    countryName: calculation.country.name,
    flag: countryId === 'ES' ? '🇪🇸' : countryId === 'UY' ? '🇺🇾' : '🌍',
  };
}

function renderCountryTab(calculation, active = false) {
  const { best, countryId, countryName, flag } = countryPresentation(calculation);
  return `<button class="country-tab${active ? ' is-active' : ''}" type="button" role="tab" data-country-tab="${html(countryId)}" aria-controls="country-panel-${html(countryId)}" aria-selected="${active}"><span class="country-tab-flag" aria-hidden="true">${flag}</span><span class="country-tab-copy"><strong>${html(countryName)}</strong><small>${html(best?.routeName || 'Маршрут не определён')}</small></span><span class="status-pill ${statusClass(best?.routeStatus)}">${html(STATUS_LABELS_RU[best?.routeStatus] || 'Требует проверки')}</span></button>`;
}

function renderCountryResult(calculation, changed = false, active = false) {
  const { sortedRoutes, best, countryId, countryName, flag } = countryPresentation(calculation);
  const children = calculation.profile.children?.length || 0;
  const family = `${calculation.profile.adults} ${calculation.profile.adults === 1 ? 'взрослый' : 'взрослых'}${children ? `, ${children} ${children === 1 ? 'ребёнок' : 'детей'}` : ''}`;
  const { routeLabel } = describeResultIntro(calculation.routes, changed);
  const thresholdLabel = best?.incomeTypeFit === 'DOES_NOT_MEET' ? 'Финансовый порог' : 'Необходимый доход';
  const thresholdValue = best?.incomeTypeFit === 'DOES_NOT_MEET'
    ? 'Не оценивается: тип дохода не подходит'
    : best?.thresholdUsd != null
      ? `больше ${currency(best.thresholdUsd, 'USD')}`
      : best?.thresholdEur != null
        ? currency(best.thresholdEur, 'EUR')
        : 'Нужен расчёт по документам';
  const otherPetWarning = currentProfile?.pets?.types?.includes('OTHER') ? '<div class="route-open-items practical-warning"><h4>Нужна отдельная проверка животного</h4><p>У вас указано другое животное. Правила его ввоза зависят от конкретного вида и страны происхождения. Перед переездом потребуется отдельная проверка правил для этой страны.</p></div>' : '';
  const incomeAmount = countryId === 'ES' ? best?.incomeEur : best?.incomeUsd;
  const incomeCurrency = countryId === 'ES' ? 'EUR' : 'USD';
  const citySizeLabels = { LARGE: 'Крупный город', MEDIUM: 'Средний город', SMALL: 'Небольшой город' };
  const comparisonCities = CITY_COMPARISONS[countryId] || [];
  const familyFactor = 1 + Math.max(0, calculation.profile.adults - 1) * 0.6 + children * 0.4;
  const budgetUsd = calculation.profile.monthlyBudgetUsd;
  const budgetSourceNote = calculation.profile.budgetDerivedFromIncome && budgetUsd != null
    ? `<p class="budget-source-note">Бюджет не указан отдельно, поэтому для сравнения использован общий регулярный доход: <b>${currency(budgetUsd)}</b> в месяц.</p>`
    : '';
  const educationCost = currentProfile?.family?.school_needed ? (countryId === 'ES' ? 900 : 700) : 0;
  const daycareNote = radio('kindergartenNeeded') === 'YES' ? 'Детский сад: цена зависит от города и возраста; пока показан отдельно как требующий проверки.' : '';
  const citySection = comparisonCities.length
    ? `<div class="city-budget-grid climate-grid">${comparisonCities.map((city) => {
        const living = Math.round(city.cost * familyFactor);
        const total = living + educationCost;
        const delta = budgetUsd == null ? null : budgetUsd - total;
        const schoolLine = educationCost ? `<span>Международная школа: ориентир <b>+${currency(educationCost)}/мес</b></span>` : '';
        const budgetLine = delta == null ? '' : delta >= 0
          ? `<span class="budget-ok">В бюджет укладывается, запас ${currency(delta)}</span>`
          : `<span class="budget-short">Не хватает примерно ${currency(Math.abs(delta))}</span>`;
        return `<article class="city-card"><div class="city-role-list">${city.roles.map((role) => `<span>${html(role)}</span>`).join('')}</div><small>${html(citySizeLabels[city.size])}</small><h4>${html(city.name)}</h4><strong>${currency(living)}/мес на семью</strong>${schoolLine}${budgetLine}${city.cold ? `<span>Самый холодный месяц (${html(city.cold[0])}): <b>${city.cold[1]}…${city.cold[2]} °C</b></span>` : ''}${city.hot ? `<span>Самый жаркий месяц (${html(city.hot[0])}): <b>${city.hot[1]}…${city.hot[2]} °C</b></span>` : ''}</article>`;
      }).join('')}</div>${daycareNote ? `<p class="research-caveat">${html(daycareNote)}</p>` : ''}<p class="research-caveat">Стоимость жизни — текущий сравнительный ориентир в USD. Она оценивает комфорт и не меняет юридическую пригодность ВНЖ.</p>`
    : '<p>Для этой страны пока нет городской модели.</p>';
  return `<article id="country-panel-${html(countryId)}" class="country-detail-panel" role="tabpanel" data-country-panel="${html(countryId)}"${active ? '' : ' hidden'}><div class="country-result-banner"><span class="country-flag" aria-hidden="true">${flag}</span><div class="country-summary-text"><h2>${html(countryName)}</h2><p>${routeLabel}: <b>${html(best?.routeName || 'не определён')}</b></p></div></div><div class="country-comparison-body">
    <div class="kpi-grid three"><div class="kpi"><span>Состав семьи</span><b>${html(family)}</b></div><div class="kpi"><span>Подтверждаемый доход после пересчёта</span><b>${incomeAmount == null ? 'Не рассчитан' : currency(incomeAmount, incomeCurrency)}</b></div><div class="kpi"><span>${thresholdLabel}</span><b>${thresholdValue}</b></div></div>${otherPetWarning}
    <section><div class="section-title-row"><div><h3>Все проверенные варианты</h3></div></div><div class="alternative-routes">${sortedRoutes.map((route) => routeCard(route, countryName, route.routeId === best?.routeId)).join('')}</div></section>
    <section><div class="section-title-row"><div><h3>Города, климат и семейный бюджет</h3></div></div>${budgetSourceNote}${citySection}</section>
    ${renderLgbtResearch(calculation)}
    <p class="result-note">Юридические правила маршрутов проверены по указанным источникам. Стоимость жизни — ориентировочная практическая оценка. Расчёт: ${html(calculation.calculatedAt?.slice(0, 10))}. Курс валют: ${html(calculationContext.fx.as_of?.slice(0, 10))}, источник ${html(calculationContext.fx.source)}. Результат предварительный и не является юридическим обещанием.</p></div></article>`;
}

function calculateAllCountries() {
  return calculateCountries(currentProfile, [spainData, uruguayData], calculationContext, () => spainAdapter);
}

function renderResult(calculation, changed = false) {
  const countries = calculation.results || [];
  $('#result').innerHTML = `<div class="country-workspace"><nav class="country-tabs" role="tablist" aria-label="Страны">${countries.map((country, index) => renderCountryTab(country, index === 0)).join('')}</nav><div class="country-detail-pane">${countries.map((country, index) => renderCountryResult(country, changed, index === 0)).join('')}</div></div>`;
  const activateCountry = (countryId) => {
    $$('[data-country-tab]', $('#result')).forEach((tab) => {
      const active = tab.dataset.countryTab === countryId;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $$('[data-country-panel]', $('#result')).forEach((panel) => { panel.hidden = panel.dataset.countryPanel !== countryId; });
    requestAnimationFrame(() => {
      $('.country-workspace', $('#result'))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };
  $$('[data-country-tab]', $('#result')).forEach((tab) => tab.addEventListener('click', () => activateCountry(tab.dataset.countryTab)));
}

function switchToResult(calculation, changed = false) {
  renderResult(calculation, changed);
  $('#questionnaireView').hidden = true;
  $('#resultView').hidden = false;
  $('#heroTitle').textContent = 'Ваш результат';
  $('#heroSubtitle').textContent = 'По вашим ответам рассчитаны доступные варианты переезда и условия для семьи.';
  $('#editProfile').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600); }

function draft() { return { version: 2, savedAt: new Date().toISOString(), answers: collectAnswers() }; }

function setRadio(name, val) { const input = $(`input[name="${name}"][value="${CSS.escape(String(val))}"]`); if (input) input.checked = true; }
function setCheckboxes(name, values = []) { $$(`input[name="${name}"]`).forEach((input) => { input.checked = values.includes(input.value); }); }

function restoreDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (stored?.version !== 2 || !stored.answers) return false;
    const a = stored.answers;
    const simple = ['currentCountry','currentStatus','relationshipType','primaryType','primarySourceCountry','primaryBankCountry','primaryTotalAmount','primaryAmount','primaryCurrency','primaryEvidence','additionalType','additionalSourceCountry','additionalBankCountry','additionalTotalAmount','additionalAmount','additionalCurrency','additionalEvidence','partnerType','partnerSourceCountry','partnerBankCountry','partnerTotalAmount','partnerAmount','partnerCurrency','partnerEvidence','longTermGoal','monthlyBudget','budgetCurrency'];
    simple.forEach((id) => { if ($(`#${id}`) && a[id] != null) $(`#${id}`).value = a[id]; });
    if (a.dogBreed) $('#dogBreed').value = normalizeDogBreed(a.dogBreedChoice === 'OTHER_KNOWN' ? a.dogBreed : (a.dogBreedChoice || a.dogBreed));
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
$('#editProfile').addEventListener('click', () => { $('#resultView').hidden = true; $('#questionnaireView').hidden = false; $('#heroTitle').textContent = 'Подберём вариант иммиграции'; $('#heroSubtitle').textContent = 'Ответьте на вопросы о вашей ситуации — анкета рассчитает доступные страны и программы.'; $('#editProfile').hidden = true; showStep(1); });

async function init() {
  restoreDraft(); syncChildren(); syncConditional(); showStep(1, false);
  try {
    const [spainResponse, uruguayResponse, schemaResponse] = await Promise.all([fetch('../data/spain-research-v2.2.json?v=0.12.6'), fetch('../data/uruguay-research-v2.2.json?v=0.12.6'), fetch('../data/schemas/user-profile-v1.schema.json?v=0.12.6')]);
    if (!spainResponse.ok || !uruguayResponse.ok || !schemaResponse.ok) throw new Error(`HTTP ${spainResponse.status}/${uruguayResponse.status}/${schemaResponse.status}`);
    [spainData, uruguayData, profileSchema] = await Promise.all([spainResponse.json(), uruguayResponse.json(), schemaResponse.json()]);
    calculationContext = await loadCalculationContext();
  } catch (error) {
    $('#formError').hidden = false;
    $('#formError').textContent = error.code === 'CALCULATION_CONTEXT_INCOMPLETE' ? 'Расчёт временно недоступен: не удалось получить актуальный курс валют.' : `Не удалось загрузить данные: ${error.message}`;
  }
}

init();
