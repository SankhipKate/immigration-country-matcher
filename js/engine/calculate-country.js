import { selectBestRoute } from './select-best-route.js';
import { COUNTRY_GROUP_LABELS_RU } from './status-contract.js';

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
  const routes = (countryPackage.routes || []).map((route) => {
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

  return {
    schemaVersion: countryPackage.schema_version,
    calculatedAt: new Date().toISOString(),
    profile: normalizedProfile,
    country: {
      countryId: countryPackage.country?.country_id ?? countryPackage.country_id,
      name: countryPackage.country?.name_ru ?? countryPackage.name,
      researchStatus: countryPackage.country?.country_research_status,
      confidence: countryPackage.country?.confidence,
      group,
      groupLabel: COUNTRY_GROUP_LABELS_RU[group],
    },
    bestRoute,
    routes,
    ...practicalResult,
    lgbt: lgbtResult,
    practicalMissing: [...new Set(countryAdapter.collectPracticalMissing?.(countryPackage, normalizedProfile, practicalResult) || [])],
    sources: countryAdapter.collectSources(countryPackage, indexes, bestRoute, practicalResult),
  };
}
