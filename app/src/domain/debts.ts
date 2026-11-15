import { amountDue } from './invoice';
import { summarize } from './items';
import type { CreditPayment, Customer, Expense, Invoice, Order, OrderItem, Payment, Vehicle } from './types';

/*
 * Who owes whom (v0.20).
 *
 * A customer's debt is a job whose car has left — handed over or closed — with money still due on it: counted
 * from what the app already keeps (the invoice or the agreed lines, less the payments), so every job made before
 * is counted the same way. One sum everywhere: the board's "Debts", "Money → Debts", the job itself.
 *
 * The garage's own debt is an expense taken on credit: counted as an expense once, when it is taken; what is
 * paid towards it later moves money then, by the way it is really paid.
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

export interface Debtor {
  customer: Customer;
  totalFils: number;
  /** The customer's cars with what each owes, the one owing most first; a car's jobs oldest first. */
  cars: { vehicle: Vehicle; totalFils: number; jobs: DebtJob[] }[];
}

/** The debts as one card per customer — whoever owes most first; a customer with three cars is one card with three cars. */
export function groupDebts(jobs: DebtJob[]): Debtor[] {
  const by = new Map<string, Debtor>();
  for (const j of jobs) {
    const d = by.get(j.customer.id) ?? { customer: j.customer, totalFils: 0, cars: [] };
    let car = d.cars.find((c) => c.vehicle.id === j.vehicle.id);
    if (!car) d.cars.push((car = { vehicle: j.vehicle, totalFils: 0, jobs: [] }));
    car.jobs.push(j);
    car.totalFils += j.dueFils;
    d.totalFils += j.dueFils;
    by.set(j.customer.id, d);
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
 * A sum received towards a customer's debts, spread over their jobs: the oldest first — or the job picked (`first`)
 * first, then the oldest. What is more than they owe is left over (`restFils`): kept as money in with no debt to it.
 */
export function allocate(amountFils: number, debts: { orderId: string; dueFils: number; since: string }[], first?: string): { parts: DebtShare[]; restFils: number } {
  const queue = [...debts].sort((a, b) => Number(b.orderId === first) - Number(a.orderId === first) || a.since.localeCompare(b.since) || a.orderId.localeCompare(b.orderId));
  let left = Math.max(0, Math.round(amountFils));
  const parts: DebtShare[] = [];
  for (const d of queue) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, d.dueFils));
    if (take <= 0) continue;
    parts.push({ orderId: d.orderId, amountFils: take });
    left -= take;
  }
  return { parts, restFils: left };
}

/** What is still owed on an expense taken on credit (a cancelled payment does not count). */
export const creditLeft = (expense: Pick<Expense, 'amountFils'>, paid: Pick<CreditPayment, 'amountFils' | 'voidedAt'>[]): number =>
  expense.amountFils - paid.reduce((s, p) => s + (p.voidedAt ? 0 : p.amountFils), 0);
