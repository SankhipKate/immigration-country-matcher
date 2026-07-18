import {
  calculateSpain,
  STATUS_LABELS_RU,
  COUNTRY_GROUP_LABELS_RU,
} from '../js/spain-calculator.js';

const form = document.querySelector('#profile-form');
const resultRoot = document.querySelector('#result');
const submitButton = document.querySelector('#calculate');
let spainData;

const currency = (value, code = 'USD', digits = 0) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function readProfile() {
  const get = (id) => document.querySelector(`#${id}`).value;
  const checked = (id) => document.querySelector(`#${id}`).checked;
  return {
    applicationNationality: 'RU',
    plannedBasis: get('plannedBasis'),
    currentLocation: get('currentLocation'),
    legalResidence: get('legalResidence') === 'YES',
    monthlyIncomeUsd: Number(get('monthlyIncomeUsd')),
    eurUsdRate: Number(get('eurUsdRate')),
    bankCountry: get('bankCountry'),
    socialSecurityPlan: get('socialSecurityPlan'),
    adults: Number(get('adults')),
    children: Number(get('children')),
    relationshipType: get('relationshipType'),
    sameSexFamily: checked('sameSexFamily'),
    needsFamilyVisa: checked('needsFamilyVisa'),
    schoolNeeded: checked('schoolNeeded'),
    goal: get('goal'),
    monthsPerYear: Number(get('monthsPerYear')),
    languageReadiness: get('languageReadiness'),
    keepRuCitizenship: get('keepRuCitizenship'),
    monthlyBudgetUsd: Number(get('monthlyBudgetUsd')),
    citySize: get('citySize'),
    pet: get('pet'),
    dogBreed: get('dogBreed'),
    medicineRequired: checked('medicineRequired'),
  };
}

function statusClass(status) {
  if (status === 'SUITABLE') return 'positive';
  if (status === 'SUITABLE_WITH_CONDITIONS' || status === 'PRELIMINARY_SUITABLE') return 'conditional';
  if (status === 'UNSUITABLE') return 'negative';
  return 'review';
}

function list(title, items, className = '') {
  if (!items?.length) return '';
  return `
    <section class="result-section ${className}">
      <h3>${escapeHtml(title)}</h3>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>`;
}

function renderRouteTable(routes) {
  return `
    <details class="route-details">
      <summary>Как оценены все шесть маршрутов</summary>
      <div class="route-list">
        ${routes.map((route) => `
          <article class="route-row">
            <div>
              <b>${escapeHtml(route.routeName)}</b>
              <span>${route.thresholdEur == null ? 'Порог определяется индивидуально' : `Семейный порог: ${currency(route.thresholdEur, 'EUR')}/мес`}</span>
            </div>
            <span class="status ${statusClass(route.routeStatus)}">${escapeHtml(route.statusLabel)}</span>
          </article>
        `).join('')}
      </div>
    </details>`;
}

function renderCities(cities, budgetUsd) {
  if (!cities.length) {
    return '<section class="result-section"><h3>Города</h3><p>Города нужного размера в пилотном наборе не найдены.</p></section>';
  }
  return `
    <section class="result-section">
      <h3>Города</h3>
      <div class="city-list">
        ${cities.map((city, index) => `
          <article class="city-card ${index === 0 ? 'recommended' : ''}">
            <div><b>${escapeHtml(city.cityName)}</b>${index === 0 ? '<span>Рекомендуемый из исследованных</span>' : ''}</div>
            <strong>${currency(city.costUsd)}/мес</strong>
            <p>${budgetUsd > 0 ? `Бюджет: ${city.budgetFit === 'MEETS' ? 'проходит' : 'не проходит'}` : 'Бюджет не задан'} · ${escapeHtml(city.climate)} · ${escapeHtml(city.airport)}</p>
            ${city.missing.length ? `<small>${escapeHtml(city.missing.join(' '))}</small>` : ''}
          </article>
        `).join('')}
      </div>
    </section>`;
}

function renderSources(sources) {
  return `
    <section class="result-section">
      <h3>Источники результата</h3>
      <div class="source-list">
        ${sources.map((source) => `
          <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
            <b>${escapeHtml(source.title)}</b>
            <span>${escapeHtml(source.authority_name)} · проверено ${escapeHtml(source.accessed_at)}</span>
          </a>
        `).join('')}
      </div>
    </section>`;
}

