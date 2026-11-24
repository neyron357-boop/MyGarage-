import { db } from '../db/db';
import { dubaiDate, shiftDay } from '../domain/dates';
import { appliedBy, momentOf, paymentRows, paymentsFor, statementOf, type AccountPayment, type OwedLine, type PaymentRow, type Statement } from '../domain/account';
import { historyKey, owedIndex, owedToOf } from '../domain/debts';
import { activeInvoice } from '../domain/invoice';
import { summarize } from '../domain/items';
import { buildLedger, type LedgerEntry } from '../domain/ledger';
import { formatPlate } from '../domain/plates';
import type { CreditPayment, Customer, Expense, Income, Invoice, Order, OrderItem, Payment } from '../domain/types';
import { expenseNoteLine } from '../domain/paperLines';
import { loadCredits, loadDebtors } from './debts';

/*
 * Accounts read from the records (v0.62.2; the figures — domain/account.ts): a customer's — every invoice of its jobs gone
 * (the invoice in force, else the agreed lines, as its debt is counted) and of before the app, and every payment set
 * against them (on a job, «Оплата долга»); the garage's with the ones it owes — every expense on credit and every payment
 * of one. Behind the statement of account for the customer (pdf/statement.tsx), the PAID stamp of the invoices of before
 * the app, and «Платежи» — the payments of debts of a period (features/money/DebtPayments.tsx).
 */

/** A job that counts on the account: its car has left, not carried over from the old system, not closed unpaid. */
const counts = (o: Order) => (o.stage === 'delivered' || o.stage === 'closed') && !o.imported?.history && !o.waived;

function groupBy<T extends { orderId: string }>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(x.orderId, [...(m.get(x.orderId) ?? []), x]);
  return m;
}

export interface CustomerAccount {
  customer: Customer;
  lines: OwedLine[];
  payments: AccountPayment[];
}

/** A customer's account: its invoices and every payment set against them. */
export async function customerAccount(customerId: string): Promise<CustomerAccount | undefined> {
  const customer = await db.customers.get(customerId);
  if (!customer) return undefined;
  const [orders, history, incomes] = await Promise.all([
    db.orders.where('customerId').equals(customerId).toArray(),
    db.historyInvoices.where('customerId').equals(customerId).toArray(),
    db.incomes.where('customerId').equals(customerId).toArray(),
  ]);
  const jobs = orders.filter(counts);
  const ids = jobs.map((o) => o.id);
  const [invoices, pays, cars] = await Promise.all([
    ids.length ? db.invoices.where('orderId').anyOf(ids).toArray().then(groupBy<Invoice>) : new Map<string, Invoice[]>(),
    ids.length ? db.payments.where('orderId').anyOf(ids).toArray() : ([] as Payment[]),
    db.vehicles.bulkGet([...new Set(jobs.map((o) => o.vehicleId))]),
  ]);
  const car = new Map(cars.filter((v) => !!v).map((v) => [v!.id, v!]));
  // The lines are needed only where no invoice counts (the agreed lines are what is owed then).
  const bare = ids.filter((id) => !activeInvoice(invoices.get(id) ?? []));
  const items = bare.length ? groupBy<OrderItem>(await db.items.where('orderId').anyOf(bare).toArray()) : new Map<string, OrderItem[]>();
  const lines: OwedLine[] = [];
  for (const o of jobs) {
    const inv = activeInvoice(invoices.get(o.id) ?? []);
    const iso = inv?.issuedAt ?? o.deliveredAt ?? o.closedAt ?? o.createdAt;
    const totalFils = inv ? inv.totalFils : summarize(items.get(o.id) ?? []).approvedGross;
    if (totalFils <= 0) continue;
    const v = car.get(o.vehicleId);
    const date = dubaiDate(iso);
    lines.push({
      key: o.id,
      owner: customerId,
      date,
      at: momentOf(date, iso),
      totalFils,
      number: inv?.number ?? `Job #${o.number}`,
      label: v ? [[v.make, v.model].filter(Boolean).join(' '), formatPlate(v.plate, 'en')].filter(Boolean).join(' · ') : undefined,
    });
  }
  for (const h of history) lines.push({ key: historyKey(h.id), owner: customerId, date: h.date, at: momentOf(h.date), totalFils: h.totalFils, number: h.number, label: [h.vehicleText, h.plate].filter(Boolean).join(' · ') });
  const order = new Map(jobs.map((o) => [o.id, o]));
  const debtIncomes = new Map(incomes.filter((i) => i.category === 'debt' && !i.voidedAt).map((i) => [i.id, i]));
  const signed = (p: Payment) => (p.kind === 'refund' ? -p.amountFils : p.amountFils);
  const payments: AccountPayment[] = [];
  const within = new Map<string, Payment[]>();
  for (const p of pays) {
    if (p.incomeId && debtIncomes.has(p.incomeId)) {
      within.set(p.incomeId, [...(within.get(p.incomeId) ?? []), p]);
      continue;
    }
    const date = dubaiDate(p.receivedAt);
    const left = order.get(p.orderId)?.deliveredAt;
    payments.push({
      id: p.id,
      source: 'payment',
      owner: customerId,
      date,
      at: momentOf(date, p.receivedAt),
      amountFils: signed(p),
      method: p.method,
      ref: p.receiptNumber,
      parts: [{ key: p.orderId, amountFils: signed(p) }],
      // Paid after its car left: a debt paid (paid at the hand-over — not).
      debt: p.kind !== 'refund' && !!left && p.receivedAt > left,
    });
  }
  for (const i of debtIncomes.values()) {
    const jobsPaid = new Map<string, number>();
    for (const p of within.get(i.id) ?? []) jobsPaid.set(p.orderId, (jobsPaid.get(p.orderId) ?? 0) + signed(p));
    payments.push({
      id: i.id,
      source: 'income',
      owner: customerId,
      date: i.date,
      at: momentOf(i.date, i.createdAt),
      amountFils: i.amountFils,
      method: i.method,
      ref: (within.get(i.id) ?? [])[0]?.receiptNumber,
      parts: [...[...jobsPaid].map(([key, amountFils]) => ({ key, amountFils })), ...(i.historyParts ?? []).map((h) => ({ key: historyKey(h.invoiceId), amountFils: h.amountFils }))],
      debt: true,
    });
  }
  return { customer, lines, payments };
}

