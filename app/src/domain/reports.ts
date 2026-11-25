import { dubaiDate, inRange } from './dates';
import { activeInvoice } from './invoice';
import { itemCostPaid } from './items';
import { partsPaid } from './profit';
import type { CashClosing, Expense, Income, Invoice, Order, OrderItem, Payment } from './types';

/*
 * The owner's report for a period. Every sum is with VAT (v0.22, the user's decision): money as it is
 * received and paid — invoice totals, parts as bought (cost × qty + the seller's VAT — `itemCostPaid`),
 * expenses as on the receipt. A job's parts bought as its expenses in «Запчасти» are those expenses: only what its
 * lines cost beyond them is a cost of its own (v0.31 — the same purchase was counted twice). VAT is not taken out or shown here; the accountant's CSV keeps it apart.
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
  /** The money book's «Запчасти» (`code: 'parts'`): a job's expenses there are what its parts were bought for. */
  partsCategoryId?: string;
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
  /** Parts of the jobs invoiced in the period, as bought (`itemCostPaid`), beyond what their «Запчасти» expenses paid. */
  partsCostGross: number;
  /** Expenses dated in the period, as paid. */
  expensesGross: number;
  expensesByCategory: { categoryId: string; gross: number }[];
  /** Received without an invoice (gross, as received). */
  otherIncome: number;
  /**
   * Let go in the period — jobs closed «Без оплаты» (`closeUnpaid`): their invoice is in the revenue, the money will not
   * come. Off the profit, as `jobProfit` takes it off the job's; «Оплата у главного» is the garage's money and stays.
   */
  writtenOffGross: number;
  grossProfit: number;
  payments: { cash: number; card: number; transfer: number; outside: number };
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
    writtenOffGross: 0,
    grossProfit: 0,
    payments: { cash: 0, card: 0, transfer: 0, outside: 0 },
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
  const linesCost = new Map<string, number>();
  for (const it of input.items) {
    if (!activeOrders.has(it.orderId)) continue;
    if (it.kind !== 'part' || it.approvalState !== 'approved' || it.customerSupplied) continue;
    linesCost.set(it.orderId, (linesCost.get(it.orderId) ?? 0) + itemCostPaid(it));
  }
  // The job's «Запчасти» expenses (whenever dated — they count in their own period) bought the same parts.
  for (const [orderId, cost] of linesCost) {
    const paid = partsPaid(input.expenses.filter((e) => e.orderId === orderId), input.partsCategoryId);
    r.partsCostGross += Math.max(0, cost - paid);
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

  // Written off when it was let go; only what an invoice put into the revenue (a job never invoiced added nothing).
  const invoicesOf = new Map<string, Invoice[]>();
  for (const inv of input.invoices) {
    const list = invoicesOf.get(inv.orderId);
    if (list) list.push(inv);
    else invoicesOf.set(inv.orderId, [inv]);
  }
  for (const o of input.orders) {
    const w = o.waived;
    if (!w || w.via === 'owner' || w.fils <= 0 || !inPeriod(w.at)) continue;
    const inv = activeInvoice(invoicesOf.get(o.id) ?? []);
    if (inv) r.writtenOffGross += Math.min(w.fils, inv.totalFils);
  }

  r.grossProfit = r.revenueGross + r.otherIncome - r.writtenOffGross - r.partsCostGross - r.expensesGross;
  r.averageTicketGross = salesCount ? Math.round(r.revenueGross / salesCount) : 0;
  return r;
}
