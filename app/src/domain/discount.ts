import { itemAmounts } from './items';
import { roundFils } from './money';
import { netFromGross } from './vat';
import type { ItemKind, OrderItem } from './types';

/**
 * A discount on the job: a percentage of its lines (basis points, 1000 = 10 %) or an amount off the
 * total (gross fils — what the customer pays less). It becomes discount lines (kind `discount`).
 */
export type DiscountSpec = { pctBp: number } | { grossFils: number };

const counted = (i: OrderItem) => i.approvalState === 'draft' || i.approvalState === 'approved';

/** The lines a discount applies to: what goes on the invoice, discounts aside. */
export function discountBase(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => counted(i) && i.kind !== 'discount');
}

/** The job's discount lines that count (to be invoiced or invoiced). */
export function discountLines(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => counted(i) && i.kind === 'discount');
}

export function grossOf(items: OrderItem[]): number {
  return items.reduce((s, i) => s + itemAmounts(i).gross, 0);
}

/** How much the customer saves (gross fils) with this discount on lines worth `baseGross`. */
export function discountGross(spec: DiscountSpec, baseGross: number): number {
  return 'pctBp' in spec ? roundFils((baseGross * spec.pctBp) / 10000) : spec.grossFils;
}

/** The discount now on the job, as it was given: a percentage, an amount, or none. */
export function currentDiscount(items: OrderItem[]): DiscountSpec | null {
  const lines = discountLines(items);
  if (!lines.length) return null;
  const pct = lines.find((i) => i.discountPctBp)?.discountPctBp;
  return pct ? { pctBp: pct } : { grossFils: -grossOf(lines) };
}

export interface DiscountPart {
  rateBp: number;
  grossFils: number;
}

/**
 * One discount line per VAT rate of the lines, each in proportion to their gross: on taxed lines the
 * discount lowers their VAT too, on lines without VAT it carries none.
 */
