import { calculateCountry } from './engine/calculate-country.js?v=0.12.3';
import { legacyPilotProfileToUniversal, spainAdapter } from './countries/spain-adapter.js?v=0.12.3';

export {
  ROUTE_STATUSES,
  STATUS_LABELS_RU,
  COUNTRY_GROUP_LABELS_RU,
  resolveStatusConflict,
} from './engine/status-contract.js?v=0.12.3';
export { selectBestVariant } from './engine/select-best-route.js?v=0.12.3';

export function calculateSpain(profile, data, calculationContext) {
  const strictProfile = profile?.schema_version === 'user-profile-v1'
    ? profile
    : legacyPilotProfileToUniversal(profile);
  return calculateCountry(strictProfile, data, calculationContext, spainAdapter);
}
