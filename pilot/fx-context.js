export const FX_ENDPOINT = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR&providers=ECB';

export class CalculationContextLoadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CalculationContextLoadError';
    this.code = 'CALCULATION_CONTEXT_INCOMPLETE';
    this.details = details;
  }
}

function parseRate(payload) {
  const row = Array.isArray(payload) ? payload.find((item) => item?.quote === 'EUR') : payload;
  const rate = Number(row?.rate ?? row?.rates?.EUR);
  const asOf = row?.date ?? row?.as_of;
  if (!(rate > 0) || !asOf || !Number.isFinite(Date.parse(asOf))) {
    throw new CalculationContextLoadError('Источник валютного курса вернул некорректные данные.');
  }
  return { rate, asOf };
}

export async function loadCalculationContext({ fetchImpl = globalThis.fetch, now = new Date(), maxAgeHours = 96 } = {}) {
  try {
    const response = await fetchImpl(FX_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!response?.ok) throw new CalculationContextLoadError(`Источник валютного курса недоступен (HTTP ${response?.status ?? 'unknown'}).`);
    const { rate, asOf } = parseRate(await response.json());
    const ageMs = now.getTime() - Date.parse(asOf);
    if (ageMs > maxAgeHours * 3600000 || ageMs < -24 * 3600000) {
      throw new CalculationContextLoadError('Доступный валютный курс устарел.', { asOf, maxAgeHours });
    }
    return {
      calculation_date: now.toISOString(),
      engine_version: '2.1.0',
      fx: { base_currency: 'USD', rates: { EUR: rate }, source: 'Frankfurter / ECB', as_of: asOf, max_age_hours: maxAgeHours },
    };
  } catch (error) {
    if (error?.code === 'CALCULATION_CONTEXT_INCOMPLETE') throw error;
    throw new CalculationContextLoadError('Не удалось загрузить расчётный контекст.', { cause: error?.message });
  }
}
