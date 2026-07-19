import { CalculationContextError, ProfileContractError } from './calculate-country.js';

const currencyCode = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function convertMoney(money, targetCurrency, calculationContext, field) {
  if (money == null) return null;
  const amount = Number(money.amount);
  const sourceCurrency = money.currency;
  if (!Number.isFinite(amount) || amount < 0 || !currencyCode(sourceCurrency)) {
    throw new ProfileContractError(`Некорректная денежная сумма в ${field}.`, { field });
  }
  if (!currencyCode(targetCurrency)) throw new TypeError('targetCurrency must be an ISO 4217 code');
  const fx = calculationContext?.fx;
  const baseCurrency = fx?.base_currency;
  if (!currencyCode(baseCurrency)) {
    throw new CalculationContextError('В расчётном контексте отсутствует базовая валюта.', { field: 'fx.base_currency' });
  }
  const rateFor = (currency) => {
    if (currency === baseCurrency) return 1;
    const rate = Number(fx?.rates?.[currency]);
    if (!(rate > 0)) {
      throw new CalculationContextError(`Отсутствует курс ${currency} относительно ${baseCurrency}.`, { currency, baseCurrency, field });
    }
    return rate;
  };
  const sourceRate = rateFor(sourceCurrency);
  const targetRate = rateFor(targetCurrency);
  const baseAmount = amount / sourceRate;
  const convertedAmount = baseAmount * targetRate;
  return {
    originalAmount: amount,
    originalCurrency: sourceCurrency,
    baseCurrency,
    baseAmount,
    targetCurrency,
    convertedAmount,
    appliedRate: targetRate / sourceRate,
    sourceRate,
    targetRate,
    rateAsOf: fx.as_of,
    rateSource: fx.source,
  };
}