/** A customer's statement of the invoices of a period as they stand today (`statementOf`, v0.63), with the customer. */
export async function customerStatement(customerId: string, from: string, to: string, asOf = dubaiDate()): Promise<{ customer: Customer; statement: Statement } | undefined> {
  const account = await customerAccount(customerId);
  return account && { customer: account.customer, statement: statementOf(account.lines, account.payments, from, to, asOf) };
}

/** Whom the garage owes, as accounts: every expense on credit (paid off ones too) and every payment of one. */
export async function creditorAccounts(): Promise<{ lines: OwedLine[]; payments: AccountPayment[]; owners: Map<string, { name: string; phone?: string; person: boolean; leftFils: number }> }> {
  const [credits, suppliers, lenders] = await Promise.all([loadCredits(), db.suppliers.toArray(), db.lenders.toArray()]);
  const idx = owedIndex(suppliers, lenders);
  const lines: OwedLine[] = [];
  const payments: AccountPayment[] = [];
  const owners = new Map<string, { name: string; phone?: string; person: boolean; leftFils: number }>();
  for (const { expense: e, paid, leftFils } of credits) {
    const to = owedToOf(e, idx);
    const owner = to?.key ?? '';
    const o = owners.get(owner) ?? owners.set(owner, { name: to?.name ?? '', phone: to?.phone, person: !!to?.lender, leftFils: 0 }).get(owner)!;
    o.leftFils += Math.max(0, leftFils);
    lines.push({ key: e.id, owner, date: e.date, at: momentOf(e.date, e.createdAt), totalFils: e.amountFils, label: [e.vendor, expenseNoteLine(e)].filter(Boolean).join(' · ') || undefined });
    for (const p of paid) payments.push({ id: p.id, source: 'credit', owner, date: p.date, at: momentOf(p.date, p.paidAt), amountFils: p.amountFils, method: p.method, parts: [{ key: e.id, amountFils: p.amountFils }], debt: true });
  }
  return { lines, payments, owners };
}

export type DebtSide = 'owed' | 'owe';

/**
 * What a period picks (v0.63, the user: «когда выбираю период, не получается за этот период скачать, потому что оплата
 * была сегодня»): the invoices of it — and every payment that paid them, whenever it was made (`invoice`); or the payments
 * made in it (`payment`, as in v0.62.2).
 */
export type PaidBy = 'invoice' | 'payment';

export interface PayOwner {
  key: string;
  name: string;
  phone?: string;
  /** A company (a customer), a person (one the garage owes). */
  company?: boolean;
  person?: boolean;
  /** Paid — for the period's invoices, or in the period; how many payments. */
  paidFils: number;
  count: number;
  /** Owed — on the period's invoices now, or (by payments) all of it now. */
  leftFils: number;
}

export interface DebtPayments {
  rows: (PaymentRow & { entry?: LedgerEntry })[];
  /** Who paid or owes — the one who paid most first, then who owes most. */
  owners: PayOwner[];
}

