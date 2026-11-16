import { dubaiDate, inRange } from './dates';
import { itemCostPaid } from './items';
import type { CashClosing, Expense, Income, Invoice, Order, OrderItem, Payment } from './types';

/*
 * The owner's report for a period. Every sum is with VAT (v0.22, the user's decision): money as it is
 * received and paid — invoice totals, parts as bought (cost × qty + the seller's VAT when entered),
 * expenses as on the receipt. VAT is not taken out or shown here; the accountant's CSV keeps it apart.
 */

export interface ReportInput {
  from: string; // YYYY-MM-DD inclusive (Dubai)
  to: string;
  orders: Order[];
  invoices: Invoice[];
  items: OrderItem[];
  expenses: Expense[];
  payments: Payment[];
  closings: CashClosing[];
  /** Money received without an invoice (items sold, small jobs). */
  incomes?: Income[];
}

export interface Report {
  ordersReceived: number;
  ordersDelivered: number;
  /** Invoices of the period with VAT, credit notes less. */
  revenueGross: number;
  /** The same by line: work, parts, the rest (fees, discounts) — they add up to `revenueGross`. */
  laborGross: number;
  partsGross: number;
  otherGross: number;
  /** Parts of the jobs invoiced in the period, as bought (`itemCostPaid`). */
  partsCostGross: number;
  /** Expenses dated in the period, as paid. */
  expensesGross: number;
  expensesByCategory: { categoryId: string; gross: number }[];
  /** Received without an invoice (gross, as received). */
  otherIncome: number;
  grossProfit: number;
  payments: { cash: number; card: number; transfer: number };
  cashDiffFils: number;
  averageTicketGross: number;
}

const day = (iso?: string) => (iso ? dubaiDate(iso) : '');

export function computeReport(input: ReportInput): Report {
  const { from, to } = input;
  const inPeriod = (iso?: string) => !!iso && inRange(day(iso), from, to);

  const r: Report = {
    ordersReceived: input.orders.filter((o) => inPeriod(o.arrivedAt)).length,
    ordersDelivered: input.orders.filter((o) => inPeriod(o.deliveredAt)).length,
    revenueGross: 0,
    laborGross: 0,
    partsGross: 0,
    otherGross: 0,
    partsCostGross: 0,
    expensesGross: 0,
    expensesByCategory: [],
    otherIncome: 0,
    grossProfit: 0,
    payments: { cash: 0, card: 0, transfer: 0 },
    cashDiffFils: 0,
    averageTicketGross: 0,
  };

  // Revenue: invoices issued in the period, credit notes subtract.
  let salesCount = 0;
  for (const inv of input.invoices) {
    if (!inPeriod(inv.issuedAt)) continue;
    const sign = inv.type === 'credit_note' ? -1 : 1;
    if (sign > 0) {
      salesCount += 1;
    }
    r.revenueGross += sign * inv.totalFils;
    for (const l of inv.lines) {
      if (l.kind === 'labor') r.laborGross += sign * l.gross;
      else if (l.kind === 'part') r.partsGross += sign * l.gross;
      else r.otherGross += sign * l.gross;
    }
  }

  // Cost of parts for orders invoiced in the period (only invoices that are still active).
  const activeOrders = new Set(
    input.invoices
      .filter((i) => i.type !== 'credit_note' && i.status === 'issued' && inPeriod(i.issuedAt))
      .map((i) => i.orderId),
  );
  for (const it of input.items) {
    if (!activeOrders.has(it.orderId)) continue;
    if (it.kind !== 'part' || it.approvalState !== 'approved' || it.customerSupplied) continue;
    r.partsCostGross += itemCostPaid(it);
  }

  const byCat = new Map<string, number>();
  for (const e of input.expenses) {
    if (e.voidedAt || !inRange(e.date, from, to)) continue;
    r.expensesGross += e.amountFils;
    byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amountFils);
  }
  r.expensesByCategory = [...byCat.entries()].map(([categoryId, gross]) => ({ categoryId, gross })).sort((a, b) => b.gross - a.gross);

  for (const p of input.payments) {
    if (!inPeriod(p.receivedAt)) continue;
    r.payments[p.method] += p.kind === 'refund' ? -p.amountFils : p.amountFils;
  }
  for (const c of input.closings) if (inRange(c.date, from, to)) r.cashDiffFils += c.diffFils;
  // A debt payment went to its jobs' invoices (revenue already): only what no job owed is income of its own.
  const toJobs = new Map<string, number>();
  for (const p of input.payments) if (p.incomeId) toJobs.set(p.incomeId, (toJobs.get(p.incomeId) ?? 0) + (p.kind === 'refund' ? -p.amountFils : p.amountFils));
  for (const i of input.incomes ?? []) if (!i.voidedAt && inRange(i.date, from, to)) r.otherIncome += i.category === 'debt' ? Math.max(0, i.amountFils - (toJobs.get(i.id) ?? 0)) : i.amountFils;

  r.grossProfit = r.revenueGross + r.otherIncome - r.partsCostGross - r.expensesGross;
  r.averageTicketGross = salesCount ? Math.round(r.revenueGross / salesCount) : 0;
  return r;
}
