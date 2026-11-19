import { amountDue } from './invoice';
import { summarize } from './items';
import type { CreditPayment, Customer, Expense, HistoryInvoice, Income, Invoice, Order, OrderItem, Payment, Vehicle } from './types';

/*
 * Who owes whom (v0.20).
 *
 * A customer's debt is a job whose car has left — handed over or closed — with money still due on it: counted
 * from what the app already keeps (the invoice or the agreed lines, less the payments), so every job made before
 * is counted the same way. One sum everywhere: the board's "Debts", "Money → Debts", the job itself.
 *
 * The garage's own debt is an expense taken on credit: counted as an expense once, when it is taken; what is
 * paid towards it later moves money then, by the way it is really paid.
 *
 * v0.47 — a customer's invoices from before the app (historyInvoices, a company's monthly statements) are its debt too:
 * each owes its total until «debt payments» cover it (`Income.historyParts`), the oldest first.
 */

/** What a job still owes: its invoice (or, before one, the agreed lines) less what was paid. */
export function orderDue(order: Pick<Order, 'imported' | 'waived'>, items: OrderItem[], invoices: Invoice[], payments: Payment[]): number {
  // History from Eaglecart: payments were not kept there consistently, so nothing is shown as owed.
  if (order.imported?.history) return 0;
  const due = amountDue(summarize(items).approvedGross, invoices, payments);
  // Closed without payment: nothing is owed (money paid over is still shown as such).
  return order.waived ? Math.min(0, due) : due;
}

/** A customer's debt: the car is gone (handed over, or the job closed) and money is still due. */
export const isCustomerDebt = (order: Pick<Order, 'stage'>, dueFils: number): boolean => (order.stage === 'delivered' || order.stage === 'closed') && dueFils > 0;

export interface DebtJob {
  order: Order;
  vehicle: Vehicle;
  customer: Customer;
  dueFils: number;
  /** When the debt began (the invoice, else the job): the oldest is paid off first. */
  since: string;
  /** The date a signed debt is due, when one was signed. */
  dueDate?: string;
}

/** An invoice from before the app that the customer still owes (v0.47) — in full, or what «debt payments» left of it. */
export interface HistoryDue {
  invoiceId: string;
  /** YYYY-MM-DD */
  date: string;
  number: string;
  numberKind: HistoryInvoice['numberKind'];
  plate: string;
  vehicleId: string;
  totalFils: number;
  dueFils: number;
}

/** A month of them — the customer's monthly statement — oldest first. */
export interface HistoryMonth {
  /** YYYY-MM */
  month: string;
  dueFils: number;
  dues: HistoryDue[];
}

/** What each invoice from before the app still owes: its total less the parts of «debt payments» set against it. */
export function historyDues(invoices: HistoryInvoice[], incomes: Pick<Income, 'category' | 'historyParts' | 'voidedAt'>[]): HistoryDue[] {
  const paid = new Map<string, number>();
  for (const i of incomes) if (i.category === 'debt' && !i.voidedAt) for (const p of i.historyParts ?? []) paid.set(p.invoiceId, (paid.get(p.invoiceId) ?? 0) + p.amountFils);
  return invoices
    .map((h) => ({ invoiceId: h.id, date: h.date, number: h.number, numberKind: h.numberKind, plate: h.plate, vehicleId: h.vehicleId, totalFils: h.totalFils, dueFils: h.totalFils - (paid.get(h.id) ?? 0) }))
    .filter((d) => d.dueFils > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceId.localeCompare(b.invoiceId));
}

