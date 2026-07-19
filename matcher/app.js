import { STATUS_LABELS_RU } from '../js/spain-calculator.js';
import { calculateCountries } from '../js/engine/calculate-countries.js';
import { spainAdapter } from '../js/countries/spain-adapter.js';
import { loadCalculationContext } from '../pilot/fx-context.js';
import { countryOptions, parseCountryCode } from './countries.js';
import { buildUserProfile, collectEligibleFollowUps, describeIncomeRequirement, describeResultIntro, validateAgainstSchema, validateUserProfile } from './profile.js';

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
  <label class="field"><span>Тип дохода</span><select id="${prefix}Type"><option value="">Не выбрано</option><option value="REMOTE_EMPLOYMENT">Удалённая работа по найму</option><option value="CONTRACTOR">Контракты</option><option value="FREELANCE_OR_SELF_EMPLOYED">Фриланс или самозанятость</option><option value="SOLE_PROPRIETOR">ИП</option><option value="COMPANY_OWNER">Владелец компании</option><option value="PASSIVE_INCOME">Пассивный доход</option><option value="OTHER_REGULAR_REMOTE_INCOME">Другой регулярный доход</option></select></label>
  <label class="field"><span>Страна источника</span><input id="${prefix}SourceCountry" list="countryOptions" placeholder="Начните вводить название"></label>
  <label class="field"><span>Страна банка</span><input id="${prefix}BankCountry" list="countryOptions" placeholder="Начните вводить название"></label>
  <label class="field"><span>Подтверждаемая сумма в месяц</span><div class="money-combo"><input id="${prefix}Amount" type="number" min="0"><select id="${prefix}Currency"><option>USD</option><option>EUR</option><option>RUB</option></select></div></label>
  <label class="field"><span>Подтверждение</span><select id="${prefix}Evidence"><option value="">Не выбрано</option><option value="FULL">Полностью</option><option value="PARTIAL">Частично</option><option value="NONE">Пока нет документов</option></select></label>
</div>`;

$('#additionalIncomeBlock').innerHTML = INCOME_FIELDS('additional', 'Дополнительный доход заявителя');
$('#partnerIncomeBlock').innerHTML = INCOME_FIELDS('partner', 'Доход партнёра');
$('#countryOptions').innerHTML = countryOptions().map(({ label }) => `<option value="${html(label)}"></option>`).join('');

function collectAnswers() {
  const childAges = $$('#childAges input').map((input) => input.value);
  return {
    currentCountry: value('currentCountry'), currentStatus: value('currentStatus'), applicationMethods: checkboxValues('applicationMethod'),
    hasPartner: radio('hasPartner') === 'YES', partnerIncluded: radio('hasPartner') === 'YES' && radio('partnerIncluded') === 'YES', relationshipType: value('relationshipType'), lgbtEnabled: checked('lgbtEnabled'),
    childAges, schoolNeeded: checked('schoolNeeded'),
    primaryType: value('primaryType'), primarySourceCountry: value('primarySourceCountry'), primaryBankCountry: value('primaryBankCountry'), primaryAmount: value('primaryAmount'), primaryCurrency: value('primaryCurrency'), primaryEvidence: value('primaryEvidence'),
    hasAdditionalIncome: checked('hasAdditionalIncome'), additionalType: value('additionalType'), additionalSourceCountry: value('additionalSourceCountry'), additionalBankCountry: value('additionalBankCountry'), additionalAmount: value('additionalAmount'), additionalCurrency: value('additionalCurrency'), additionalEvidence: value('additionalEvidence'),
    partnerHasIncome: checked('partnerHasIncome'), partnerType: value('partnerType'), partnerSourceCountry: value('partnerSourceCountry'), partnerBankCountry: value('partnerBankCountry'), partnerAmount: value('partnerAmount'), partnerCurrency: value('partnerCurrency'), partnerEvidence: value('partnerEvidence'),
    longTermGoal: value('longTermGoal'), physicalPresence: value('physicalPresence'), languageExamReadiness: value('languageExamReadiness'), keepRuCitizenship: value('keepRuCitizenship'),
    budgetUnknown: checked('budgetUnknown'), monthlyBudget: value('monthlyBudget'), budgetCurrency: value('budgetCurrency'), citySize: value('citySize'), climates: checkboxValues('climate'),
    petTypes: radio('petType') ? [radio('petType')] : [], dogBreed: value('dogBreed'), otherPetNotes: value('otherPetNotes'),
    specialCircumstances: value('specialCircumstance') ? [value('specialCircumstance')] : [], medicalEnabled: checked('medicalEnabled'), specificMedicineRequired: checked('specificMedicineRequired'), regularCareRequired: checked('regularCareRequired'), medicalDetails: value('medicalDetails'),
    routeSpecificAnswers: currentProfile?.route_specific_answers || {},
  };
}

function profile() { return buildUserProfile(collectAnswers()); }

function syncChildren() {
  const count = Number(value('childrenCount') || 0);
  const existing = $$('#childAges input').map((input) => input.value);
  $('#childrenBlock').hidden = count === 0;
  $('#childAges').innerHTML = Array.from({ length: count }, (_, index) => `<label class="field"><span>Возраст ребёнка ${index + 1}</span><input data-child-age type="number" min="0" max="25" value="${html(existing[index] || '')}" placeholder="Лет"></label>`).join('');
}

function syncConditional() {
  const hasPartner = radio('hasPartner') === 'YES';
  const partner = hasPartner && radio('partnerIncluded') === 'YES';
  $('#partnerMoveBlock').hidden = !hasPartner;
  $('#partnerBlock').hidden = !partner;
  $('#partnerIncomeQuestion').hidden = !partner;
  $('#partnerIncomeBlock').hidden = !partner || !checked('partnerHasIncome');
  $('#additionalIncomeBlock').hidden = !checked('hasAdditionalIncome');
  const longGoal = value('longTermGoal');
  $('#languageBlock').hidden = !['PR_REQUIRED', 'CITIZENSHIP_DESIRED', 'CITIZENSHIP_MAIN_GOAL', 'CITIZENSHIP_REQUIRED'].includes(longGoal);
  const pet = radio('petType');
  $('#dogBlock').hidden = pet !== 'DOG';
  $('#otherPetBlock').hidden = pet !== 'OTHER';
  $('#medicalBlock').hidden = !checked('medicalEnabled');
  $('#monthlyBudget').disabled = checked('budgetUnknown');
}

function fieldError(ids, message) {
  const first = ids.find((id) => $(`#${id}`));
  return { first, message };
}

