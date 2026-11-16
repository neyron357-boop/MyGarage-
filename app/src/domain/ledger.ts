import { dubaiDate, inRange } from './dates';
import type { CashClosing, CashMovement, CreditPayment, Expense, ExpenseMethod, Income, Order, Payment } from './types';

/*
 * The money book, kept the way the garage keeps its money sheet:
 * - two purses: cash and card (a bank transfer goes with the card);
 * - cash balance = cash start + cash in − cash out (+ the difference found at a day closing);
 * - card balance = card start + card in; money spent by card is tracked ("Card Out") but does NOT
 *   reduce the card balance (it is paid from elsewhere and settled separately).
 *
 * The book is the money that moved (v0.20): an expense taken on credit is not a line of it — what is paid towards
 * it later is ("credit"), on the day and by the way it is paid. A customer's debt paid at once for several jobs is
 * one line, the income; the jobs' payments it was spread into are not lines of their own.
 */

export type Purse = 'cash' | 'card';
export const purseOf = (m: ExpenseMethod): Purse => (m === 'cash' ? 'cash' : 'card');

export type LedgerSource = 'payment' | 'income' | 'expense' | 'credit' | 'movement' | 'closing';

export interface LedgerEntry {
  /** Source record id (payment, income, expense, payment of a credit, cash movement or closing). */
  id: string;
  source: LedgerSource;
  /** Sort key: the entry's day, then the moment it was recorded. */
  at: string;
  date: string; // YYYY-MM-DD (Dubai)
  kind: 'in' | 'out';
  purse: Purse;
  /** How it was paid; "credit" only on an expense opened from the expenses (it is not a line of the book). */
  method?: ExpenseMethod;
  /** Positive; a refund to a customer is an "out" of its purse. */
  amountFils: number;
  /** "order", "refund", income category, expense category id, "credit_payment", or a cash reason ("collection"…). */
  category: string;
  /** A payment of a credit: the expense it pays off. */
  credit?: { expenseId: string; categoryId: string };
  note?: string;
  /** Expenses: where it was bought and the note as typed (`note` shows both). */
  vendor?: string;
  expenseNote?: string;
  orderId?: string;
  vehicleId?: string;
  customerId?: string;
  receiptMediaId?: string;
  /** Day closing: counted cash and the difference. */
  closing?: { actualFils: number; diffFils: number };
  /**
   * A cash movement of a cancelled operation (its own, or the reversal the old «Отменить запись» left): the book leaves
   * it out, the cash box shows it; it is only deleted — with its operation, the pair at once (services/entries.ts).
   */
  cancelled?: boolean;
  /** Balances after this entry. */
  cashAfter: number;
  cardAfter: number;
}

export interface LedgerInput {
  cashStartFils: number;
  cardStartFils: number;
  payments: Payment[];
  incomes: Income[];
  expenses: Expense[];
  movements: CashMovement[];
  closings: CashClosing[];
  /** What was paid towards expenses taken on credit. */
  creditPayments?: CreditPayment[];
  orders: Pick<Order, 'id' | 'vehicleId' | 'customerId'>[];
}

export interface PurseTotals {
  inFils: number;
  outFils: number;
}

export interface LedgerResult {
  /** Oldest first, with running balances. */
  entries: LedgerEntry[];
  cash: number;
  card: number;
}

/** Day + time of recording: an entry dated earlier than it was typed sorts on its own day. */
const sortKey = (date: string, recordedAt: string) => `${date}T${dubaiTime(recordedAt)}`;
const dubaiTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  return d.toISOString().slice(11, 23);
};

type Raw = Omit<LedgerEntry, 'cashAfter' | 'cardAfter'>;