function renderResult(calculation) {
  const route = calculation.bestRoute;
  if (!route) {
    resultRoot.innerHTML = '<div class="empty"><b>Расчёт не выполнен</b><p>В данных нет доступных маршрутов.</p></div>';
    return;
  }

  resultRoot.innerHTML = `
    <article class="result-card">
      <div class="result-head">
        <div>
          <span class="eyebrow">Испания · пакет ${escapeHtml(calculation.schemaVersion)}</span>
          <h2>${escapeHtml(calculation.country.groupLabel)}</h2>
          <p>Лучший маршрут из шести: <b>${escapeHtml(route.routeName)}</b></p>
        </div>
        <span class="status large ${statusClass(route.routeStatus)}">${escapeHtml(STATUS_LABELS_RU[route.routeStatus])}</span>
      </div>

      <div class="key-grid">
        <div><span>Доход после пересчёта</span><b>${currency(route.incomeEur, 'EUR')}</b></div>
        <div><span>Требование маршрута</span><b>${route.thresholdEur == null ? 'Индивидуально' : currency(route.thresholdEur, 'EUR')}</b></div>
        <div><span>Гражданство подачи</span><b>${escapeHtml(route.applicationNationality)}</b></div>
        <div><span>Город</span><b>${escapeHtml(calculation.recommendedCity?.cityName || 'Не выбран')}</b></div>
      </div>

      ${list('Подтверждённые препятствия', route.blockers, 'danger')}
      ${list('Условия', route.conditions, 'warning')}
      ${list('Каких данных не хватает', [...route.missing, ...calculation.practicalMissing], 'review-box')}
      ${list('Нужна индивидуальная проверка', route.review, 'review-box')}
      ${list('Какие ответы нужно уточнить', route.preliminary, 'warning')}

      <section class="result-section two-columns">
        <div>
          <h3>ПМЖ и гражданство</h3>
          <p>ПМЖ: ${escapeHtml(route.longTerm?.years_to_pr ?? 'требует проверки')} лет.</p>
          <p>Гражданство: ${escapeHtml(route.longTerm?.nominal_years_to_citizenship ?? 'требует проверки')} лет по общему правилу.</p>
          <p>Язык: ${escapeHtml(route.longTerm?.required_language_level || 'не указан')}.</p>
        </div>
        <div>
          <h3>Работа и семья</h3>
          <p>${escapeHtml(route.work?.local_work_rights || 'Права на работу требуют проверки.')}</p>
          <p>${escapeHtml(route.family?.dependent_work_rights || 'Семейные рабочие права требуют проверки.')}</p>
        </div>
      </section>

      ${renderCities(calculation.cities, calculation.profile.monthlyBudgetUsd)}
      ${renderRouteTable(calculation.routes)}
      ${renderSources(calculation.sources)}

      <p class="data-note">Статус исследования: ${escapeHtml(calculation.country.researchStatus)} · уверенность ${escapeHtml(calculation.country.confidence)}. Результат не заменяет проверку документов и актуальных правил перед подачей.</p>
    </article>`;
}

async function init() {
  try {
    const response = await fetch('../data/spain-research-v2.2.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    spainData = await response.json();
    submitButton.disabled = false;
    form.requestSubmit();
  } catch (error) {
    resultRoot.innerHTML = `<div class="empty error"><b>Не удалось загрузить данные Испании</b><p>${escapeHtml(error.message)}</p></div>`;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!spainData) return;
  try {
    renderResult(calculateSpain(readProfile(), spainData));
    if (window.innerWidth < 900) resultRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    resultRoot.innerHTML = `<div class="empty error"><b>Ошибка расчёта</b><p>${escapeHtml(error.message)}</p></div>`;
  }
});

document.querySelector('#pet').addEventListener('change', (event) => {
  document.querySelector('#dogBreedField').hidden = event.target.value !== 'DOG';
});

document.querySelector('#adults').addEventListener('change', (event) => {
  const hasPartner = Number(event.target.value) > 1;
  document.querySelector('#relationshipBlock').hidden = !hasPartner;
});

init();
