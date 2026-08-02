import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('canonical v3.2 policy and architecture mirror are byte-for-byte identical', async () => {
  const [canonical, mirror] = await Promise.all([
    read('../source-documents/Каноническая политика статусов маршрута v3.2.md'),
    read('../docs/architecture/ROUTE_STATUS_POLICY_V3_2.md'),
  ]);
  assert.equal(mirror, canonical);
});


test('status-policy compliance checks stay inside the Git repository', async () => {
  const source = await read('./status-policy-v3.2-compliance.test.mjs');
  const retiredInstructionName = ['full-country-research-chatgpt', 'updated.md'].join('-');
  const parentEscape = ["read('", '..', '..'].join('/');
  assert.equal(source.includes(retiredInstructionName), false);
  assert.equal(source.includes(parentEscape), false);
});

test('Portugal and Brazil financial calculations do not read readiness-to-improve answers', async () => {
  const [portugal, brazil] = await Promise.all([
    read('../js/countries/portugal-adapter.js'),
    read('../js/countries/brazil-adapter.js'),
  ]);
  for (const source of [portugal, brazil]) {
    assert.equal(source.includes('ready_to_raise_income'), false);
    assert.equal(source.includes('ready_to_build_savings'), false);
    assert.equal(source.includes('ready_to_add_regular_income'), false);
  }
  assert.equal(portugal.includes('history_months'), false);
  assert.equal(portugal.includes('incomeHistoryMonths'), false);
});

test('research standard 3.0 contains only the v3.2 meaning of suitable with conditions', async () => {
  const standard = await read('../docs/research/templates/research-standard-mvp-v3.md');
  assert.match(standard, /Обязательный стандарт качества 3\.2/);
  assert.match(standard, /Доход ниже обязательного порога означает `UNSUITABLE`/);
  assert.doesNotMatch(standard, /увеличить доход до установленного порога/);
  assert.doesNotMatch(standard, /подтвердить требуемую историю дохода/);
});

test('Andorra publication status is formally blocked until the v3.2 checklist is closed', async () => {
  const [checklist, dataText] = await Promise.all([
    read('../research-backlog/andorra-research-v3/andorra-publication-checklist-v3.2.md'),
    read('../research-backlog/andorra-research-v3/andorra-research-v3.1.json'),
  ]);
  const data = JSON.parse(dataText);
  assert.equal(data.ready_for_publication, false);
  assert.match(checklist, /ПУБЛИКАЦИЯ ЗАБЛОКИРОВАНА/);
  assert.match(checklist, /Международная защита/);
  assert.match(checklist, /полный блок въезда гражданина РФ/i);
});

test('quality standard v3.2 exists and follows the canonical status policy', async () => {
  const [quality, retired] = await Promise.all([
    read('../docs/research/templates/research-quality-standard-v3.2.md'),
    read('../docs/research/templates/research-quality-standard-v3.1.md'),
  ]);

  assert.match(quality, /Стандарт качества исследования страны — версия 3\.2/);
  assert.match(quality, /доход ниже официального порога → `UNSUITABLE`/);
  assert.match(quality, /история дохода.*не проверяются калькулятором/);
  assert.doesNotMatch(quality, /накопить недостающую историю дохода/);
  assert.doesNotMatch(quality, /довести доход или накопления до официального порога/);
  assert.doesNotMatch(quality, /оформить апостиль или перевод/);

  assert.match(retired, /версия 3\.1 \(заменён\)/);
  assert.match(retired, /research-quality-standard-v3\.2\.md/);
  assert.ok(retired.length < 1000, 'v3.1 must remain a short retirement stub');
});

test('all active research instructions reference quality standard v3.2 only', async () => {
  const [researchStandard, countryTemplate, chatgptInstruction] = await Promise.all([
    read('../docs/research/templates/research-standard-mvp-v3.md'),
    read('../docs/research/templates/country-research-template-mvp-v3.md'),
    read('../research-backlog/full-country-research-chatgpt.md'),
  ]);

  for (const source of [researchStandard, countryTemplate, chatgptInstruction]) {
    assert.match(source, /research-quality-standard-v3\.2\.md/);
    assert.doesNotMatch(source, /research-quality-standard-v3\.1\.md/);
  }

  assert.doesNotMatch(chatgptInstruction, /довести доход или накопления до официального порога/);
  assert.doesNotMatch(chatgptInstruction, /накопить обязательную историю дохода/);
  assert.match(chatgptInstruction, /Доход ниже официального порога всегда даёт `UNSUITABLE`/);
  assert.match(chatgptInstruction, /каноническая политика `docs\/architecture\/ROUTE_STATUS_POLICY_V3_2\.md`/);
});

test('Spain treats Russian bank documents as a filing requirement, not a status condition', async () => {
  const spain = await read('../js/countries/spain-adapter.js');
  assert.doesNotMatch(spain, /reviewCondition\('russian_bank_documents/);
  assert.match(spain, /ROUTE_STATUSES\.SUITABLE, 'russian_bank_documents_required'/);
  assert.match(spain, /requirementCodes[^\n]*russian_bank_documents_required/);
});

test('research packages contain no retired income, history, travel, or document conditions', async () => {
  const paths = [
    '../data/mexico-research-v3.0.json',
    '../data/portugal-research-v3.0.json',
    '../data/brazil-research-v3.0.json',
    '../data/paraguay-research-v3.0.json',
  ];
  const packages = await Promise.all(paths.map(read));
  const prohibited = [
    /готов довести доход/i,
    /готов увеличить доход/i,
    /доход может быть увеличен/i,
    /без плана увеличения/i,
    /сформировать требуемую историю/i,
    /при необходимости оформить\/апостилировать/i,
    /при оформлении апостиля/i,
    /при подготовке документов/i,
    /готов приехать для подачи/i,
    /документы дохода или ресурсов ещё нужно сформировать/i,
  ];
  for (const source of packages) {
    for (const pattern of prohibited) assert.doesNotMatch(source, pattern);
  }
});

test('research test profiles do not collect income duration or readiness to raise income', async () => {
  const profiles = await Promise.all([
    read('../docs/research/mexico/mexico-test-profiles-v3.0.json'),
    read('../docs/research/portugal/portugal-test-profiles-v3.0.json'),
    read('../research-backlog/mexico-v3.0/mexico-test-profiles-v3.0.json'),
    read('../research-backlog/portugal-v3.0/portugal-test-profiles-v3.0.json'),
  ]);
  for (const source of profiles) {
    assert.doesNotMatch(source, /ready_to_raise_income/);
    assert.doesNotMatch(source, /income_history_months/);
  }
});
