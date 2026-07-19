import { SELECTION_PREFERENCE_RANK } from './status-contract.js';

const FIT_RANK = Object.freeze({ MEETS: 2, UNKNOWN: 1, NOT_APPLICABLE: 1, DOES_NOT_MEET: 0 });
const fit = (value) => FIT_RANK[value] ?? FIT_RANK.UNKNOWN;
const count = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function routeSelectionKey(route) {
  return [
    SELECTION_PREFERENCE_RANK[route.routeStatus] ?? 0,
    fit(route.goalFit), fit(route.applicationFit), fit(route.familyFit),
    fit(route.incomeTypeFit), fit(route.incomeFit),
    -count(route.countryMissingCount), -count(route.clientMissingCount),
    -count(route.conditionsCount), route.scenarioAffinity ? 1 : 0,
  ];
}

export function compareRouteEvaluations(a, b) {
  const left = routeSelectionKey(a);
  const right = routeSelectionKey(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return String(a.routeId ?? '').localeCompare(String(b.routeId ?? ''));
}

export function selectBestRoute(routes) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  return [...routes].sort(compareRouteEvaluations)[0];
}

export const selectBestVariant = selectBestRoute;
