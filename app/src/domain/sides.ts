import { lineName } from './items';
import type { OrderItem } from './types';

/*
 * How many a part's name asks for (v0.70, the user: «иногда я забываю добавлять количество — деталь на обе стороны
 * закупаю, а в инвойсе идёт одна сторона и цена за одну сторону. Это критический момент, с которым я теряю деньги.
 * Нужно, чтобы приложение из названия уже поняло, что идут обе стороны, и предупреждало. Без ИИ»). Read off the name
 * by its words only: both sides («LEFT & RIGHT», «LH/RH», «BOTH SIDES», «PAIR», «FRONT & REAR», «ЛЕВЫЙ И ПРАВЫЙ»,
 * «ОБЕ СТОРОНЫ», «ПАРА») — two; a count said («X4», «4 PCS», «SET OF 4», «ALL FOUR», «4 ШТ») — that many. A side alone
 * («LH», «FRONT LEFT»), a set («BRAKE PADS SET») say nothing. A part whose quantity is less, its price not said to be
 * for all of them (`OrderItem.qtyNoted`), is one to look at before the customer sees it. Pure.
 */

const AND = String.raw`\s*(?:&|AND|\+|\/|,|И)\s*`;
/** Two sides (or two ends) named together. */
const BOTH: RegExp[] = [
  new RegExp(String.raw`\bLEFT${AND}RIGHT\b`),
  new RegExp(String.raw`\bRIGHT${AND}LEFT\b`),
  new RegExp(String.raw`\bL\.?H\.?${AND}R\.?H\.?(?![A-Z])`),
  new RegExp(String.raw`\bR\.?H\.?${AND}L\.?H\.?(?![A-Z])`),
  /\bL\s*(?:&|\+|\/)\s*R\b/,
  /\bR\s*(?:&|\+|\/)\s*L\b/,
  /\bBOTH(?:\s+SIDES?)?\b/,
  /\bPAIR\b/,
  new RegExp(String.raw`\bFRONT${AND}REAR\b`),
  new RegExp(String.raw`\bREAR${AND}FRONT\b`),
  new RegExp(String.raw`\bDRIVER${AND}PASSENGER\b`),
  /ЛЕВ[А-ЯЁ]*\s*(?:И|&|\+|\/|,)\s*ПРАВ/,
  /ПРАВ[А-ЯЁ]*\s*(?:И|&|\+|\/|,)\s*ЛЕВ/,
  /ОБЕ\s+СТОРОН/,
  /(?:^|[^А-ЯЁ])(?:ПАРА|КОМПЛЕКТ\s+ИЗ\s+2)(?![А-ЯЁ])/,
  /ПЕРЕДН[А-ЯЁ]*\s*(?:И|&|\+|\/|,)\s*ЗАДН/,
];
/** A count said in the name. */
const COUNT: RegExp[] = [
  /(?:^|[\s(])[X×]\s*(\d{1,2})(?![\d.,])/,
  /\b(\d{1,2})\s*(?:PCS|PC|PIECES|NOS|UNITS)\b/,
  /\bSET\s+OF\s+(\d{1,2})\b/,
  /(?:^|[^\d])(\d{1,2})\s*ШТ/,
];
const FOUR = /\bALL\s+(?:4|FOUR)\b|\bFOUR\b|\b4\s*(?:WHEELS|TYRES|TIRES|SIDES|DOORS)\b|ВСЕ\s+4|ЧЕТЫРЕ/;

/** How many of it the name asks for — none when it says nothing (or one). */
export function nameCount(title: string): number | undefined {
  const s = lineName(title.trim());
  if (!s) return undefined;
  let n = 0;
  if (BOTH.some((re) => re.test(s))) n = 2;
  if (FOUR.test(s)) n = Math.max(n, 4);
  for (const re of COUNT) {
    const m = re.exec(s);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n >= 2 && n <= 24 ? n : undefined;
}

/**
 * A part whose name asks for more than its quantity: how many its name says. None — it is as many as it says, its price
 * was said to be for all of them, it is the customer's own, or not a part.
 */
export function qtyShort(item: Pick<OrderItem, 'kind' | 'qty' | 'titleEn' | 'titleRu' | 'customerSupplied' | 'qtyNoted'>): number | undefined {
  if (item.kind !== 'part' || item.customerSupplied) return undefined;
  const n = nameCount(item.titleEn || item.titleRu || '');
  if (!n || item.qty >= n || (item.qtyNoted ?? 0) >= n) return undefined;
  return n;
}