/** An expense as a line of the book (without the balances after it). */
export function expenseEntry(e: Expense): Omit<LedgerEntry, 'cashAfter' | 'cardAfter'> {
  return {
    id: e.id,
    source: 'expense',
    at: sortKey(e.date, e.createdAt),
    date: e.date,
    kind: 'out',
    purse: purseOf(e.method),
    method: e.method,
    amountFils: e.amountFils,
    category: e.categoryId,
    note: [e.vendor, e.note].filter(Boolean).join(' · ') || undefined,
    vendor: e.vendor || undefined,
    expenseNote: e.note || undefined,
    receiptMediaId: e.receiptMediaId,
    orderId: e.orderId,
    vehicleId: e.vehicleId,
    customerId: e.customerId,
  };
}

/** A cash movement as a line of the book (without the links of its job and the balances after it). */
export function movementEntry(m: CashMovement): Omit<LedgerEntry, 'cashAfter' | 'cardAfter'> {
  const date = dubaiDate(m.at);
  return {
    id: m.id,
    source: 'movement',
    at: sortKey(date, m.at),
    date,
    kind: m.direction,
    purse: 'cash',
    method: 'cash',
    amountFils: m.amountFils,
    category: m.reason,
    note: m.note,
    orderId: m.orderId,
  };
}

/** What was paid towards an expense taken on credit, as a line of the book (without the balances after it). */
export function creditEntry(c: CreditPayment, e: Expense): Omit<LedgerEntry, 'cashAfter' | 'cardAfter'> {
  return {
    id: c.id,
    source: 'credit',
    at: sortKey(c.date, c.paidAt),
    date: c.date,
    kind: 'out',
    purse: purseOf(c.method),
    method: c.method,
    amountFils: c.amountFils,
    category: 'credit_payment',
    note: [e.vendor, c.note ?? e.note].filter(Boolean).join(' · ') || undefined,
    credit: { expenseId: e.id, categoryId: e.categoryId },
    orderId: e.orderId,
    vehicleId: e.vehicleId,
    customerId: e.customerId,
  };
}

/**
 * The line of the book a cash movement is: the job's payment, the income, the expense or the payment of a credit
 * it came with, else the movement itself (parts bought for cash, cash handed over, a correction).
 */
export function entryRefOf(m: Pick<CashMovement, 'id' | 'paymentId' | 'incomeId' | 'expenseId' | 'creditPaymentId'>): { source: LedgerSource; id: string } {
  if (m.paymentId) return { source: 'payment', id: m.paymentId };
  if (m.incomeId) return { source: 'income', id: m.incomeId };
  if (m.expenseId) return { source: 'expense', id: m.expenseId };
  if (m.creditPaymentId) return { source: 'credit', id: m.creditPaymentId };
  return { source: 'movement', id: m.id };
}

/**
 * The cash box's lines, each with the line of the book it opens as (`entryRefOf`); a movement of a cancelled
 * entry — which the book leaves out — opens as the movement itself.
 */
export function withEntries<T extends { m: CashMovement; after: number }>(lines: T[], entries: LedgerEntry[]): (T & { entry: LedgerEntry })[] {
  const byRef = new Map(entries.map((e) => [`${e.source} ${e.id}`, e]));
  return lines.map((l) => {
    const r = entryRefOf(l.m);
    return { ...l, entry: byRef.get(`${r.source} ${r.id}`) ?? { ...movementEntry(l.m), cancelled: r.source !== 'movement' || undefined, cashAfter: l.after, cardAfter: 0 } };
  });
}

