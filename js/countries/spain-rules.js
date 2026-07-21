export const INCOME_TYPE_BY_SCENARIO = Object.freeze({
  REMOTE_EMPLOYEE: 'EMPLOYEE', REMOTE_CONTRACTOR: 'CONTRACTOR',
  FOREIGN_COMPANY_OWNER: 'COMPANY_OWNER', PASSIVE_INCOME: 'PASSIVE', STUDY: 'OTHER',
  SELF_EMPLOYED_SPAIN: 'BUSINESS_PLAN', INNOVATIVE_PROJECT: 'BUSINESS_PLAN',
  SPANISH_JOB_OFFER: 'SALARY_REVIEW',
  REMOTE_EMPLOYMENT: 'EMPLOYEE', CONTRACTOR: 'CONTRACTOR', FREELANCE_OR_SELF_EMPLOYED: 'CONTRACTOR',
  SOLE_PROPRIETOR: 'BUSINESS_PLAN', COMPANY_OWNER: 'COMPANY_OWNER', PASSIVE_INCOME: 'PASSIVE',
  OTHER_REGULAR_REMOTE_INCOME: 'OTHER',
});

export const ROUTE_RULES = Object.freeze({
  ES_DNV: { incomeTypes: ['EMPLOYEE', 'CONTRACTOR', 'COMPANY_OWNER'], scenarios: ['REMOTE_EMPLOYEE', 'REMOTE_CONTRACTOR', 'FOREIGN_COMPANY_OWNER'], socialSecurityReview: true },
  ES_NLV: { incomeTypes: ['PASSIVE'], scenarios: ['PASSIVE_INCOME'] },
  ES_SELF_EMPLOYED: { scenarios: ['SELF_EMPLOYED_SPAIN'], separateBasis: 'Нужен план самостоятельной деятельности или бизнеса в Испании.', individualReview: true },
  ES_ENTREPRENEUR: { scenarios: ['INNOVATIVE_PROJECT'], separateBasis: 'Нужен инновационный предпринимательский проект, проходящий индивидуальную оценку.', individualReview: true },
  ES_HIGHLY_QUALIFIED: { scenarios: ['SPANISH_JOB_OFFER'], separateBasis: 'Найти предложение квалифицированной работы в Испании и подтвердить высшее образование либо требуемый профессиональный опыт.' },
  ES_STUDENT: { scenarios: ['STUDY'], separateBasis: 'Поступить на подходящую программу обучения.', fundsIncomeType: 'OTHER' },
  UY_PERMANENT: { incomeTypes: ['EMPLOYEE', 'CONTRACTOR', 'COMPANY_OWNER', 'PASSIVE', 'BUSINESS_PLAN', 'OTHER'], scenarios: [], individualReview: true },
  UY_TEMPORARY: { incomeTypes: ['EMPLOYEE', 'CONTRACTOR', 'COMPANY_OWNER', 'PASSIVE', 'BUSINESS_PLAN', 'OTHER'], scenarios: [], individualReview: true },
  UY_DIGITAL_NOMAD: { incomeTypes: ['EMPLOYEE', 'CONTRACTOR', 'COMPANY_OWNER'], scenarios: ['REMOTE_EMPLOYEE', 'REMOTE_CONTRACTOR', 'FOREIGN_COMPANY_OWNER'], meansDeclaration: true },
});
