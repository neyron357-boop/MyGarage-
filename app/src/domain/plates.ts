import type { Emirate, Lang, Plate } from './types';

export const EMIRATES: { code: Emirate; en: string; ru: string }[] = [
  { code: 'DXB', en: 'Dubai', ru: 'Дубай' },
  { code: 'SHJ', en: 'Sharjah', ru: 'Шарджа' },
  { code: 'AUH', en: 'Abu Dhabi', ru: 'Абу-Даби' },
  { code: 'AJM', en: 'Ajman', ru: 'Аджман' },
  { code: 'RAK', en: 'Ras Al Khaimah', ru: 'Рас-эль-Хайма' },
  { code: 'UAQ', en: 'Umm Al Quwain', ru: 'Умм-эль-Кайвайн' },
  { code: 'FUJ', en: 'Fujairah', ru: 'Фуджейра' },
];

export function normalizePlatePart(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePlate(p: Plate): Plate {
  return { emirate: p.emirate, code: normalizePlatePart(p.code), number: normalizePlatePart(p.number) };
}

/** Search key stored on the vehicle: code + number, e.g. "A12345". */
export function plateSearchKey(p: Plate): string {
  const n = normalizePlate(p);
  return `${n.code}${n.number}`;
}

export function emirateName(e: Emirate, lang: Lang): string {
  const found = EMIRATES.find((x) => x.code === e);
  return found ? found[lang] : e;
}

/** "Dubai A 12345" */
export function formatPlate(p: Plate, lang: Lang = 'en'): string {
  const n = normalizePlate(p);
  return [emirateName(n.emirate, lang), n.code, n.number].filter(Boolean).join(' ');
}

export function isPlateValid(p: Plate): boolean {
  const n = normalizePlate(p);
  return n.number.length >= 1 && n.number.length <= 6 && n.code.length <= 3;
}

/** Does a search query match a plate key? Query may contain spaces/dashes. */
export function plateMatches(key: string, query: string): boolean {
  const q = normalizePlatePart(query);
  return q.length > 0 && key.includes(q);
}
