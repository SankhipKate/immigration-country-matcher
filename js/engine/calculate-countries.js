import { calculateCountry } from './calculate-country.js';

export function calculateCountries(profile, countryPackages, calculationContext, adapterResolver) {
  if (!Array.isArray(countryPackages)) throw new TypeError('countryPackages must be an array');
  if (typeof adapterResolver !== 'function') throw new TypeError('adapterResolver must be a function');
  const results = [];
  const errors = [];
  for (const countryPackage of countryPackages) {
    const countryId = countryPackage?.country?.country_id ?? countryPackage?.country_id ?? null;
    try {
      results.push(calculateCountry(profile, countryPackage, calculationContext, adapterResolver(countryPackage)));
    } catch (error) {
      errors.push({ countryId, code: error.code || 'CALCULATION_FAILED', message: error.message });
    }
  }
  return { calculatedAt: new Date().toISOString(), results, errors };
}
