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

const requireMethod = (adapter, name) => {
  if (typeof adapter?.[name] !== 'function') throw new TypeError(`countryAdapter.${name} must be a function`);
};

export function calculateCountry(profile, countryPackage, calculationContext, countryAdapter) {
  if (!profile || typeof profile !== 'object') throw new TypeError('profile is required');
  if (!countryPackage || typeof countryPackage !== 'object') throw new TypeError('countryPackage is required');
  if (!calculationContext || typeof calculationContext !== 'object') throw new TypeError('calculationContext is required');
  for (const name of ['normalizeProfile', 'buildIndexes', 'evaluateRoute', 'evaluatePractical', 'determineCountryGroup', 'collectSources']) requireMethod(countryAdapter, name);

  countryAdapter.validateContext?.(profile, countryPackage, calculationContext);
  const normalizedProfile = countryAdapter.normalizeProfile(profile, calculationContext);
  const indexes = countryAdapter.buildIndexes(countryPackage);
  const routes = (countryPackage.routes || []).map((route) =>
    countryAdapter.evaluateRoute(route, indexes, normalizedProfile, calculationContext)
  );
  const bestRoute = selectBestRoute(routes);
  const practicalResult = countryAdapter.evaluatePractical(countryPackage, normalizedProfile, calculationContext);
  const group = countryAdapter.determineCountryGroup(bestRoute, practicalResult, normalizedProfile);

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
    practicalMissing: [...new Set(countryAdapter.collectPracticalMissing?.(countryPackage, normalizedProfile, practicalResult) || [])],
    sources: countryAdapter.collectSources(countryPackage, indexes, bestRoute, practicalResult),
  };
}
