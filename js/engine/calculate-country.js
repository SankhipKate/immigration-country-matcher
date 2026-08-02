import { selectBestRoute } from './select-best-route.js?v=7.0.2';
import { COUNTRY_GROUP_LABELS_RU } from './status-contract.js?v=7.0.2';
import { convertMoney } from './currency.js?v=7.0.2';

const EUROZONE_COUNTRY_IDS = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
]);


export class CalculationContextError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CalculationContextError';
    this.code = 'CALCULATION_CONTEXT_INCOMPLETE';
    this.details = details;
  }
}

export class ProfileContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProfileContractError';
    this.code = 'PROFILE_INCOMPLETE';
    this.details = details;
  }
}

const requireMethod = (adapter, name) => {
  if (typeof adapter?.[name] !== 'function') throw new TypeError(`countryAdapter.${name} must be a function`);
};

export function calculateApplicantProvableIncome(profile, resultCurrency, calculationContext) {
  const additionalSources = Array.isArray(profile?.income?.additional_sources)
    ? profile.income.additional_sources
    : [];
  const applicantSources = [profile?.income?.primary, ...additionalSources].filter(Boolean);
  const conversions = applicantSources
    .map((source, index) => convertMoney(
      source?.monthly_provable ?? null,
      resultCurrency,
      calculationContext,
      index === 0 ? 'income.primary.monthly_provable' : `income.additional_sources[${index - 1}].monthly_provable`,
    ))
    .filter(Boolean);
  return {
    amount: conversions.length
      ? conversions.reduce((sum, conversion) => sum + conversion.convertedAmount, 0)
      : null,
    currency: resultCurrency,
    conversions,
  };
}

export function calculateCountry(profile, countryPackage, calculationContext, countryAdapter) {
  if (!profile || typeof profile !== 'object') throw new TypeError('profile is required');
  if (!countryPackage || typeof countryPackage !== 'object') throw new TypeError('countryPackage is required');
  if (!calculationContext || typeof calculationContext !== 'object') throw new TypeError('calculationContext is required');
  for (const name of ['normalizeProfile', 'buildIndexes', 'evaluateRoute', 'evaluatePractical', 'determineCountryGroup', 'collectSources']) requireMethod(countryAdapter, name);

  countryAdapter.validateContext?.(profile, countryPackage, calculationContext);
  if (!Array.isArray(profile.citizenships) || profile.citizenships.length === 0) {
    throw new ProfileContractError('Строгий профиль должен содержать хотя бы одно гражданство.', { field: 'citizenships' });
  }
  const normalizedProfile = countryAdapter.normalizeProfile(profile, calculationContext);
  const indexes = countryAdapter.buildIndexes(countryPackage);
  const packageRoutes = Array.isArray(countryPackage.routes) ? countryPackage.routes : [];
  const availableRoutes = typeof countryAdapter.listRoutes === 'function'
    ? countryAdapter.listRoutes(countryPackage, normalizedProfile, indexes)
    : packageRoutes;
  if (!Array.isArray(availableRoutes)) throw new TypeError('countryAdapter.listRoutes must return an array');
  const routes = availableRoutes.map((route) => {
    const citizenshipVariants = normalizedProfile.citizenships.map((applicationNationality) =>
      countryAdapter.evaluateRoute(route, indexes, {
        ...normalizedProfile,
        applicationNationality,
      }, calculationContext)
    );
    const bestVariant = selectBestRoute(citizenshipVariants);
    return {
      ...bestVariant,
      citizenshipVariants,
      variants: citizenshipVariants,
    };
  });
  const bestRoute = selectBestRoute(routes);
  const practicalResult = countryAdapter.evaluatePractical(countryPackage, normalizedProfile, calculationContext);
  const lgbtResult = countryAdapter.evaluateLgbt?.(countryPackage, normalizedProfile, indexes, calculationContext) || null;
  const group = countryAdapter.determineCountryGroup(bestRoute, practicalResult, normalizedProfile, routes);

  const countryId = countryPackage.country?.country_id ?? countryPackage.country_id;
  const countryName = countryPackage.country?.name_ru ?? countryPackage.country_name_ru ?? countryPackage.name ?? countryId;
  const resultCurrency = EUROZONE_COUNTRY_IDS.has(countryId) ? 'EUR' : 'USD';
  const applicantProvableIncome = calculateApplicantProvableIncome(profile, resultCurrency, calculationContext);

  return {
    schemaVersion: countryPackage.schema_version,
    calculatedAt: new Date().toISOString(),
    profile: normalizedProfile,
    country: {
      countryId,
      name: countryName,
      researchStatus: countryPackage.country?.country_research_status ?? countryPackage.completeness?.country_ready_status,
      confidence: countryPackage.country?.confidence ?? null,
      resultCurrency,
      group,
      groupLabel: COUNTRY_GROUP_LABELS_RU[group],
    },
    applicantProvableIncome,
    bestRoute,
    routes,
    ...practicalResult,
    lgbt: lgbtResult,
    practicalMissing: [...new Set(countryAdapter.collectPracticalMissing?.(countryPackage, normalizedProfile, practicalResult) || [])],
    sources: countryAdapter.collectSources(countryPackage, indexes, bestRoute, practicalResult),
  };
}
