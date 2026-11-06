import { dubaiDate, inRange } from './dates';
import { roundFils } from './money';
import type { CashClosing, Expense, Invoice, Order, OrderItem, Payment } from './types';

export interface ReportInput {
  from: string; // YYYY-MM-DD inclusive (Dubai)
  to: string;
  orders: Order[];
  invoices: Invoice[];
  items: OrderItem[];
  expenses: Expense[];
  payments: Payment[];
  closings: CashClosing[];
}

export interface Report {
  ordersReceived: number;
  ordersDelivered: number;
  revenueNet: number;
  revenueVat: number;
  revenueGross: number;
  laborNet: number;
  partsNet: number;
  otherNet: number;
  partsCostNet: number;
  expensesNet: number;
  expensesVat: number;
  expensesByCategory: { categoryId: string; gross: number; vat: number }[];
  grossProfit: number;
  vatOutput: number;
  vatInput: number;
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
    revenueNet: 0,
    revenueVat: 0,
    revenueGross: 0,
    laborNet: 0,
    partsNet: 0,
    otherNet: 0,
    partsCostNet: 0,
    expensesNet: 0,
    expensesVat: 0,
    expensesByCategory: [],
    grossProfit: 0,
    vatOutput: 0,
    vatInput: 0,
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
    r.revenueNet += sign * inv.subtotalFils;
    r.revenueVat += sign * inv.vatFils;
    r.revenueGross += sign * inv.totalFils;
    for (const l of inv.lines) {
      if (l.kind === 'labor') r.laborNet += sign * l.net;
      else if (l.kind === 'part') r.partsNet += sign * l.net;
      else r.otherNet += sign * l.net;
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
    r.partsCostNet += roundFils((it.costPriceFils ?? 0) * it.qty);
  }

  // Input VAT on parts received in the period.
  for (const it of input.items) {
    if (it.kind === 'part' && inPeriod(it.receivedAt)) r.vatInput += it.purchaseVatFils ?? 0;
  }

  const byCat = new Map<string, { gross: number; vat: number }>();
  for (const e of input.expenses) {
    if (!inRange(e.date, from, to)) continue;
    r.expensesNet += e.amountFils - e.vatFils;
    r.expensesVat += e.vatFils;
    const c = byCat.get(e.categoryId) ?? { gross: 0, vat: 0 };
    c.gross += e.amountFils;
    c.vat += e.vatFils;
    byCat.set(e.categoryId, c);
  }
  r.expensesByCategory = [...byCat.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.gross - a.gross);
  r.vatInput += r.expensesVat;
  r.vatOutput = r.revenueVat;

  for (const p of input.payments) {
    if (!inPeriod(p.receivedAt)) continue;
    r.payments[p.method] += p.kind === 'refund' ? -p.amountFils : p.amountFils;
  }
  for (const c of input.closings) if (inRange(c.date, from, to)) r.cashDiffFils += c.diffFils;

  r.grossProfit = r.revenueNet - r.partsCostNet - r.expensesNet;
  r.averageTicketGross = salesCount ? Math.round(r.revenueGross / salesCount) : 0;
  return r;
}
