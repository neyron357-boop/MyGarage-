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

/** A line on a statement: what was set against it and what is left of it at the end of the period. */
export interface StatementLine extends OwedLine {
  paidFils: number;
  balanceFils: number;
  status: LineStatus;
  /** The day it was paid off (the PAID stamp's). */
  paidOn?: string;
  /** From before the period, still owed when it began. */
  brought: boolean;
}

export interface StatementMonth {
  /** YYYY-MM */
  month: string;
  count: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  status: LineStatus;
  brought: boolean;
}

export interface Statement {
  from: string;
  to: string;
  /** Owed when the period began. */
  openingFils: number;
  /** What the invoices of the period came to. */
  invoicedFils: number;
  /** What the payments of the period set against the invoices. */
  paidFils: number;
  /** What the payments of the period set against none (money on account — not counted off the invoices). */
  unappliedFils: number;
  /** Owed when the period ended: opening + invoiced − paid. */
  closingFils: number;
  /** The invoices of the period, and those from before it still owed when it began — the oldest first. */
  lines: StatementLine[];
  months: StatementMonth[];
  /** Every payment of the period, the oldest first, each with what was owed after it. */
  payments: PaymentRow[];
}

/** One owner's account over a period, as a statement of account shows it. */
export function statementOf(lines: OwedLine[], payments: AccountPayment[], from: string, to: string): Statement {
  const start = dayStart(from);
  const end = dayEnd(to);
  const before = appliedBy(payments, start);
  const by = appliedBy(payments, end);
  const shown: StatementLine[] = [];
  for (const l of [...lines].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))) {
    const inPeriod = l.at >= start && l.at <= end;
    const brought = l.at < start && l.totalFils - (before.get(l.key) ?? 0) > 0;
    if (!inPeriod && !brought) continue;
    const paidFils = by.get(l.key) ?? 0;
    const balanceFils = l.totalFils - paidFils;
    shown.push({ ...l, paidFils, balanceFils, status: statusOf(l.totalFils, balanceFils), paidOn: balanceFils <= 0 ? paidOffOn(l, payments, end) : undefined, brought: !inPeriod });
  }
  const months = new Map<string, StatementMonth>();
  for (const l of shown) {
    const month = l.date.slice(0, 7);
    const m = months.get(month) ?? months.set(month, { month, count: 0, totalFils: 0, paidFils: 0, balanceFils: 0, status: 'unpaid', brought: l.brought }).get(month)!;
    m.count++;
    m.totalFils += l.totalFils;
    m.paidFils += l.paidFils;
    m.balanceFils += l.balanceFils;
    m.brought &&= l.brought;
  }
  for (const m of months.values()) m.status = statusOf(m.totalFils, m.balanceFils);
  const keys = new Set(lines.map((l) => l.key));
  const inside = payments.filter((p) => p.at >= start && p.at <= end);
  const paidFils = inside.reduce((a, p) => a + p.parts.reduce((s, x) => s + (keys.has(x.key) ? x.amountFils : 0), 0), 0);
  const invoicedFils = lines.reduce((a, l) => a + (l.at >= start && l.at <= end ? l.totalFils : 0), 0);
  const rows = paymentRows(lines, payments, from, to).reverse();
  return {
    from,
    to,
    openingFils: balanceAt(lines, payments, start),
    invoicedFils,
    paidFils,
    unappliedFils: rows.reduce((a, r) => a + Math.max(0, r.restFils), 0),
    closingFils: balanceAt(lines, payments, end),
    lines: shown,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    payments: rows,
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
