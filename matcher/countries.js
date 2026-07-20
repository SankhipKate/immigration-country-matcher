const ISO_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');

const namesRu = new Intl.DisplayNames(['ru'], { type: 'region' });
const namesEn = new Intl.DisplayNames(['en'], { type: 'region' });
const records = ISO_CODES.map((code) => ({ code, name: namesRu.of(code) || code, nameEn: namesEn.of(code) || code }));
const normalized = (value) => String(value || '').trim().toLocaleLowerCase('ru-RU');
const byName = new Map(records.flatMap((record) => [[normalized(record.name), record.code], [normalized(record.nameEn), record.code]]));
const searchPriority = new Map([['PH', 1]]);

export function countryOptions() {
  return records.map(({ code, name, nameEn }) => ({ code, name, nameEn, label: `${name} / ${nameEn} — ${code}` }));
}

export function searchCountries(query, limit = 8) {
  const needle = normalized(query);
  if (!needle) return [];
  return countryOptions().map((record) => {
    const values = [normalized(record.name), normalized(record.nameEn), normalized(record.code)];
    const score = values.some((value) => value === needle) ? 0
      : values.some((value) => value.startsWith(needle)) ? 1
        : values.some((value) => value.includes(needle)) ? 2 : 99;
    return { ...record, score };
  }).filter(({ score }) => score < 99)
    .sort((left, right) => left.score - right.score || (searchPriority.get(right.code) || 0) - (searchPriority.get(left.code) || 0) || left.name.localeCompare(right.name, 'ru'))
    .slice(0, limit)
    .map(({ score, ...record }) => record);
}

export function parseCountryCode(value) {
  const input = String(value || '').trim();
  const suffix = input.match(/(?:—|-)\s*([A-Z]{2})$/i)?.[1]?.toUpperCase();
  if (suffix && records.some((record) => record.code === suffix)) return suffix;
  const prefix = input.slice(0, 2).toUpperCase();
  if (/^[A-Z]{2}$/.test(prefix) && records.some((record) => record.code === prefix) && (input.length === 2 || /\s|—|-/.test(input[2] || ''))) return prefix;
  return byName.get(normalized(input)) || '';
}