function validateStep(step) {
  let error;
  if (step === 1 && (!parseCountryCode(value('currentCountry')) || !value('currentStatus') || checkboxValues('applicationMethod').length === 0)) error = fieldError(['currentCountry'], 'Выберите текущую страну, фактический статус и хотя бы один способ подачи.');
  if (step === 2) {
    if (!radio('hasPartner') || (radio('hasPartner') === 'YES' && !radio('partnerIncluded')) || value('childrenCount') === '') error = fieldError(['childrenCount'], 'Укажите, есть ли партнёр, переезжает ли он, и количество детей.');
    else if (radio('partnerIncluded') === 'YES' && !value('relationshipType')) error = fieldError(['relationshipType'], 'Укажите, как оформлены отношения.');
    else if ($$('#childAges input').some((input) => input.value === '' || Number(input.value) < 0 || Number(input.value) > 25)) error = fieldError(['childAges'], 'Укажите возраст каждого ребёнка от 0 до 25 лет.');
  }
  const validIncome = (prefix) => value(`${prefix}Type`) && parseCountryCode(value(`${prefix}SourceCountry`)) && parseCountryCode(value(`${prefix}BankCountry`)) && Number(value(`${prefix}Amount`)) > 0 && value(`${prefix}Evidence`);
  if (step === 3 && (!validIncome('primary') || (checked('hasAdditionalIncome') && !validIncome('additional')) || (radio('partnerIncluded') === 'YES' && checked('partnerHasIncome') && !validIncome('partner')))) error = fieldError(['primaryType'], 'Заполните тип, страны, сумму, валюту и подтверждение каждого выбранного дохода.');
  if (step === 4 && (!value('longTermGoal') || !value('physicalPresence') || !value('keepRuCitizenship') || (!$('#languageBlock').hidden && !value('languageExamReadiness')))) error = fieldError(['longTermGoal'], 'Заполните долгосрочную цель и связанные с ней условия.');
  if (step === 5 && ((!checked('budgetUnknown') && Number(value('monthlyBudget')) <= 0) || !value('citySize') || checkboxValues('climate').length === 0 || !radio('petType'))) error = fieldError(['monthlyBudget'], 'Укажите семейный бюджет, город, хотя бы один климат и животных.');
  if (step === 6 && !value('specialCircumstance')) error = fieldError(['specialCircumstance'], 'Ответьте на вопрос об особых обстоятельствах.');
  const root = $('#formError');
  root.hidden = !error;
  root.textContent = error?.message || '';
  if (error?.first) $(`#${error.first}`)?.focus();
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
  if (currentStep === TOTAL_STEPS) renderReview(profile());
  renderProfileSummary(profile());
  if (scroll) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function familyLabel(p, allowPending = false) {
  if (allowPending && (!radio('hasPartner') || (radio('hasPartner') === 'YES' && !radio('partnerIncluded')) || value('childrenCount') === '')) return 'Не указан';
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

function renderReview(p) {
  const items = [
    ['Гражданство', 'Российская Федерация'], ['Текущее положение', `${p.residence.current_country || '—'}, ${$('#currentStatus').selectedOptions[0]?.textContent || '—'}`],
    ['Состав семьи', familyLabel(p)], ['Возраст детей', p.family.children.length ? p.family.children.map((child) => `${child.age_years} лет`).join(', ') : 'Детей нет'],
    ['Основной доход', p.income.primary.monthly_provable ? `${p.income.primary.monthly_provable.amount} ${p.income.primary.monthly_provable.currency}/мес` : '—'],
    ['Семейный бюджет', p.preferences.monthly_budget ? `${p.preferences.monthly_budget.amount} ${p.preferences.monthly_budget.currency}/мес, школа отдельно` : 'Пока не определён'],
  ];
  $('#reviewSummary').innerHTML = items.map(([label, val]) => `<div class="review-item"><span>${html(label)}</span><b>${html(val)}</b></div>`).join('');
}

function statusClass(status) { return status === 'SUITABLE' ? 'positive' : status === 'UNSUITABLE' ? 'negative' : 'conditional'; }

function routeCard(route, countryName, main = false) {
  const incomeTypeBlocked = route.incomeTypeFit === 'DOES_NOT_MEET';
  const requirement = describeIncomeRequirement(route, currency);
  const visibleBlockers = (route.blockers || []).filter((item) => !incomeTypeBlocked || !item.includes('Тип дохода несовместим'));
  const reasons = [...(incomeTypeBlocked ? [requirement] : []), ...visibleBlockers];
  const reasonsBlock = reasons.length ? `<div class="route-reasons"><h4>${reasons.length > 1 ? 'Почему не подходит — несколько независимых причин' : 'Почему не подходит'}</h4><ul>${reasons.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const countryMissing = route.countryMissing || route.missing || [];
  const missingBlock = countryMissing.length ? `<div class="route-open-items"><h4>Что ещё не подтверждено для этого варианта</h4><ul>${countryMissing.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const clientMissing = route.clientMissing || route.preliminary || [];
  const clientMissingBlock = clientMissing.length ? `<div class="route-client-items"><h4>Что нужно уточнить у вас</h4><ul>${clientMissing.map((item) => `<li>${html(item)}</li>`).join('')}</ul></div>` : '';
  const finance = incomeTypeBlocked ? '' : `<p class="financial-rule">${html(requirement)}</p>`;
  return `<article class="route-result ${main ? 'best' : ''}"><div><span class="status-pill ${statusClass(route.routeStatus)}">${html(STATUS_LABELS_RU[route.routeStatus])}</span><h3>${html(route.routeName)}</h3><p>Расчёт выполнен для страны «${html(countryName)}» по гражданству РФ.</p></div>${finance}${reasonsBlock}${missingBlock}${clientMissingBlock}</article>`;
}

function renderCountryResult(calculation, changed = false) {
  const best = calculation.bestRoute;
  const followUps = collectEligibleFollowUps(calculation);
  const children = calculation.profile.children?.length || 0;
  const family = `${calculation.profile.adults} ${calculation.profile.adults === 1 ? 'взрослый' : 'взрослых'}${children ? `, ${children} ${children === 1 ? 'ребёнок' : 'детей'}` : ''}`;
  const followUpHtml = followUps.length ? `<section class="follow-up-card"><h3>Нужно одно уточнение</h3><p>Оно относится только к варианту «${html(followUps[0].routeName)}» и может изменить предварительный статус.</p><label class="field"><span>Как планируете подтвердить участие в системе социального страхования Испании?</span><select id="socialSecurityPlan"><option value="">Не знаю</option><option value="REGISTER_IN_SPAIN">Зарегистрироваться в Испании</option><option value="FOREIGN_COVERAGE_CERTIFICATE">Использовать подтверждение из другой страны</option><option value="SELF_EMPLOYED_SPAIN">Оформиться как самостоятельный работник в Испании</option></select></label><button id="recalculate" class="primary-button" type="button">Уточнить результат</button></section>` : '';
  const { heading: resultHeading, routeLabel } = describeResultIntro(calculation.routes, changed);
  const countryName = calculation.country.name;
  const countryId = calculation.country.countryId;
  const flag = countryId === 'ES' ? '🇪🇸' : countryId === 'UY' ? '🇺🇾' : '🌍';
  const thresholdLabel = best?.incomeTypeFit === 'DOES_NOT_MEET' ? 'Финансовый порог' : 'Необходимый доход';
  const thresholdValue = best?.incomeTypeFit === 'DOES_NOT_MEET' ? 'Не оценивается: тип дохода не подходит' : best?.thresholdEur == null ? 'Нужен расчёт по документам' : currency(best.thresholdEur, 'EUR');
  return `<details class="country-comparison"><summary class="country-result-banner" data-country-id="${html(countryId)}"><span class="country-flag" aria-hidden="true">${flag}</span><div class="country-summary-text"><small>Страна расчёта</small><h2>${html(countryName)}</h2><p>${routeLabel}: <b>${html(best?.routeName || 'не определён')}</b></p></div><span class="status-pill ${statusClass(best?.routeStatus)}">${html(STATUS_LABELS_RU[best?.routeStatus] || 'Требует проверки')}</span><span class="country-toggle" aria-hidden="true">⌄</span></summary><div class="country-comparison-body"><div class="result-head"><div><h2>${resultHeading}</h2><p>Все варианты ниже относятся только к стране «${html(countryName)}».</p></div></div>
    <div class="kpi-grid three"><div class="kpi"><span>Состав семьи</span><b>${html(family)}</b></div><div class="kpi"><span>Подтверждаемый доход после пересчёта</span><b>${best?.incomeEur == null ? 'Не рассчитан' : currency(best.incomeEur, 'EUR')}</b></div><div class="kpi"><span>${thresholdLabel}</span><b>${thresholdValue}</b></div></div>
    ${best ? routeCard(best, countryName, true) : ''}${followUpHtml}<section><div class="section-title-row"><div><h3>Другие проверенные варианты</h3><p>Каждый вариант проверен отдельно по вашим фактическим ответам.</p></div></div><div class="alternative-routes">${calculation.routes.filter((route) => route.routeId !== best?.routeId).map((route) => routeCard(route, countryName)).join('')}</div></section>
    <section><div class="section-title-row"><div><h3>Практический семейный бюджет</h3><p>Обычные расходы семьи; школа учитывается отдельно, только если она нужна.</p></div></div>${calculation.recommendedCity ? `<div class="city-card recommended"><h4>${html(calculation.recommendedCity.cityName)}</h4><strong>${currency(calculation.recommendedCity.costUsd)}/мес</strong></div>` : '<p>Город не определён.</p>'}</section>
    <p class="result-note">Статус исследовательского пакета: ${html(calculation.country.researchStatus || 'не указан')}. Он не равен статусу конкретного маршрута: даже в исследованной стране у отдельного кейса могут оставаться неподтверждённые условия. Расчёт: ${html(calculation.calculatedAt?.slice(0, 10))}. Курс валют: ${html(calculationContext.fx.as_of?.slice(0, 10))}, источник ${html(calculationContext.fx.source)}. Результат предварительный и не является юридическим обещанием.</p></div></details>`;
}

function calculateAllCountries() {
  return calculateCountries(currentProfile, [spainData, uruguayData], calculationContext, () => spainAdapter);
}

function renderResult(calculation, changed = false) {
  $('#result').innerHTML = `<div class="comparison-intro"><h2>Сравнение стран</h2><p>Одна анкета независимо проверена для Испании и Уругвая.</p></div>${calculation.results.map((country) => renderCountryResult(country, changed)).join('')}`;
  if ($('#recalculate')) $('#recalculate').addEventListener('click', recalculateWithFollowUp);
}

function switchToResult(calculation, changed = false) {
  renderResult(calculation, changed);
  $('#questionnaireView').hidden = true;
  $('#resultView').hidden = false;
  $('#heroTitle').textContent = 'Ваш результат';
  $('#heroSubtitle').textContent = 'Мы независимо проверили варианты Испании и Уругвая и отдельно оценили семейные условия.';
  const p = currentProfile;
  $('#resultProfileSummary').innerHTML = `<div class="summary-row"><span>Гражданство</span><b>РФ</b></div><div class="summary-row"><span>Семья</span><b>${html(familyLabel(p))}</b></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function recalculateWithFollowUp() {
  const answer = value('socialSecurityPlan');
  if (!answer) { showToast('Выберите ответ или оставьте предварительный результат'); return; }
  currentProfile.route_specific_answers = { ...currentProfile.route_specific_answers, ES_DNV: { social_security_plan: answer } };
  switchToResult(calculateAllCountries(), true);
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
    const simple = ['currentCountry','currentStatus','relationshipType','primaryType','primarySourceCountry','primaryBankCountry','primaryAmount','primaryCurrency','primaryEvidence','additionalType','additionalSourceCountry','additionalBankCountry','additionalAmount','additionalCurrency','additionalEvidence','partnerType','partnerSourceCountry','partnerBankCountry','partnerAmount','partnerCurrency','partnerEvidence','longTermGoal','physicalPresence','languageExamReadiness','keepRuCitizenship','monthlyBudget','budgetCurrency','citySize','dogBreed','otherPetNotes','medicalDetails'];
    simple.forEach((id) => { if ($(`#${id}`) && a[id] != null) $(`#${id}`).value = a[id]; });
    setCheckboxes('applicationMethod', a.applicationMethods || (a.applicationMethod ? [a.applicationMethod] : [])); setRadio('hasPartner', (a.hasPartner ?? a.partnerIncluded) ? 'YES' : 'NO'); setRadio('partnerIncluded', a.partnerIncluded ? 'YES' : 'NO'); setRadio('petType', a.petTypes?.[0]);
    setCheckboxes('climate', a.climates || (a.climate ? [a.climate] : []));
    ['lgbtEnabled','schoolNeeded','hasAdditionalIncome','partnerHasIncome','budgetUnknown','medicalEnabled','specificMedicineRequired','regularCareRequired'].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).checked = Boolean(a[id]); });
    $('#childrenCount').value = String(a.childAges?.length ?? ''); syncChildren(); $$('#childAges input').forEach((input, index) => { input.value = a.childAges[index] ?? ''; });
    $('#specialCircumstance').value = a.specialCircumstances?.[0] || '';
    currentProfile = a.routeSpecificAnswers ? { route_specific_answers: a.routeSpecificAnswers } : null;
    syncConditional(); return true;
  } catch { localStorage.removeItem(DRAFT_KEY); return false; }
}

