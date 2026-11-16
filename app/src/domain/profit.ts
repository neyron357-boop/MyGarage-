import { liveLines } from './flow';
import { activeInvoice } from './invoice';
import { itemAmounts, itemCostPaid } from './items';
import type { Expense, Invoice, Order, OrderItem } from './types';

/** Every sum with VAT (v0.22, the user's decision): money as the customer pays it and as the garage pays out. */
export interface Profit {
  /** What the job brings, with VAT, as the customer pays it. */
  revenue: number;
  /** What its parts cost, as bought (`itemCostPaid`: with the seller's VAT when entered). */
  parts: number;
  /** What the work done outside cost. */
  outside: number;
  /** The job's other expenses, as paid. */
  expenses: number;
  profit: number;
  /** Some cost is known — without any, "profit" would just repeat the revenue. */
  known: boolean;
}

/**
 * What a job earns: the invoice's total with VAT (the lines' while there is none) less what was let go
 * (closed without payment), minus the parts as bought, the work done outside and the job's own expenses.
 * Parts the customer brought cost nothing; an expense that paid for work outside is counted once.
 */
export function jobProfit(input: {
  order: Pick<Order, 'waived'>;
  items: OrderItem[];
  invoices: Invoice[];
  expenses: (Pick<Expense, 'id' | 'amountFils' | 'voidedAt'>)[];
}): Profit {
  const inv = activeInvoice(input.invoices);
  const live = liveLines(input.items);
  let revenue = inv ? inv.totalFils : live.reduce((s, i) => s + itemAmounts(i).gross, 0);
  // Let go (the money will not come) — off the revenue; settled with the owner — the garage's all the same.
  if (input.order.waived && input.order.waived.via !== 'owner' && revenue > 0) revenue -= Math.min(revenue, input.order.waived.fils);
  const counted = live.filter((i) => i.kind !== 'discount' && !i.customerSupplied);
  const parts = counted.filter((i) => i.kind === 'part').reduce((s, i) => s + itemCostPaid(i), 0);
  const outsideLines = counted.filter((i) => i.kind !== 'part' && i.outsource);
  // Work outside already paid: what the expense that paid it says (changed in the book — v0.23 — it is still the truth).
  const paidBy = (i: OrderItem) => (i.outsource?.expenseId ? input.expenses.find((e) => e.id === i.outsource!.expenseId && !e.voidedAt) : undefined);
  const outside = outsideLines.reduce((s, i) => s + (paidBy(i)?.amountFils ?? itemCostPaid(i)), 0);
  const paidOutside = new Set(outsideLines.map((i) => i.outsource?.expenseId).filter(Boolean));
  const expenses = input.expenses.filter((e) => !e.voidedAt && !paidOutside.has(e.id)).reduce((s, e) => s + e.amountFils, 0);
  const known = counted.some((i) => i.costPriceFils !== undefined) || expenses > 0;
  return { revenue, parts, outside, expenses, profit: revenue - parts - outside - expenses, known };
}
