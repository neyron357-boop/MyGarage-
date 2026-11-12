import { liveLines } from './flow';
import { activeInvoice } from './invoice';
import { itemAmounts } from './items';
import { roundFils } from './money';
import type { Expense, Invoice, Order, OrderItem } from './types';

export interface Profit {
  /** What the job brings, without VAT (VAT is not the garage's money). */
  revenue: number;
  /** What its parts cost (net, as bought). */
  parts: number;
  /** What the work done outside cost. */
  outside: number;
  /** The job's other expenses (net). */
  expenses: number;
  profit: number;
  /** Some cost is known — without any, "profit" would just repeat the revenue. */
  known: boolean;
}

/**
 * What a job earns: the invoice's net total (the lines' while there is none) less what was let go
 * (closed without payment), minus the parts' purchase cost, the work done outside and the job's own
 * expenses. Parts the customer brought cost nothing; an expense that paid for work outside is counted once.
 */
export function jobProfit(input: {
  order: Pick<Order, 'waived'>;
  items: OrderItem[];
  invoices: Invoice[];
  expenses: (Pick<Expense, 'id' | 'amountFils' | 'vatFils' | 'voidedAt'>)[];
}): Profit {
  const inv = activeInvoice(input.invoices);
  const live = liveLines(input.items);
  let revenue = inv ? inv.subtotalFils : live.reduce((s, i) => s + itemAmounts(i).net, 0);
  const gross = inv ? inv.totalFils : live.reduce((s, i) => s + itemAmounts(i).gross, 0);
  // Let go (the money will not come) — off the revenue; settled with the owner — the garage's all the same.
  if (input.order.waived && input.order.waived.via !== 'owner' && gross > 0) revenue -= roundFils((input.order.waived.fils * revenue) / gross);
  const counted = live.filter((i) => i.kind !== 'discount' && !i.customerSupplied);
  const cost = (i: OrderItem) => (i.costPriceFils !== undefined ? roundFils(i.costPriceFils * (i.qty || 1)) : 0);
  const parts = counted.filter((i) => i.kind === 'part').reduce((s, i) => s + cost(i), 0);
  const outsideLines = counted.filter((i) => i.kind !== 'part' && i.outsource);
  const outside = outsideLines.reduce((s, i) => s + cost(i), 0);
  const paidOutside = new Set(outsideLines.map((i) => i.outsource?.expenseId).filter(Boolean));
  const expenses = input.expenses.filter((e) => !e.voidedAt && !paidOutside.has(e.id)).reduce((s, e) => s + e.amountFils - (e.vatFils ?? 0), 0);
  const known = counted.some((i) => i.costPriceFils !== undefined) || expenses > 0;
  return { revenue, parts, outside, expenses, profit: revenue - parts - outside - expenses, known };
}
