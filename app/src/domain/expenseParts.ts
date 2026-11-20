import type { ExpenseMethod } from './types';

/*
 * An expense paid in parts (v0.58, the user: «иногда частями оплата происходит, например часть наличными, а часть в
 * кредит остаётся… одна часть суммы одним способом оплаты, а другая — другими»): a part a way, each an expense of its
 * own (services/money.ts `addExpense` `parts`) — its cash leaves the cash box, its card is counted, its credit is owed.
 * The sheet asks the sums of all the ways but one; that one gets what is left of the whole: the part on credit when
 * there is one (what is not paid now is owed), else the last way.
 */

/** The ways, in the order the sheet's chips show them. */
export const PART_WAYS: readonly ExpenseMethod[] = ['cash', 'card', 'transfer', 'credit', 'outside'];

const byChips = (a: ExpenseMethod, b: ExpenseMethod) => PART_WAYS.indexOf(a) - PART_WAYS.indexOf(b);

/** The way the rest of the sum goes to: on credit, when it is one of them; else the last. */
export function restWay(ways: readonly ExpenseMethod[]): ExpenseMethod | undefined {
  if (ways.includes('credit')) return 'credit';
  return [...ways].sort(byChips).pop();
}

/** The ways as the sheet's rows: in the chips' order, the one that takes the rest last. */
export function partRows(ways: readonly ExpenseMethod[]): ExpenseMethod[] {
  const rest = restWay(ways);
  return [...ways.filter((w) => w !== rest).sort(byChips), ...(rest ? [rest] : [])];
}

export interface ExpensePart {
  method: ExpenseMethod;
  amountFils: number;
}

/**
 * The parts out of the sums typed: each way typed — its sum, the rest way — what is left of the whole. Nothing when a
 * sum is missing, nothing is left for the rest, or there are fewer than two ways.
 */
export function partsOf(amountFils: number | undefined, ways: readonly ExpenseMethod[], typed: Partial<Record<ExpenseMethod, number>>): ExpensePart[] | undefined {
  const rows = partRows(ways);
  if (rows.length < 2 || !(amountFils && amountFils > 0)) return undefined;
  const paid = rows.slice(0, -1).map((method) => ({ method, amountFils: typed[method] ?? 0 }));
  if (paid.some((p) => !(p.amountFils > 0))) return undefined;
  const rest = amountFils - paid.reduce((s, p) => s + p.amountFils, 0);
  return rest > 0 ? [...paid, { method: rows[rows.length - 1], amountFils: rest }] : undefined;
}

/** What is left for the rest way (may be 0 or less while the sums are being typed). */
export function partsRest(amountFils: number | undefined, ways: readonly ExpenseMethod[], typed: Partial<Record<ExpenseMethod, number>>): number {
  const rows = partRows(ways);
  return (amountFils ?? 0) - rows.slice(0, -1).reduce((s, w) => s + (typed[w] ?? 0), 0);
}

/** Parts an expense can be saved as: two ways or more, each once, each above zero, adding up to the whole. */
export function partsFit(amountFils: number, parts: readonly ExpensePart[]): boolean {
  return (
    parts.length >= 2 &&
    new Set(parts.map((p) => p.method)).size === parts.length &&
    parts.every((p) => Number.isInteger(p.amountFils) && p.amountFils > 0) &&
    parts.reduce((s, p) => s + p.amountFils, 0) === amountFils
  );
}

/**
 * The receipt's VAT shared by the parts' sums, to the fils: each its share rounded down, the fils left over to the
 * parts with the largest fractions — the parts' VAT adds up to the receipt's.
 */
export function shareVat(vatFils: number, parts: readonly ExpensePart[]): number[] {
  const total = parts.reduce((s, p) => s + p.amountFils, 0);
  if (!(vatFils > 0) || !(total > 0)) return parts.map(() => 0);
  const exact = parts.map((p) => (vatFils * p.amountFils) / total);
  const shares = exact.map(Math.floor);
  let left = vatFils - shares.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}