/** By month, oldest first. */
export function historyMonths(dues: HistoryDue[]): HistoryMonth[] {
  const by = new Map<string, HistoryMonth>();
  for (const d of dues) {
    const m = d.date.slice(0, 7);
    const x = by.get(m) ?? by.set(m, { month: m, dueFils: 0, dues: [] }).get(m)!;
    x.dueFils += d.dueFils;
    x.dues.push(d);
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** An invoice from before the app among a customer's debts — beside the jobs, which are their order ids. */
export const historyKey = (invoiceId: string) => `h:${invoiceId}`;
export const historyKeyOf = (key: string): string | undefined => (key.startsWith('h:') ? key.slice(2) : undefined);
/** When its debt began: its day (an invoice from before the app is older than every job of this app). */
export const historySince = (date: string) => `${date}T00:00:00.000Z`;

/** A customer's debts as one queue for a «debt payment»: the jobs and the invoices from before the app. */
export const debtQueue = (jobs: Pick<DebtJob, 'order' | 'dueFils' | 'since'>[], history: HistoryDue[]) => [
  ...jobs.map((j) => ({ key: j.order.id, dueFils: j.dueFils, since: j.since })),
  ...history.map((h) => ({ key: historyKey(h.invoiceId), dueFils: h.dueFils, since: historySince(h.date) })),
];

export interface Debtor {
  customer: Customer;
  totalFils: number;
  /** The customer's cars with what each owes, the one owing most first; a car's jobs oldest first. */
  cars: { vehicle: Vehicle; totalFils: number; jobs: DebtJob[] }[];
  /** v0.47: its invoices from before the app still owing, by month, oldest first (none — empty). */
  history: HistoryMonth[];
}

/**
 * The debts as one card per customer — whoever owes most first; a customer with three cars is one card with three cars;
 * the invoices from before the app (`history`) by month on the same card.
 */
export function groupDebts(jobs: DebtJob[], history: { customer: Customer; dues: HistoryDue[] }[] = []): Debtor[] {
  const by = new Map<string, Debtor>();
  for (const j of jobs) {
    const d = by.get(j.customer.id) ?? { customer: j.customer, totalFils: 0, cars: [], history: [] };
    let car = d.cars.find((c) => c.vehicle.id === j.vehicle.id);
    if (!car) d.cars.push((car = { vehicle: j.vehicle, totalFils: 0, jobs: [] }));
    car.jobs.push(j);
    car.totalFils += j.dueFils;
    d.totalFils += j.dueFils;
    by.set(j.customer.id, d);
  }
  for (const h of history) {
    if (!h.dues.length) continue;
    const d = by.get(h.customer.id) ?? { customer: h.customer, totalFils: 0, cars: [], history: [] };
    d.history = historyMonths(h.dues);
    d.totalFils += h.dues.reduce((a, x) => a + x.dueFils, 0);
    by.set(h.customer.id, d);
  }
  const name = (c: Customer) => (c.type === 'company' && c.companyName ? c.companyName : c.name) || '';
  const out = [...by.values()];
  for (const d of out) {
    for (const c of d.cars) c.jobs.sort((a, b) => a.since.localeCompare(b.since) || a.order.number - b.order.number);
    d.cars.sort((a, b) => b.totalFils - a.totalFils || a.jobs[0].since.localeCompare(b.jobs[0].since));
  }
  return out.sort((a, b) => b.totalFils - a.totalFils || name(a.customer).localeCompare(name(b.customer)));
}

export interface DebtShare {
  orderId: string;
  amountFils: number;
}

/**
 * A sum received towards a customer's debts, spread over them — jobs and (v0.47) invoices from before the app, each
 * by its key: the oldest first — or the one picked (`first`) first, then the oldest. What is more than they owe is left
 * over (`restFils`): kept as money in with no debt to it.
 */
export function spread(amountFils: number, debts: { key: string; dueFils: number; since: string }[], first?: string): { parts: { key: string; amountFils: number }[]; restFils: number } {
  const queue = [...debts].sort((a, b) => Number(b.key === first) - Number(a.key === first) || a.since.localeCompare(b.since) || a.key.localeCompare(b.key));
  let left = Math.max(0, Math.round(amountFils));
  const parts: { key: string; amountFils: number }[] = [];
  for (const d of queue) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, d.dueFils));
    if (take <= 0) continue;
    parts.push({ key: d.key, amountFils: take });
    left -= take;
  }
  return { parts, restFils: left };
}

/** A sum spread over a customer's jobs only (`spread` by the jobs' ids). */
export function allocate(amountFils: number, debts: { orderId: string; dueFils: number; since: string }[], first?: string): { parts: DebtShare[]; restFils: number } {
  const r = spread(amountFils, debts.map((d) => ({ key: d.orderId, dueFils: d.dueFils, since: d.since })), first);
  return { parts: r.parts.map((p) => ({ orderId: p.key, amountFils: p.amountFils })), restFils: r.restFils };
}

/** What is still owed on an expense taken on credit (a cancelled payment does not count). */
export const creditLeft = (expense: Pick<Expense, 'amountFils'>, paid: Pick<CreditPayment, 'amountFils' | 'voidedAt'>[]): number =>
  expense.amountFils - paid.reduce((s, p) => s + (p.voidedAt ? 0 : p.amountFils), 0);