export function splitDiscount(base: OrderItem[], grossOff: number): DiscountPart[] {
  const byRate = new Map<number, number>();
  for (const i of base) {
    const g = itemAmounts(i).gross;
    if (g > 0) byRate.set(i.vatRateBp, (byRate.get(i.vatRateBp) ?? 0) + g);
  }
  const total = [...byRate.values()].reduce((a, b) => a + b, 0);
  if (grossOff <= 0 || total <= 0) return [];
  const rates = [...byRate.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let left = grossOff;
  const parts: DiscountPart[] = [];
  rates.forEach(([rateBp, g], k) => {
    const share = k === rates.length - 1 ? left : Math.min(left, roundFils((grossOff * g) / total));
    left -= share;
    if (share > 0) parts.push({ rateBp, grossFils: share });
  });
  return parts;
}

/** The price of a discount line: its gross kept to the fils, the VAT taken out of it. */
export function discountPrice(p: DiscountPart): Pick<OrderItem, 'unitPriceFils' | 'unitGrossFils' | 'vatRateBp'> {
  return p.rateBp > 0
    ? { unitPriceFils: netFromGross(p.grossFils, p.rateBp), unitGrossFils: p.grossFils, vatRateBp: p.rateBp }
    : { unitPriceFils: p.grossFils, unitGrossFils: undefined, vatRateBp: 0 };
}

/** Titles of a discount line: "Discount 10%" on the documents, "Скидка 10 %" on a Russian screen. */
export function discountTitles(spec: DiscountSpec): { titleEn: string; titleRu: string } {
  if (!('pctBp' in spec)) return { titleEn: 'Discount', titleRu: 'Скидка' };
  const pct = String(spec.pctBp / 100);
  return { titleEn: `Discount ${pct}%`, titleRu: `Скидка ${pct.replace('.', ',')} %` };
}

/** Totals to pay with round numbers (to 1, 10, 50, 100 AED) below the current one, for one-tap discounts. */
export function roundTotals(grossFils: number): number[] {
  const out: number[] = [];
  for (const step of [100, 1000, 5000, 10000]) {
    const to = Math.floor(grossFils / step) * step;
    if (to > 0 && to < grossFils && !out.includes(to)) out.push(to);
  }
  return out.slice(0, 3);
}

/* ---------------- The discount on documents ---------------- */

/**
 * Whole fils close to `ideal` that add up to exactly `total`: each one is the ideal rounded down or up
 * (the ones that rounding moved furthest in the needed direction give way first).
 */
export function roundToTotal(ideal: number[], total: number): number[] {
  const out = ideal.map((x) => Math.round(x));
  let diff = total - out.reduce((a, b) => a + b, 0);
  while (diff !== 0 && out.length) {
    const step = Math.sign(diff);
    let best = 0;
    for (let i = 1; i < out.length; i++) if ((ideal[i] - out[i]) * step > (ideal[best] - out[best]) * step) best = i;
    out[best] += step;
    diff -= step;
  }
  return out;
}

/** `total` fils split in proportion to the weights, exactly. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return sum > 0 ? roundToTotal(weights.map((w) => (total * w) / sum), total) : weights.map(() => 0);
}

/** A priced line of a document (invoice or quotation line). Discount lines are negative. */
export interface PricedLine {
  kind: ItemKind;
  net: number;
  vat: number;
  gross: number;
  /** Not kept on quotations sent before it was: lines with VAT and without are then told apart by their VAT. */
  vatRateBp?: number;
}

export interface SpreadLine<T> {
  line: T;
  /** The line's part of the discount, excl. VAT (an amount off, positive). */
  discount: number;
  /** VAT and total of the line after its part of the discount. */
  vat: number;
  gross: number;
}

export interface SpreadDiscount<T> {
  /** Every line that is not a discount, in their order. */
  lines: SpreadLine<T>[];
  /** Discount lines without a line of their VAT rate to sit on: printed as they are. */
  rest: T[];
  /** What the lines come to before the discount (gross). */
  subtotal: number;
  /** All discount lines together (gross, negative). */
  discount: number;
}

const rateKey = (l: PricedLine) => l.vatRateBp ?? (l.vat === 0 ? 0 : -1);

/**
 * The discount as the garage's documents print it: in each line's Discount column (excl. VAT, like its
 * price), with the line's VAT and total after it, and once in the totals. The discount lines of each VAT
 * rate are shared over that rate's lines in proportion to their totals. Exact to the fils: the lines'
 * totals, VAT and discounts add up to the document's, and price × qty − discount + VAT = total on every line.
 * `spreadable`: lines that may take a share (not price ranges).
 */
export function spreadDiscount<T extends PricedLine>(lines: T[], spreadable: (l: T) => boolean = () => true): SpreadDiscount<T> {
  const base = lines.filter((l) => l.kind !== 'discount');
  const discounts = lines.filter((l) => l.kind === 'discount');
  const out: SpreadLine<T>[] = base.map((line) => ({ line, discount: 0, vat: line.vat, gross: line.gross }));
  const rest: T[] = [];
  for (const key of new Set(discounts.map(rateKey))) {
    const ds = discounts.filter((d) => rateKey(d) === key);
    const off = -ds.reduce((a, d) => a + d.gross, 0);
    const vatOff = -ds.reduce((a, d) => a + d.vat, 0);
    const idx = base.flatMap((l, i) => (rateKey(l) === key && l.gross > 0 && spreadable(l) ? [i] : []));
    const weights = idx.map((i) => base[i].gross);
    if (off <= 0 || off > weights.reduce((a, b) => a + b, 0)) {
      rest.push(...ds);
      continue;
    }
    const after = apportion(off, weights).map((share, k) => base[idx[k]].gross - share);
    // VAT after the discount: as each line's VAT would be on its new total, rounded so that together they
    // are exactly the document's VAT.
    const share = (l: T) => (l.vatRateBp !== undefined ? l.vatRateBp / (10000 + l.vatRateBp) : l.vat / l.gross);
    const vatAfter = idx.reduce((a, i) => a + base[i].vat, 0) - vatOff;
    const vats = roundToTotal(after.map((g, k) => g * share(base[idx[k]])), vatAfter);
    idx.forEach((i, k) => {
      out[i] = { line: base[i], discount: base[i].net - (after[k] - vats[k]), vat: vats[k], gross: after[k] };
    });
  }
  return { lines: out, rest, subtotal: base.reduce((a, l) => a + l.gross, 0), discount: discounts.reduce((a, d) => a + d.gross, 0) };
}

/** "10%" when the discount lines were given as a percentage ("Discount 10%", "Скидка 10 %"). */
export function discountPctLabel(titles: string[]): string | undefined {
  const m = titles.map((s) => /(\d+(?:[.,]\d+)?)\s?%/.exec(s)).find(Boolean);
  return m ? `${m[1].replace(',', '.')}%` : undefined;
}
