import { dubaiDate } from './dates';
import { amountDue } from './invoice';
import { summarize } from './items';
import { sellerKey } from './suppliers';
import type { CreditPayment, Customer, Expense, HistoryInvoice, Income, Invoice, Lender, Order, OrderItem, Payment, Supplier, Vehicle } from './types';

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
  /** What it came to (its invoice, else the agreed lines) — paid or not (v0.62: a month's «из …»). */
  totalFils?: number;
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

/** Each invoice from before the app with what it still owes — paid off ones too (nothing, or less than nothing). */
export function historyLeft(invoices: HistoryInvoice[], incomes: Pick<Income, 'category' | 'historyParts' | 'voidedAt'>[]): HistoryDue[] {
  const paid = new Map<string, number>();
  for (const i of incomes) if (i.category === 'debt' && !i.voidedAt) for (const p of i.historyParts ?? []) paid.set(p.invoiceId, (paid.get(p.invoiceId) ?? 0) + p.amountFils);
  return invoices
    .map((h) => ({ invoiceId: h.id, date: h.date, number: h.number, numberKind: h.numberKind, plate: h.plate, vehicleId: h.vehicleId, totalFils: h.totalFils, dueFils: h.totalFils - (paid.get(h.id) ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceId.localeCompare(b.invoiceId));
}

/** What each invoice from before the app still owes: its total less the parts of «debt payments» set against it. */
export function historyDues(invoices: HistoryInvoice[], incomes: Pick<Income, 'category' | 'historyParts' | 'voidedAt'>[]): HistoryDue[] {
  return historyLeft(invoices, incomes).filter((d) => d.dueFils > 0);
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

/**
 * A month of a customer's debts (v0.62, the user: «оплаты долгов компаний и клиентов по месяцам, выбор месяца и оплата —
 * за некоторые месяцы инвойсы оплачены»): the jobs whose debt began in it (their invoice, by the day in Dubai) and its
 * invoices from before the app — what a company's statement of the month is.
 */
export interface DebtMonth {
  /** YYYY-MM */
  month: string;
  dueFils: number;
  /** The oldest first. */
  jobs: DebtJob[];
  history: HistoryDue[];
}

/** A customer's debts by month, the oldest first. */
export function debtMonths(jobs: DebtJob[], history: HistoryDue[]): DebtMonth[] {
  const by = new Map<string, DebtMonth>();
  const at = (month: string) => by.get(month) ?? by.set(month, { month, dueFils: 0, jobs: [], history: [] }).get(month)!;
  for (const j of jobs) {
    const m = at(dubaiDate(j.since).slice(0, 7));
    m.jobs.push(j);
    m.dueFils += j.dueFils;
  }
  for (const h of history) {
    const m = at(h.date.slice(0, 7));
    m.history.push(h);
    m.dueFils += h.dueFils;
  }
  const out = [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of out) {
    m.jobs.sort((a, b) => a.since.localeCompare(b.since) || a.order.number - b.order.number);
    m.history.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceId.localeCompare(b.invoiceId));
  }
  return out;
}

/**
 * The months are shown — to pick one and pay it — when there is a month to pick (two or more), or invoices from before
 * the app among them (a month is their only row). One month of this app's jobs: the jobs as they were, by car.
 */
export const byMonths = (months: Pick<DebtMonth, 'history'>[]): boolean => months.length > 1 || months.some((m) => m.history.length > 0);

/** The debts of the months picked, by their keys in a «debt payment»'s queue (`debtQueue`): they are paid first. */
export const monthKeys = (months: Pick<DebtMonth, 'month' | 'jobs' | 'history'>[], picked: readonly string[]): string[] =>
  months.filter((m) => picked.includes(m.month)).flatMap((m) => [...m.jobs.map((j) => j.order.id), ...m.history.map((h) => historyKey(h.invoiceId))]);

/** What the months picked owe together. */
export const monthsDue = (months: Pick<DebtMonth, 'month' | 'dueFils'>[], picked: readonly string[]): number => months.reduce((a, m) => a + (picked.includes(m.month) ? m.dueFils : 0), 0);

/** A customer's month as its papers say (v0.62): what its invoices came to, what is still owed of it, how many. */
export interface MonthTotal {
  /** YYYY-MM */
  month: string;
  totalFils: number;
  dueFils: number;
  count: number;
}

/** A customer's invoices (`date` YYYY-MM-DD, what each came to, what each still owes) as months, the oldest first. */
export function monthTotals(rows: { date: string; totalFils: number; dueFils: number }[]): MonthTotal[] {
  const by = new Map<string, MonthTotal>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const m = by.get(month) ?? by.set(month, { month, totalFils: 0, dueFils: 0, count: 0 }).get(month)!;
    m.totalFils += r.totalFils;
    m.dueFils += Math.max(0, r.dueFils);
    m.count++;
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** The garage's credits of one it owes, by month (v0.62: a supplier's monthly statement), the oldest first. */
export interface CreditMonth<T> {
  /** YYYY-MM */
  month: string;
  leftFils: number;
  credits: T[];
}

export function creditMonths<T extends { expense: Pick<Expense, 'date'>; leftFils: number }>(credits: T[]): CreditMonth<T>[] {
  const by = new Map<string, CreditMonth<T>>();
  for (const c of credits) {
    const month = c.expense.date.slice(0, 7);
    const m = by.get(month) ?? by.set(month, { month, leftFils: 0, credits: [] }).get(month)!;
    m.credits.push(c);
    m.leftFils += Math.max(0, c.leftFils);
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface Debtor {
  customer: Customer;
  totalFils: number;
  /** The customer's cars with what each owes, the one owing most first; a car's jobs oldest first. */
  cars: { vehicle: Vehicle; totalFils: number; jobs: DebtJob[] }[];
  /** v0.47: its invoices from before the app still owing, by month, oldest first (none — empty). */
  history: HistoryMonth[];
  /** v0.62: all it owes by month — the jobs and the invoices from before the app — the oldest first. */
  months: DebtMonth[];
}

/**
 * The debts as one card per customer — whoever owes most first; a customer with three cars is one card with three cars;
 * the invoices from before the app (`history`) by month on the same card.
 */
export function groupDebts(jobs: DebtJob[], history: { customer: Customer; dues: HistoryDue[] }[] = []): Debtor[] {
  const by = new Map<string, Debtor>();
  for (const j of jobs) {
    const d = by.get(j.customer.id) ?? { customer: j.customer, totalFils: 0, cars: [], history: [], months: [] };
    let car = d.cars.find((c) => c.vehicle.id === j.vehicle.id);
    if (!car) d.cars.push((car = { vehicle: j.vehicle, totalFils: 0, jobs: [] }));
    car.jobs.push(j);
    car.totalFils += j.dueFils;
    d.totalFils += j.dueFils;
    by.set(j.customer.id, d);
  }
  for (const h of history) {
    if (!h.dues.length) continue;
    const d = by.get(h.customer.id) ?? { customer: h.customer, totalFils: 0, cars: [], history: [], months: [] };
    d.history = historyMonths(h.dues);
    d.totalFils += h.dues.reduce((a, x) => a + x.dueFils, 0);
    by.set(h.customer.id, d);
  }
  const name = (c: Customer) => (c.type === 'company' && c.companyName ? c.companyName : c.name) || '';
  const out = [...by.values()];
  for (const d of out) {
    for (const c of d.cars) c.jobs.sort((a, b) => a.since.localeCompare(b.since) || a.order.number - b.order.number);
    d.cars.sort((a, b) => b.totalFils - a.totalFils || a.jobs[0].since.localeCompare(b.jobs[0].since));
    d.months = debtMonths(
      d.cars.flatMap((c) => c.jobs),
      d.history.flatMap((m) => m.dues),
    );
  }
  return out.sort((a, b) => b.totalFils - a.totalFils || name(a.customer).localeCompare(name(b.customer)));
}

export interface DebtShare {
  orderId: string;
  amountFils: number;
}

/**
 * A sum received towards a customer's debts, spread over them — jobs and (v0.47) invoices from before the app, each
 * by its key: the oldest first — or the one picked (`first`) first, then the oldest; v0.62: several picked (a month's
 * debts) — they first, the oldest of them first. What is more than they owe is left over (`restFils`): kept as money in
 * with no debt to it.
 */
export function spread(amountFils: number, debts: { key: string; dueFils: number; since: string }[], first?: string | readonly string[]): { parts: { key: string; amountFils: number }[]; restFils: number } {
  const firsts = new Set(typeof first === 'string' ? [first] : first ?? []);
  const queue = [...debts].sort((a, b) => Number(firsts.has(b.key)) - Number(firsts.has(a.key)) || a.since.localeCompare(b.since) || a.key.localeCompare(b.key));
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

/**
 * Whom an expense on credit is owed to (v0.61): the person who paid for it (`lender`), else the seller — the garage's
 * supplier it was bought from, or the seller's name as written. `key` is the same for every credit of the same one.
 */
export interface OwedTo {
  key: string;
  name: string;
  phone?: string;
  /** A person who paid for the garage (`Expense.lenderId`). */
  lender?: Pick<Lender, 'id' | 'name' | 'phone'>;
  /** The garage's supplier it is, when it is one. */
  supplier?: Pick<Supplier, 'id' | 'name' | 'phone'>;
}

type SupplierLike = Pick<Supplier, 'id' | 'name' | 'phone' | 'archivedAt'>;
type LenderLike = Pick<Lender, 'id' | 'name' | 'phone'>;

/** The suppliers and the lenders, ready to tell whom a credit is owed to (`owedToOf`) — made once for a list. */
export interface OwedIndex {
  lenders: Map<string, LenderLike>;
  suppliers: Map<string, SupplierLike>;
  /** The suppliers by their name without the company's words (`sellerKey`): a seller written another way. */
  byKey: Map<string, SupplierLike>;
}

export function owedIndex(suppliers: SupplierLike[], lenders: LenderLike[] = []): OwedIndex {
  const byKey = new Map<string, SupplierLike>();
  for (const s of suppliers) {
    const k = sellerKey(s.name);
    if (k.length >= 3 && (!byKey.has(k) || !s.archivedAt)) byKey.set(k, s);
  }
  return { lenders: new Map(lenders.map((l) => [l.id, l])), suppliers: new Map(suppliers.map((s) => [s.id, s])), byKey };
}

/**
 * Whom an expense on credit is owed to (v0.61): its lender (a person who paid for it); else (v0.50.2) the supplier it
 * was bought from (`supplierId`), else the garage's supplier of the same name (its company words aside — `sellerKey`),
 * else the seller's name as written. Nobody — undefined (an old credit typed with no seller).
 */
export function owedToOf(e: Pick<Expense, 'vendor' | 'supplierId' | 'lenderId'>, idx: OwedIndex): OwedTo | undefined {
  const lender = e.lenderId ? idx.lenders.get(e.lenderId) : undefined;
  if (lender) return { key: `l:${lender.id}`, name: lender.name, phone: lender.phone || undefined, lender: { id: lender.id, name: lender.name, phone: lender.phone } };
  const vendorKey = sellerKey(e.vendor ?? '');
  const supplier = (e.supplierId ? idx.suppliers.get(e.supplierId) : undefined) ?? (vendorKey.length >= 3 ? idx.byKey.get(vendorKey) : undefined);
  if (supplier) return { key: `s:${supplier.id}`, name: supplier.name, phone: supplier.phone || undefined, supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone } };
  if (vendorKey.length >= 3) return { key: `v:${vendorKey}`, name: e.vendor!.trim() };
  return undefined;
}

/** Whom the garage owes (v0.50.2: a seller; v0.61: a person too): one card, its credits inside. */
export interface Creditor<T> extends OwedTo {
  /** Its credits still owed, the oldest first (paid off in that order). */
  credits: T[];
  leftFils: number;
  /** Its credits paid off already (v0.61: the whole story with him), the latest first. */
  settled: T[];
}

/**
 * The garage's credits by whom they are owed to (v0.50.2, the user: «один поставщик на двух квитанциях в кредит
 * отображается как два кредитора — надо один поставщик, раскрывающийся список с его кредитами»; v0.61: «если один
 * человек несколько раз платил в долг в разное время на разные расходы — это должно отображаться в «Мы должны»») —
 * `owedToOf`. A credit owed to nobody is on its own (`loose`). The one owed most first; one owed nothing any more is not
 * among them — its paid-off credits are under the ones still owed (`settled`).
 */
export function groupCredits<T extends { expense: Pick<Expense, 'id' | 'vendor' | 'supplierId' | 'lenderId' | 'date'>; leftFils: number }>(
  list: T[],
  suppliers: SupplierLike[],
  lenders: LenderLike[] = [],
): { creditors: Creditor<T>[]; loose: T[] } {
  const idx = owedIndex(suppliers, lenders);
  const groups = new Map<string, Creditor<T>>();
  const loose: T[] = [];
  for (const d of list) {
    const to = owedToOf(d.expense, idx);
    if (!to) {
      if (d.leftFils > 0) loose.push(d);
      continue;
    }
    const g = groups.get(to.key) ?? { ...to, credits: [], settled: [], leftFils: 0 };
    if (d.leftFils > 0) g.credits.push(d);
    else g.settled.push(d);
    g.leftFils += Math.max(0, d.leftFils);
    groups.set(to.key, g);
  }
  for (const [k, g] of groups) if (!g.credits.length) groups.delete(k);
  const creditors = [...groups.values()];
  const oldest = (a: T, b: T) => a.expense.date.localeCompare(b.expense.date) || a.expense.id.localeCompare(b.expense.id);
  for (const g of creditors) {
    g.credits.sort(oldest);
    g.settled.sort((a, b) => oldest(b, a));
  }
  return { creditors: creditors.sort((a, b) => b.leftFils - a.leftFils || a.name.localeCompare(b.name)), loose };
}

/** When a credit began, for paying the oldest first: its day, then when it was typed. */
export const creditSince = (e: Pick<Expense, 'date' | 'createdAt'>): string => `${e.date}|${e.createdAt}`;

/** What is still owed on an expense taken on credit (a cancelled payment does not count). */
export const creditLeft = (expense: Pick<Expense, 'amountFils'>, paid: Pick<CreditPayment, 'amountFils' | 'voidedAt'>[]): number =>
  expense.amountFils - paid.reduce((s, p) => s + (p.voidedAt ? 0 : p.amountFils), 0);