function clearAll() { localStorage.removeItem(DRAFT_KEY); form.reset(); $('#childAges').innerHTML = ''; currentProfile = null; syncChildren(); syncConditional(); showStep(1, false); showToast('Анкета очищена'); }

$('#gateYes').addEventListener('click', () => { $('#citizenshipGate').hidden = true; $('#questionnaireView').hidden = false; showStep(1); });
$('#gateNo').addEventListener('click', () => { $('#gateNotice').hidden = false; $('#gateNotice').focus(); });
$('#nextStep').addEventListener('click', () => { if (validateStep(currentStep)) showStep(currentStep + 1); });
$('#prevStep').addEventListener('click', () => showStep(currentStep - 1));
$('#childrenCount').addEventListener('change', () => { syncChildren(); renderProfileSummary(profile()); });
$$('input[name="applicationMethod"]').forEach((input) => input.addEventListener('change', () => {
  const methods = $$('input[name="applicationMethod"]');
  if (input.value === 'ANY' && input.checked) methods.forEach((item) => { if (item !== input) item.checked = false; });
  else if (input.checked) methods.find((item) => item.value === 'ANY').checked = false;
}));
$$('input[name="climate"]').forEach((input) => input.addEventListener('change', () => {
  const climates = $$('input[name="climate"]');
  if (input.value === 'ANY' && input.checked) climates.forEach((item) => { if (item !== input) item.checked = false; });
  else if (input.checked) climates.find((item) => item.value === 'ANY').checked = false;
}));
form.addEventListener('change', () => { syncConditional(); renderProfileSummary(profile()); });
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
