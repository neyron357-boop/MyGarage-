import { db } from '../db/db';
import { dubaiDate, shiftDay } from '../domain/dates';
import { momentOf, paymentRows, statementOf, type AccountPayment, type OwedLine, type PaymentRow, type Statement } from '../domain/account';
import { historyKey, owedIndex, owedToOf } from '../domain/debts';
import { activeInvoice } from '../domain/invoice';
import { summarize } from '../domain/items';
import { buildLedger, type LedgerEntry } from '../domain/ledger';
import { formatPlate } from '../domain/plates';
import type { CreditPayment, Customer, Expense, Income, Invoice, Order, OrderItem, Payment } from '../domain/types';
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

/** A customer's statement of account of a period (`statementOf`), with the customer. */
export async function customerStatement(customerId: string, from: string, to: string): Promise<{ customer: Customer; statement: Statement } | undefined> {
  const account = await customerAccount(customerId);
  return account && { customer: account.customer, statement: statementOf(account.lines, account.payments, from, to) };
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
    lines.push({ key: e.id, owner, date: e.date, at: momentOf(e.date, e.createdAt), totalFils: e.amountFils, label: [e.vendor, e.note].filter(Boolean).join(' · ') || undefined });
    for (const p of paid) payments.push({ id: p.id, source: 'credit', owner, date: p.date, at: momentOf(p.date, p.paidAt), amountFils: p.amountFils, method: p.method, parts: [{ key: e.id, amountFils: p.amountFils }], debt: true });
  }
  return { lines, payments, owners };
}

export type DebtSide = 'owed' | 'owe';

export interface PayOwner {
  key: string;
  name: string;
  phone?: string;
  /** A company (a customer), a person (one the garage owes). */
  company?: boolean;
  person?: boolean;
  /** Paid in the period, how many payments. */
  paidFils: number;
  count: number;
  /** Owed now. */
  leftFils: number;
}

export interface DebtPayments {
  rows: (PaymentRow & { entry?: LedgerEntry })[];
  /** Whoever paid in the period or owes now — the one who paid most first, then who owes most. */
  owners: PayOwner[];
}

/**
 * The payments of debts of a period (v0.62.2, «Платежи»), the latest first — each with the months and invoices it paid
 * and what was owed after it — and, for each one, what was paid in the period and what is owed now. Customers: «Оплата
 * долга» and a job paid after its car left (paid at the hand-over is not a debt paid); the garage: the payments of its
 * credits. Each row carries its operation of the money book (a tap opens it, as in «Учёт»).
 */
export async function loadDebtPayments(side: DebtSide, from: string, to: string): Promise<DebtPayments> {
  return side === 'owed' ? customersPaid(from, to) : creditorsPaid(from, to);
}

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
  const rows = accounts.flatMap((a) => paymentRows(a.lines, a.payments, from, to, (p) => p.debt)).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const customers = new Map<string, Customer>([...accounts.map((a) => [a.customer.id, a.customer] as const), ...debtors.map((d) => [d.customer.id, d.customer] as const)]);
  const left = new Map(debtors.map((d) => [d.customer.id, d.totalFils]));
  const owners = new Map<string, PayOwner>();
  for (const [id, c] of customers) owners.set(id, { key: id, name: (c.type === 'company' && c.companyName ? c.companyName : c.name) || c.phone || '', phone: c.phone || undefined, company: c.type === 'company', paidFils: 0, count: 0, leftFils: left.get(id) ?? 0 });
  for (const r of rows) {
    const o = owners.get(r.owner)!;
    o.paidFils += r.amountFils;
    o.count++;
  }
  // Their operations of the money book, to open from a row.
  const [incomeRecs, paymentRecs] = await Promise.all([db.incomes.bulkGet(rows.filter((r) => r.source === 'income').map((r) => r.id)), db.payments.bulkGet(rows.filter((r) => r.source === 'payment').map((r) => r.id))]);
  const entries = entriesOf({ incomes: incomeRecs.filter((x): x is Income => !!x), payments: paymentRecs.filter((x): x is Payment => !!x), orders: [...jobs.values()] });
  return { rows: rows.map((r) => ({ ...r, entry: entries.get(`${r.source}:${r.id}`) })), owners: rankOwners(owners) };
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
  const paid = (await db.creditPayments.bulkGet(rows.map((r) => r.id))).filter((x): x is CreditPayment => !!x);
  const expenses = (await db.expenses.bulkGet([...new Set(paid.map((p) => p.expenseId))])).filter((x): x is Expense => !!x);
  const [suppliers, lenders] = await Promise.all([db.suppliers.bulkGet([...new Set(expenses.map((e) => e.supplierId).filter((x): x is string => !!x))]), db.lenders.toArray()]);
  const entries = entriesOf({ creditPayments: paid, expenses, owed: owedIndex(suppliers.filter((s) => !!s) as never, lenders) });
  return { rows: rows.map((r) => ({ ...r, entry: entries.get(`credit:${r.id}`) })), owners: [...rankOwners(owners)].filter((o) => o.paidFils || o.leftFils) };
}

const rankOwners = (owners: Map<string, PayOwner>): PayOwner[] => [...owners.values()].filter((o) => o.paidFils || o.leftFils).sort((a, b) => b.paidFils - a.paidFils || b.leftFils - a.leftFils || a.name.localeCompare(b.name));

/** The money book's operations of these records (their balances are not this list's: nothing reads them here). */
function entriesOf(input: { incomes?: Income[]; payments?: Payment[]; creditPayments?: CreditPayment[]; expenses?: Expense[]; orders?: Order[]; owed?: Parameters<typeof buildLedger>[0]['owed'] }): Map<string, LedgerEntry> {
  const { entries } = buildLedger({ cashStartFils: 0, cardStartFils: 0, payments: input.payments ?? [], incomes: input.incomes ?? [], expenses: input.expenses ?? [], movements: [], closings: [], creditPayments: input.creditPayments ?? [], orders: input.orders ?? [], owed: input.owed });
  return new Map(entries.map((e) => [`${e.source}:${e.id}`, e]));
}
