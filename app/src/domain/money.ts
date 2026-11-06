import type { Lang } from './types';

/** Round half away from zero (so -2.5 -> -3, 2.5 -> 3). */
export function roundFils(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

/** Parse a user-entered amount in AED ("1 234,50", "1234.5") to fils. Returns null if invalid. */
export function parseAed(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? roundFils(input * 100) : null;
  const s = input.replace(/\s|AED|د\.إ/gi, '').replace(',', '.');
  if (s === '' || !/^-?\d*(\.\d*)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? roundFils(n * 100) : null;
}

export function filsToAed(fils: number): number {
  return fils / 100;
}

const formatters: Record<string, Intl.NumberFormat> = {};
function nf(lang: Lang): Intl.NumberFormat {
  const key = lang;
  if (!formatters[key]) {
    formatters[key] = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return formatters[key];
}

let defaultLang: Lang = 'ru';

/** Language used when a caller does not pass one (follows the UI language). */
export function setDefaultMoneyLang(lang: Lang) {
  defaultLang = lang;
}

/** "1,234.50 AED" (en) / "1 234,50 AED" (ru). */
export function formatAed(fils: number, lang: Lang = defaultLang, withCurrency = true): string {
  const s = nf(lang).format(fils / 100).replace(/ /g, ' ');
  return withCurrency ? `${s} AED` : s;
}
