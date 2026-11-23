import { appliedBy, paidOffOn, type AccountPayment, type OwedLine } from './account';
import { historyKeyOf } from './debts';
import { monthLocked, type Month } from './monthLock';
import type { Customer } from './types';

/*
 * A customer's works by month (v0.69, the user: «удобное пространство для просмотра всех работ по месяцам… каждый месяц
 * как список, нажал — открылись все работы по датам, каждую можно открыть и редактировать… замок на месяцы… плюс для
 * быстрого добавления упущенных работ»): every invoice on its account — this app's jobs gone, the invoices from before
 * the app — in the month the account puts it (as the statement and «Долги» do), each with what is still owed of it; and
 * the jobs still in the workshop, in the month of their day, not counted yet (they are on the account once their car
 * leaves). The newest month first; in a month — by day. Pure: the account comes from services/account.ts.
 */

export interface MonthWork {
  /** The account's key: a job's id, or `h:` the invoice from before the app; a job in the workshop — its id. */
  key: string;
  kind: 'job' | 'history' | 'open';
  /** YYYY-MM-DD */
  date: string;
  orderId?: string;
  historyId?: string;
  /** As printed: «INV-2026-351», «224»; a job in the workshop — none. */
  number?: string;
  label?: string;
  totalFils: number;
  /** What is still owed of it (a job in the workshop — nothing yet). */
  leftFils: number;
  /** Paid off: the day of its last payment. */
  paidOn?: string;
}

export interface WorkMonth {
  month: Month;
  works: MonthWork[];
  /** What its invoices came to and what is still owed of them (the jobs in the workshop are not in these). */
  totalFils: number;
  leftFils: number;
  /** Jobs of the month still in the workshop. */
  open: number;
  locked: boolean;
}

/** A job still in the workshop, for its month: its day and what its lines come to now. */
export interface OpenWork {
  orderId: string;
  date: string;
  totalFils: number;
  label?: string;
}

export function workMonths(lines: OwedLine[], payments: AccountPayment[], open: OpenWork[], customer?: Pick<Customer, 'lockedMonths'>): WorkMonth[] {
  const applied = appliedBy(payments);
  const by = new Map<Month, WorkMonth>();
  const monthOf = (date: string) => {
    const month = date.slice(0, 7);
    return by.get(month) ?? by.set(month, { month, works: [], totalFils: 0, leftFils: 0, open: 0, locked: monthLocked(customer, month) }).get(month)!;
  };
  for (const l of lines) {
    const m = monthOf(l.date);
    const historyId = historyKeyOf(l.key);
    const leftFils = Math.max(0, l.totalFils - (applied.get(l.key) ?? 0));
    m.works.push({ key: l.key, kind: historyId ? 'history' : 'job', date: l.date, orderId: historyId ? undefined : l.key, historyId, number: l.number, label: l.label, totalFils: l.totalFils, leftFils, paidOn: leftFils ? undefined : paidOffOn(l, payments) });
    m.totalFils += l.totalFils;
    m.leftFils += leftFils;
  }
  for (const o of open) {
    const m = monthOf(o.date);
    m.works.push({ key: o.orderId, kind: 'open', date: o.date, orderId: o.orderId, label: o.label, totalFils: o.totalFils, leftFils: 0 });
    m.open++;
  }
  for (const m of by.values()) m.works.sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? '', undefined, { numeric: true }));
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** The day a missed job of this month is typed in on: today in this month, else its last day (not after today). */
export function dayIn(month: Month, today: string): string {
  if (today.startsWith(month)) return today;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return last < today ? last : today;
}
