export const FX_ENDPOINT = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,ARS,MXN,BRL';

export class CalculationContextLoadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CalculationContextLoadError';
    this.code = 'CALCULATION_CONTEXT_INCOMPLETE';
    this.details = details;
  }
}

function parseRates(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.rates
    ? Object.entries(payload.rates).map(([quote, rate]) => ({ quote, rate, date: payload.date ?? payload.as_of }))
    : [payload];
  const required = ['EUR', 'ARS', 'MXN', 'BRL'];
  const rates = {};
  const dates = [];
  for (const quote of required) {
    const row = rows.find((item) => item?.quote === quote);
    const rate = Number(row?.rate);
    const date = row?.date ?? row?.as_of;
    if (!(rate > 0) || !date || !Number.isFinite(Date.parse(date))) {
      throw new CalculationContextLoadError(`Источник валютного курса не вернул корректный курс ${quote}.`, { currency: quote });
    }
    rates[quote] = rate;
    dates.push(date);
  }
  const asOf = dates.sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  return { rates, asOf };
}

export async function loadCalculationContext({ fetchImpl = globalThis.fetch, now = new Date(), maxAgeHours = 96 } = {}) {
  try {
    const response = await fetchImpl(FX_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!response?.ok) throw new CalculationContextLoadError(`Источник валютного курса недоступен (HTTP ${response?.status ?? 'unknown'}).`);
    const { rates, asOf } = parseRates(await response.json());
    const ageMs = now.getTime() - Date.parse(asOf);
    if (ageMs > maxAgeHours * 3600000 || ageMs < -24 * 3600000) {
      throw new CalculationContextLoadError('Доступный валютный курс устарел.', { asOf, maxAgeHours });
    }
    return {
      calculation_date: now.toISOString(),
      engine_version: '7.0.2',
      fx: { base_currency: 'USD', rates, source: 'Frankfurter', as_of: asOf, max_age_hours: maxAgeHours },
    };
  } catch (error) {
    if (error?.code === 'CALCULATION_CONTEXT_INCOMPLETE') throw error;
    throw new CalculationContextLoadError('Не удалось загрузить расчётный контекст.', { cause: error?.message });
  }
}
