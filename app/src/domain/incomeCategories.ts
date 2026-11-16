import type { IncomeCategory, Lang } from './types';

/*
 * Categories of money in (v0.26): the app's four and the garage's own, made like the expense ones — a name in each
 * language and «offered or not» (`active`). An income keeps the category's code, so one renamed or taken out still
 * shows on its entries as the garage calls it.
 */

/** Money in of no other kind: always offered (a money sheet's category the app does not know comes in as it). */
export const KEPT_INCOME = 'other';

/** In their order: the app's first, then the garage's own as they were added. */
export const byPlace = (a: IncomeCategory, b: IncomeCategory) => a.position - b.position || a.code.localeCompare(b.code);

/** Its name in this language (the other one's when this one is empty). */
export function incomeCategoryName(c: Pick<IncomeCategory, 'nameRu' | 'nameEn'>, lang: Lang): string {
  return (lang === 'ru' ? c.nameRu || c.nameEn : c.nameEn || c.nameRu).trim();
}

const plain = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The category of this name (typed, or a money sheet's), in either language, whatever the case and spaces. */
export function incomeCategoryNamed(list: IncomeCategory[], name: string): IncomeCategory | undefined {
  const n = plain(name);
  if (!n) return undefined;
  return list.find((c) => plain(c.nameRu) === n || plain(c.nameEn) === n);
}

/**
 * A new name typed in this language: a category named the same in both (the garage's own, «Emil») is renamed in
 * both; one with a name of its own in each (the app's) — in this language only.
 */
export function renamedIn(c: IncomeCategory, name: string, lang: Lang): IncomeCategory {
  const n = name.trim().replace(/\s+/g, ' ');
  if (plain(c.nameRu) === plain(c.nameEn)) return { ...c, nameRu: n, nameEn: n };
  return lang === 'ru' ? { ...c, nameRu: n } : { ...c, nameEn: n };
}
