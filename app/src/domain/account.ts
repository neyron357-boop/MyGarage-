import { monthKey } from './dates';
import type { ExpenseMethod } from './types';

/*
 * An account — a customer's with the garage, or the garage's with one it owes (v0.62.2, the user: «после оплаты долга,
 * например, за несколько месяцев — отдельная таблица этих платежей: сколько заплатили, сколько осталось, с выбором
 * периода»; «прозрачная картина / отчёт для клиента: за что оплачено, что осталось — подробная и очень грамотная»;
 * «если долги за месяцы оплачены — на инвойсы этих месяцев печать PAID»).
 *
 * What is owed (`OwedLine`: an invoice of a job gone, one from before the app, an expense on credit) and the payments set
 * against it (`AccountPayment.parts`) — each with its moment, so what was owed at any moment is counted from them
 * (`balanceAt`): before a period, after it, after each payment. A statement of a period (`statementOf`) adds up as an
 * account does: opening + invoiced − paid = closing, to the fils. Nothing here is stored — the figures come from the
 * invoices and payments as they are now (a payment deleted takes its part with it).
 */

/** Something owed: an invoice (this app's job — keyed by its job; one from before the app — `h:` its id) or a credit. */
export interface OwedLine {
  key: string;
  /** Whose: the customer, or (the garage's) the one it owes. */
  owner: string;
  /** YYYY-MM-DD */
  date: string;
  /** Its moment (`momentOf`): the order of everything on the account. */
  at: string;
  totalFils: number;
  /** As printed: "INV-2026-351", "224". */
  number?: string;
  /** What it is for: "Nissan Urvan · K 71001", "Запчасти · Al Noor". */
  label?: string;
}

/** A payment on the account: what it set against which line (`parts` — a refund less than nothing); the rest, against none. */
export interface AccountPayment {
  id: string;
  /** Its record in the money book: a job's payment, an income («Оплата долга»), a payment of a credit. */
  source: 'payment' | 'income' | 'credit';
  owner: string;
  /** YYYY-MM-DD */
  date: string;
  at: string;
  /** The whole sum (a refund — less than nothing). */
  amountFils: number;
  method: ExpenseMethod;
  /** Its receipt («RC-2026-00012»). */
  ref?: string;
  parts: { key: string; amountFils: number }[];
  /** A payment of a debt: «Оплата долга», a job paid after its car left, a credit paid. */
  debt: boolean;
}

const dubaiClock = (iso: string) => new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString().slice(11, 23);

/** A moment on an account: the day it stands on, then the time it was typed (Dubai) — as the money book orders its lines. */
export const momentOf = (day: string, iso?: string): string => `${day}T${iso ? dubaiClock(iso) : '00:00:00.000'}`;
/** Before every moment of a day, after every moment of the day before. */
export const dayStart = (day: string): string => `${day}T`;
/** After every moment of a day. */
export const dayEnd = (day: string): string => `${day}T￿`;

/** What was owed at a moment: what the lines came to by then, less what was set against them by then. */
export function balanceAt(lines: OwedLine[], payments: AccountPayment[], at: string): number {
  const keys = new Set(lines.map((l) => l.key));
  let sum = 0;
  for (const l of lines) if (l.at <= at) sum += l.totalFils;
  for (const p of payments) if (p.at <= at) for (const x of p.parts) if (keys.has(x.key)) sum -= x.amountFils;
  return sum;
}

/** What was set against each line by a moment (none — every moment). */
export function appliedBy(payments: AccountPayment[], at = '￿'): Map<string, number> {
  const by = new Map<string, number>();
  for (const p of payments) if (p.at <= at) for (const x of p.parts) by.set(x.key, (by.get(x.key) ?? 0) + x.amountFils);
  return by;
}