/**
 * «Платежи» (v0.62.2): the payments of debts, the latest first — each with the months and invoices it paid and what was
 * left after it — and, for each one, what was paid and what is left. By invoices (v0.63): the period's invoices and every
 * payment that paid them up to today (a row is the part for them); by payments: the payments made in the period. Customers:
 * «Оплата долга» and a job paid after its car left (paid at the hand-over is not a debt paid); the garage: the payments of
 * its credits. Each row carries its operation of the money book (a tap opens it, as in «Учёт»).
 */
export async function loadDebtPayments(side: DebtSide, from: string, to: string, by: PaidBy = 'payment'): Promise<DebtPayments> {
  if (side === 'owe') return by === 'invoice' ? creditorsFor(from, to) : creditorsPaid(from, to);
  return by === 'invoice' ? customersFor(from, to) : customersPaid(from, to);
}

const ownerOf = (c: Customer, paidFils: number, count: number, leftFils: number): PayOwner => ({
  key: c.id,
  name: (c.type === 'company' && c.companyName ? c.companyName : c.name) || c.phone || '',
  phone: c.phone || undefined,
  company: c.type === 'company',
  paidFils,
  count,
  leftFils,
});

/** What is left of the period's invoices of one account now (the payments up to today). */
const periodLeft = (lines: OwedLine[], payments: AccountPayment[], from: string, to: string) => {
  const applied = appliedBy(payments);
  return lines.reduce((a, l) => a + (l.date >= from && l.date <= to ? l.totalFils - (applied.get(l.key) ?? 0) : 0), 0);
};

async function customersPaid(from: string, to: string): Promise<DebtPayments> {
  // Who paid a debt in the period: «Оплата долга» of that period; a job's payment of it, taken after its car left.
  const [incomes, pays, debtors] = await Promise.all([
    db.incomes.where('date').between(from, to, true, true).toArray(),
    db.payments.where('receivedAt').between(`${shiftDay(from, -1)}T20:00:00.000Z`, `${to}T20:00:00.000Z`, true, true).toArray(),
    loadDebtors(),
  ]);
  const late = pays.filter((p) => !p.incomeId && p.kind === 'payment' && dubaiDate(p.receivedAt) >= from && dubaiDate(p.receivedAt) <= to);
  const jobs = new Map((await db.orders.bulkGet([...new Set(late.map((p) => p.orderId))])).filter((o): o is Order => !!o).map((o) => [o.id, o]));
  const who = new Set<string>();
  for (const i of incomes) if (i.category === 'debt' && !i.voidedAt && i.customerId) who.add(i.customerId);
  for (const p of late) {
    const o = jobs.get(p.orderId);
    if (o?.deliveredAt && p.receivedAt > o.deliveredAt) who.add(o.customerId);
  }
  const accounts = (await Promise.all([...who].map(customerAccount))).filter((a): a is CustomerAccount => !!a);
  const rows = accounts.flatMap((a) => paymentRows(a.lines, a.payments, from, to, (p) => p.debt)).sort(latest);
  const customers = new Map<string, Customer>([...accounts.map((a) => [a.customer.id, a.customer] as const), ...debtors.map((d) => [d.customer.id, d.customer] as const)]);
  const left = new Map(debtors.map((d) => [d.customer.id, d.totalFils]));
  const owners = new Map<string, PayOwner>();
  for (const [id, c] of customers) owners.set(id, ownerOf(c, 0, 0, left.get(id) ?? 0));
  for (const r of rows) {
    const o = owners.get(r.owner)!;
    o.paidFils += r.amountFils;
    o.count++;
  }
  return { rows: await withCustomerEntries(rows), owners: rankOwners(owners) };
}

async function customersFor(from: string, to: string): Promise<DebtPayments> {
  // Whose invoices are of the period: this app's issued in it (its job's customer) and those from before the app.
  const [history, invoices] = await Promise.all([
    db.historyInvoices.where('date').between(from, to, true, true).toArray(),
    db.invoices.where('issuedAt').between(`${shiftDay(from, -1)}T20:00:00.000Z`, `${to}T20:00:00.000Z`, true, true).toArray(),
  ]);
  const issued = invoices.filter((i) => i.type !== 'credit_note' && i.status === 'issued' && dubaiDate(i.issuedAt) >= from && dubaiDate(i.issuedAt) <= to);
  const orders = (await db.orders.bulkGet([...new Set(issued.map((i) => i.orderId))])).filter((o): o is Order => !!o);
  const who = new Set([...history.map((h) => h.customerId), ...orders.map((o) => o.customerId)]);
  const accounts = (await Promise.all([...who].map(customerAccount))).filter((a): a is CustomerAccount => !!a);
  const rows: PaymentRow[] = [];
  const owners = new Map<string, PayOwner>();
  for (const a of accounts) {
    const paid = paymentsFor(a.lines, a.payments, from, to);
    const left = periodLeft(a.lines, a.payments, from, to);
    // A debt: something of it still owed, paid after the car left, or an invoice from before the app — not a job paid
    // at the hand-over.
    if (!(left > 0 || paid.some((p) => p.debt) || a.lines.some((l) => l.key.startsWith('h:') && l.date >= from && l.date <= to))) continue;
    rows.push(...paid);
    owners.set(a.customer.id, ownerOf(a.customer, paid.reduce((s, p) => s + p.amountFils, 0), paid.length, left));
  }
  return { rows: await withCustomerEntries(rows.sort(latest)), owners: rankOwners(owners) };
}

