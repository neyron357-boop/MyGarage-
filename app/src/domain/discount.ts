import { itemAmounts } from './items';
import { roundFils } from './money';
import { netFromGross } from './vat';
import type { OrderItem } from './types';

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