/** The day a line was paid off — its last payment's day — when nothing is left of it (by `at`); else none. */
export function paidOffOn(line: OwedLine, payments: AccountPayment[], at = '￿'): string | undefined {
  if (line.totalFils <= 0) return undefined;
  let paid = 0;
  let last: string | undefined;
  for (const p of [...payments].filter((x) => x.at <= at).sort((a, b) => a.at.localeCompare(b.at)))
    for (const x of p.parts)
      if (x.key === line.key) {
        paid += x.amountFils;
        if (x.amountFils > 0) last = p.date;
      }
  return paid >= line.totalFils ? last : undefined;
}

export type LineStatus = 'paid' | 'part' | 'unpaid';
export const statusOf = (totalFils: number, balanceFils: number): LineStatus => (balanceFils <= 0 ? 'paid' : balanceFils < totalFils ? 'part' : 'unpaid');

/** A payment as a row: the months and invoices it paid, what went to none of them, and what its owner still owed after it. */
export interface PaymentRow extends AccountPayment {
  /** YYYY-MM, the oldest first. */
  months: string[];
  numbers: string[];
  restFils: number;
  leftFils: number;
  /** The whole payment, when the row is only its part for a period's invoices (`paymentsFor`). */
  wholeFils?: number;
}

/** The payments of a period (`which` of them), the latest first, each with what its owner owed right after it. */
export function paymentRows(lines: OwedLine[], payments: AccountPayment[], from: string, to: string, which: (p: AccountPayment) => boolean = () => true): PaymentRow[] {
  const linesOf = new Map<string, OwedLine[]>();
  for (const l of lines) linesOf.set(l.owner, [...(linesOf.get(l.owner) ?? []), l]);
  const paysOf = new Map<string, AccountPayment[]>();
  for (const p of payments) paysOf.set(p.owner, [...(paysOf.get(p.owner) ?? []), p]);
  const line = new Map(lines.map((l) => [l.key, l]));
  return payments
    .filter((p) => p.date >= from && p.date <= to && which(p))
    .map((p) => {
      const paid = p.parts.map((x) => line.get(x.key)).filter((l): l is OwedLine => !!l);
      const applied = p.parts.reduce((a, x) => a + (line.has(x.key) ? x.amountFils : 0), 0);
      return {
        ...p,
        months: [...new Set(paid.map((l) => l.date.slice(0, 7)))].sort(),
        numbers: [...new Set(paid.map((l) => l.number).filter((n): n is string => !!n))],
        restFils: p.amountFils - applied,
        leftFils: balanceAt(linesOf.get(p.owner) ?? [], paysOf.get(p.owner) ?? [], p.at),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

/**
 * The payments that paid the invoices of a period — whenever they were made, up to `asOf` (v0.63, the user: «когда
 * выбираю период, не получается за этот период скачать, потому что оплата была сегодня»): October paid today is paid for
 * October. Each row is the part of the payment set against those invoices (`amountFils`; the whole payment —
 * `wholeFils`, the rest of it went elsewhere — `restFils`), the months and invoices of the period it paid, and what was
 * left of the period's invoices right after it. The latest first.
 */
export function paymentsFor(lines: OwedLine[], payments: AccountPayment[], from: string, to: string, asOf = '￿'): PaymentRow[] {
  const period = lines.filter((l) => l.date >= from && l.date <= to);
  const line = new Map(period.map((l) => [l.key, l]));
  const linesOf = new Map<string, OwedLine[]>();
  for (const l of period) linesOf.set(l.owner, [...(linesOf.get(l.owner) ?? []), l]);
  const paysOf = new Map<string, AccountPayment[]>();
  for (const p of payments) paysOf.set(p.owner, [...(paysOf.get(p.owner) ?? []), p]);
  return payments
    .filter((p) => p.at <= asOf && p.parts.some((x) => line.has(x.key)))
    .map((p) => {
      const mine = p.parts.filter((x) => line.has(x.key));
      const applied = mine.reduce((a, x) => a + x.amountFils, 0);
      const paid = mine.map((x) => line.get(x.key)!);
      return {
        ...p,
        amountFils: applied,
        wholeFils: p.amountFils,
        months: [...new Set(paid.map((l) => l.date.slice(0, 7)))].sort(),
        numbers: [...new Set(paid.map((l) => l.number).filter((n): n is string => !!n))],
        restFils: p.amountFils - applied,
        leftFils: balanceAt(linesOf.get(p.owner) ?? [], paysOf.get(p.owner) ?? [], p.at),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

/** An invoice on a statement: what was paid of it by the statement's day, what is left, its status. */
export interface StatementLine extends OwedLine {
  paidFils: number;
  balanceFils: number;
  status: LineStatus;
  /** The day it was paid off (the PAID stamp's). */
  paidOn?: string;
}

export interface StatementMonth {
  /** YYYY-MM */
  month: string;
  count: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  status: LineStatus;
}

export interface Statement {
  /** The invoices of these days (YYYY-MM-DD)… */
  from: string;
  to: string;
  /** …as they stand on this day: what is paid of them is counted up to it, whenever it was paid. */
  asOf: string;
  /** What the invoices of the period came to, what is paid of them, what is left: invoiced − paid = due. */
  invoicedFils: number;
  paidFils: number;
  dueFils: number;
  /** Owed on the account's other invoices (before the period or after it). */
  otherDueFils: number;
  /** All owed on the account: due + other. */
  totalDueFils: number;
  /** The invoices of the period, the oldest first. */
  lines: StatementLine[];
  months: StatementMonth[];
  /** The payments that paid them (`paymentsFor`), the oldest first. */
  payments: PaymentRow[];
}

/**
 * A statement of the invoices of a period as they stand on a day (v0.63; the account's days before — v0.62.2 — left a
 * month paid later unpaid on its own statement): every invoice dated in the period, what was paid of it by `asOf` and
 * when it was paid off, its months, the payments that paid them, and what else the account owes.
 */
export function statementOf(lines: OwedLine[], payments: AccountPayment[], from: string, to: string, asOf: string): Statement {
  const end = dayEnd(asOf);
  const by = appliedBy(payments, end);
  const shown: StatementLine[] = lines
    .filter((l) => l.date >= from && l.date <= to && l.at <= end)
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))
    .map((l) => {
      const paidFils = by.get(l.key) ?? 0;
      const balanceFils = l.totalFils - paidFils;
      return { ...l, paidFils, balanceFils, status: statusOf(l.totalFils, balanceFils), paidOn: balanceFils <= 0 ? paidOffOn(l, payments, end) : undefined };
    });
  const months = new Map<string, StatementMonth>();
  for (const l of shown) {
    const month = l.date.slice(0, 7);
    const m = months.get(month) ?? months.set(month, { month, count: 0, totalFils: 0, paidFils: 0, balanceFils: 0, status: 'unpaid' }).get(month)!;
    m.count++;
    m.totalFils += l.totalFils;
    m.paidFils += l.paidFils;
    m.balanceFils += l.balanceFils;
  }
  for (const m of months.values()) m.status = statusOf(m.totalFils, m.balanceFils);
  const invoicedFils = shown.reduce((a, l) => a + l.totalFils, 0);
  const paidFils = shown.reduce((a, l) => a + l.paidFils, 0);
  const totalDueFils = balanceAt(lines, payments, end);
  return {
    from,
    to,
    asOf,
    invoicedFils,
    paidFils,
    dueFils: invoicedFils - paidFils,
    otherDueFils: totalDueFils - (invoicedFils - paidFils),
    totalDueFils,
    lines: shown,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    payments: paymentsFor(lines, payments, from, to, end).reverse(),
  };
}

/** The periods a statement or a list of payments is asked for. */
export type PeriodKind = 'month' | 'year' | 'all' | 'custom';

/** A period's first and last day: a month (YYYY-MM), this year, all of it (up to today), or two days in either order. */
export function periodRange(kind: PeriodKind, pick: { month?: string; from?: string; to?: string }, today: string): { from: string; to: string } {
  if (kind === 'month') {
    const month = pick.month ?? monthKey();
    const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
  }
  if (kind === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  if (kind === 'all') return { from: '2000-01-01', to: today };
  const a = pick.from || today;
  const b = pick.to || today;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
