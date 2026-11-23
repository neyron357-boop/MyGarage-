import { describe, expect, it } from 'vitest';
import type { AccountPayment, OwedLine } from './account';
import { jobMonth, lockedMonthOf, monthLocked, withMonthLock } from './monthLock';
import type { Invoice, Order } from './types';
import { dayIn, workMonths } from './workMonths';

const line = (key: string, date: string, totalFils: number, number?: string): OwedLine => ({ key, owner: 'c', date, at: `${date}T10:00:00.000`, totalFils, number });
const pay = (date: string, parts: [string, number][]): AccountPayment => ({ id: `p${date}${parts.length}`, source: 'income', owner: 'c', date, at: `${date}T12:00:00.000`, amountFils: parts.reduce((a, [, f]) => a + f, 0), method: 'cash', parts: parts.map(([key, amountFils]) => ({ key, amountFils })), debt: true });

describe('a customer’s works by month (v0.69)', () => {
  const lines = [line('o1', '2026-06-14', 100_00, 'INV-2026-351'), line('h:a', '2026-06-02', 50_00, '224'), line('o2', '2026-07-01', 80_00, 'INV-2026-360'), line('o3', '2026-06-14', 20_00, 'INV-2026-352')];
  const payments = [pay('2026-07-05', [['h:a', 50_00], ['o1', 40_00]])];
  const months = workMonths(lines, payments, [{ orderId: 'o9', date: '2026-07-20', totalFils: 30_00 }], { lockedMonths: ['2026-06'] });

  it('the newest month first; in a month — by day, then number', () => {
    expect(months.map((m) => m.month)).toEqual(['2026-07', '2026-06']);
    expect(months[1].works.map((w) => w.key)).toEqual(['h:a', 'o1', 'o3']);
  });
  it('what each invoice still owes, the day it was paid off; the month’s sums', () => {
    const june = months[1];
    expect(june.works.map((w) => [w.kind, w.leftFils, w.paidOn ?? ''])).toEqual([
      ['history', 0, '2026-07-05'],
      ['job', 60_00, ''],
      ['job', 20_00, ''],
    ]);
    expect([june.totalFils, june.leftFils, june.locked]).toEqual([170_00, 80_00, true]);
  });
  it('a job still in the workshop is in its month, not in its sums', () => {
    const july = months[0];
    expect([july.totalFils, july.leftFils, july.open, july.locked]).toEqual([80_00, 80_00, 1, false]);
    expect(july.works.find((w) => w.kind === 'open')).toMatchObject({ orderId: 'o9', leftFils: 0 });
  });
  it('a missed job goes on today in this month, else on the month’s last day', () => {
    expect(dayIn('2026-11', '2026-11-23')).toBe('2026-11-23');
    expect(dayIn('2026-02', '2026-11-23')).toBe('2026-02-28');
    expect(dayIn('2026-06', '2026-11-23')).toBe('2026-06-30');
  });
});

describe('closed months (v0.69)', () => {
  const invoice = (issuedAt: string, status: Invoice['status'] = 'issued') => ({ id: issuedAt, type: 'tax_invoice', status, issuedAt, totalFils: 1 }) as Invoice;
  const job = (stage: Order['stage']) => ({ stage, createdAt: '2026-05-30T08:00:00.000Z', deliveredAt: '2026-06-03T08:00:00.000Z' }) as Order;
  it('a job’s month is its invoice’s day in Dubai, else the day its car left', () => {
    // 21:30 UTC on 30 June is 1 July in Dubai.
    expect(jobMonth(job('closed'), [invoice('2026-06-30T21:30:00.000Z')])).toBe('2026-07');
    expect(jobMonth(job('closed'), [invoice('2026-06-01T08:00:00.000Z', 'credited')])).toBe('2026-06');
  });
  it('only a job gone, in a closed month of its customer, is held', () => {
    const c = { lockedMonths: ['2026-06'] };
    expect(lockedMonthOf(job('closed'), [], c)).toBe('2026-06');
    expect(lockedMonthOf(job('delivered'), [], c)).toBe('2026-06');
    expect(lockedMonthOf(job('in_progress'), [], c)).toBeUndefined();
    expect(lockedMonthOf(job('closed'), [], { lockedMonths: ['2026-07'] })).toBeUndefined();
    expect(monthLocked(undefined, '2026-06')).toBe(false);
  });
  it('closing and opening keep one of each, in order; none left — none', () => {
    expect(withMonthLock({ lockedMonths: ['2026-07'] }, '2026-06', true)).toEqual(['2026-06', '2026-07']);
    expect(withMonthLock({ lockedMonths: ['2026-06'] }, '2026-06', true)).toEqual(['2026-06']);
    expect(withMonthLock({ lockedMonths: ['2026-06'] }, '2026-06', false)).toBeUndefined();
  });
});
