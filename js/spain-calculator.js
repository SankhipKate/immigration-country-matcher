import { calculateCountry } from './engine/calculate-country.js';
import { spainAdapter } from './countries/spain-adapter.js';

export {
  ROUTE_STATUSES,
  STATUS_LABELS_RU,
  COUNTRY_GROUP_LABELS_RU,
  resolveStatusConflict,
} from './engine/status-contract.js';
export { selectBestVariant } from './engine/select-best-route.js';

export function calculateSpain(profile, data) {
  const eurUsdRate = Number(profile?.eurUsdRate || 1.144);
  const now = new Date();
  return calculateCountry(profile, data, {
    calculation_date: now.toISOString().slice(0, 10),
    engine_version: '1.0.0',
    fx: {
      base_currency: 'USD',
      rates: { EUR: 1 / eurUsdRate },
      source: 'legacy-interface',
      as_of: now.toISOString(),
      max_age_hours: 48,
    },
  }, spainAdapter);
}