export function buildLedger(input: LedgerInput): LedgerResult {
  const orders = new Map(input.orders.map((o) => [o.id, o]));
  const linkOf = (orderId?: string, vehicleId?: string, customerId?: string) => {
    const o = orderId ? orders.get(orderId) : undefined;
    return { orderId, vehicleId: vehicleId ?? o?.vehicleId, customerId: customerId ?? o?.customerId };
  };
  const raw: Raw[] = [];

  for (const p of input.payments) {
    // Received within a "debt payment": that income is the line (one movement of money, however many jobs).
    if (p.incomeId) continue;
    const date = dubaiDate(p.receivedAt);
    raw.push({
      id: p.id,
      source: 'payment',
      at: sortKey(date, p.receivedAt),
      date,
      kind: p.kind === 'refund' ? 'out' : 'in',
      purse: purseOf(p.method),
      method: p.method,
      amountFils: p.amountFils,
      category: p.kind === 'refund' ? 'refund' : p.kind === 'prepayment' ? 'prepayment' : 'order',
      note: p.reference,
      ...linkOf(p.orderId, undefined, p.customerId),
    });
  }
  for (const i of input.incomes) {
    if (i.voidedAt) continue;
    raw.push({
      id: i.id,
      source: 'income',
      at: sortKey(i.date, i.createdAt),
      date: i.date,
      kind: 'in',
      purse: purseOf(i.method),
      method: i.method,
      amountFils: i.amountFils,
      category: i.category,
      note: i.note,
      ...linkOf(i.orderId, i.vehicleId, i.customerId),
    });
  }
  const expenses = new Map(input.expenses.map((e) => [e.id, e]));
  for (const e of input.expenses) {
    // On credit: no money has moved — its payments are the lines.
    if (e.voidedAt || e.method === 'credit') continue;
    raw.push({ ...expenseEntry(e), ...linkOf(e.orderId, e.vehicleId, e.customerId) });
  }
  for (const c of input.creditPayments ?? []) {
    const e = expenses.get(c.expenseId);
    if (c.voidedAt || !e) continue;
    raw.push({ ...creditEntry(c, e), ...linkOf(e.orderId, e.vehicleId, e.customerId) });
  }
  // Cash movements not shown through their payment, income, expense or payment of a credit: parts bought for
  // cash, supplier refunds, handing cash to the owner, corrections. Reversals of cancelled entries are
  // left out together with the entry itself.
  for (const m of input.movements) {
    if (m.paymentId || m.expenseId || m.incomeId || m.creditPaymentId) continue;
    raw.push({ ...movementEntry(m), ...linkOf(m.orderId) });
  }
  for (const c of input.closings) {
    const date = dubaiDate(c.closedAt);
    raw.push({
      id: c.id,
      source: 'closing',
      at: sortKey(date, c.closedAt),
      date,
      kind: c.diffFils < 0 ? 'out' : 'in',
      purse: 'cash',
      amountFils: Math.abs(c.diffFils),
      category: 'closing',
      note: c.comment,
      closing: { actualFils: c.actualFils, diffFils: c.diffFils },
    });
  }

  raw.sort((a, b) => a.at.localeCompare(b.at) || (a.source === 'closing' ? 1 : 0) - (b.source === 'closing' ? 1 : 0));
  let cash = input.cashStartFils;
  let card = input.cardStartFils;
  const entries: LedgerEntry[] = raw.map((r) => {
    // A day closing adds its difference, so the balance follows the counted cash. (Not a reset to the
    // counted amount: an entry typed later with an earlier date must still count.)
    if (r.purse === 'cash') cash += r.kind === 'in' ? r.amountFils : -r.amountFils;
    else if (r.kind === 'in') card += r.amountFils;
    else if (r.category === 'refund') card -= r.amountFils; // money given back to a customer leaves the card account
    // other card spending: tracked, the card balance stays
    return { ...r, cashAfter: cash, cardAfter: card };
  });
  return { entries, cash, card };
}

/** In / out of each purse over a period (YYYY-MM-DD, inclusive); a closing difference counts as in or out. */
export function periodTotals(entries: LedgerEntry[], from: string, to: string): Record<Purse, PurseTotals> {
  const t: Record<Purse, PurseTotals> = { cash: { inFils: 0, outFils: 0 }, card: { inFils: 0, outFils: 0 } };
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    if (e.kind === 'in') t[e.purse].inFils += e.amountFils;
    else t[e.purse].outFils += e.amountFils;
  }
  return t;
}