/** A customer's rows with their operations of the money book, to open from a row. */
async function withCustomerEntries(rows: PaymentRow[]): Promise<DebtPayments['rows']> {
  const [incomeRecs, paymentRecs] = await Promise.all([db.incomes.bulkGet(rows.filter((r) => r.source === 'income').map((r) => r.id)), db.payments.bulkGet(rows.filter((r) => r.source === 'payment').map((r) => r.id))]);
  const payments = paymentRecs.filter((x): x is Payment => !!x);
  const orders = (await db.orders.bulkGet([...new Set(payments.map((p) => p.orderId))])).filter((o): o is Order => !!o);
  const entries = entriesOf({ incomes: incomeRecs.filter((x): x is Income => !!x), payments, orders });
  return rows.map((r) => ({ ...r, entry: entries.get(`${r.source}:${r.id}`) }));
}

async function creditorsPaid(from: string, to: string): Promise<DebtPayments> {
  const { lines, payments, owners: who } = await creditorAccounts();
  const rows = paymentRows(lines, payments, from, to);
  const owners = new Map<string, PayOwner>();
  for (const [key, o] of who) owners.set(key, { key, name: o.name, phone: o.phone, person: o.person, paidFils: 0, count: 0, leftFils: o.leftFils });
  for (const r of rows) {
    const o = owners.get(r.owner)!;
    o.paidFils += r.amountFils;
    o.count++;
  }
  return { rows: await withCreditEntries(rows), owners: rankOwners(owners) };
}

async function creditorsFor(from: string, to: string): Promise<DebtPayments> {
  const { lines, payments, owners: who } = await creditorAccounts();
  const rows = paymentsFor(lines, payments, from, to);
  const owners = new Map<string, PayOwner>();
  for (const [key, o] of who) {
    const mine = lines.filter((l) => l.owner === key);
    if (!mine.some((l) => l.date >= from && l.date <= to)) continue;
    const paid = rows.filter((r) => r.owner === key);
    owners.set(key, { key, name: o.name, phone: o.phone, person: o.person, paidFils: paid.reduce((s, r) => s + r.amountFils, 0), count: paid.length, leftFils: periodLeft(mine, payments, from, to) });
  }
  return { rows: await withCreditEntries(rows), owners: rankOwners(owners) };
}

/** The garage's rows with their operations of the money book. */
async function withCreditEntries(rows: PaymentRow[]): Promise<DebtPayments['rows']> {
  const paid = (await db.creditPayments.bulkGet(rows.map((r) => r.id))).filter((x): x is CreditPayment => !!x);
  const expenses = (await db.expenses.bulkGet([...new Set(paid.map((p) => p.expenseId))])).filter((x): x is Expense => !!x);
  const [suppliers, lenders] = await Promise.all([db.suppliers.bulkGet([...new Set(expenses.map((e) => e.supplierId).filter((x): x is string => !!x))]), db.lenders.toArray()]);
  const entries = entriesOf({ creditPayments: paid, expenses, owed: owedIndex(suppliers.filter((s) => !!s) as never, lenders) });
  return rows.map((r) => ({ ...r, entry: entries.get(`credit:${r.id}`) }));
}

const latest = (a: PaymentRow, b: PaymentRow) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id);

const rankOwners = (owners: Map<string, PayOwner>): PayOwner[] => [...owners.values()].filter((o) => o.paidFils || o.leftFils).sort((a, b) => b.paidFils - a.paidFils || b.leftFils - a.leftFils || a.name.localeCompare(b.name));

/** The money book's operations of these records (their balances are not this list's: nothing reads them here). */
function entriesOf(input: { incomes?: Income[]; payments?: Payment[]; creditPayments?: CreditPayment[]; expenses?: Expense[]; orders?: Order[]; owed?: Parameters<typeof buildLedger>[0]['owed'] }): Map<string, LedgerEntry> {
  const { entries } = buildLedger({ cashStartFils: 0, cardStartFils: 0, payments: input.payments ?? [], incomes: input.incomes ?? [], expenses: input.expenses ?? [], movements: [], closings: [], creditPayments: input.creditPayments ?? [], orders: input.orders ?? [], owed: input.owed });
  return new Map(entries.map((e) => [`${e.source}:${e.id}`, e]));
}
