import { describe, expect, it } from 'vitest';
import { appliedBy, balanceAt, dayEnd, dayStart, momentOf, paidOffOn, paymentRows, periodRange, statementOf, statusOf, type AccountPayment, type OwedLine } from './account';

// A company's account: August and September from before the app, an October job, a November job.
const line = (key: string, date: string, totalFils: number, number = key): OwedLine => ({ key, owner: 'acme', date, at: momentOf(date), totalFils, number });
const pay = (id: string, date: string, amountFils: number, parts: [string, number][], more: Partial<AccountPayment> = {}): AccountPayment => ({
  id,
  source: 'income',
  owner: 'acme',
  date,
  at: momentOf(date, `${date}T08:00:00.000Z`),
  amountFils,
  method: 'transfer',
  parts: parts.map(([key, amountFils]) => ({ key, amountFils })),
  debt: true,
  ...more,
});
const lines = [line('h:aug-1', '2026-08-04', 210_000, '201'), line('h:aug-2', '2026-08-19', 95_000, '214'), line('h:sep-1', '2026-09-09', 160_000, '230'), line('o-oct', '2026-10-06', 120_000, 'INV-2026-350'), line('o-nov', '2026-11-20', 45_000, 'INV-2026-352')];
const payments = [
  pay('p1', '2026-09-30', 305_000, [
    ['h:aug-1', 210_000],
    ['h:aug-2', 95_000],
  ]),
  pay('p2', '2026-10-15', 100_000, [['h:sep-1', 100_000]]),
  pay('p3', '2026-11-02', 70_000, [['h:sep-1', 60_000]]),
];

describe('an account (v0.62.2)', () => {
  it('a moment orders the day first, then the time in Dubai; a day’s start and end hold every moment of it', () => {
    expect(momentOf('2026-11-02', '2026-11-02T08:00:00.000Z')).toBe('2026-11-02T12:00:00.000');
    expect(momentOf('2026-11-01', '2026-11-02T08:00:00.000Z') < momentOf('2026-11-02')).toBe(true);
    expect(dayStart('2026-11-02') < momentOf('2026-11-02')).toBe(true);
    expect(dayStart('2026-11-02') > momentOf('2026-11-01', '2026-11-01T19:59:00.000Z')).toBe(true);
    expect(dayEnd('2026-11-02') > momentOf('2026-11-02', '2026-11-02T19:59:59.999Z')).toBe(true);
  });

  it('what was owed at a moment — the lines by then less what was set against them by then', () => {
    expect(balanceAt(lines, payments, dayEnd('2026-08-31'))).toBe(305_000);
    expect(balanceAt(lines, payments, dayEnd('2026-09-30'))).toBe(160_000);
    expect(balanceAt(lines, payments, dayEnd('2026-11-30'))).toBe(165_000);
    expect(appliedBy(payments).get('h:sep-1')).toBe(160_000);
  });

  it('a line paid off on its last payment’s day; part paid — no day', () => {
    expect(paidOffOn(lines[0], payments)).toBe('2026-09-30');
    expect(paidOffOn(lines[2], payments)).toBe('2026-11-02');
    expect(paidOffOn(lines[2], payments, dayEnd('2026-10-31'))).toBeUndefined();
    expect(paidOffOn(lines[3], payments)).toBeUndefined();
    expect([statusOf(100, 0), statusOf(100, 40), statusOf(100, 100)]).toEqual(['paid', 'part', 'unpaid']);
  });

  it('the payments of a period, the latest first: the months and invoices each paid, the rest, what was owed after it', () => {
    const rows = paymentRows(lines, payments, '2026-10-01', '2026-11-30');
    expect(rows.map((r) => [r.id, r.months, r.numbers, r.restFils, r.leftFils])).toEqual([
      ['p3', ['2026-09'], ['230'], 10_000, 120_000],
      ['p2', ['2026-09'], ['230'], 0, 180_000],
    ]);
    expect(paymentRows(lines, payments, '2026-01-01', '2026-12-31', (p) => p.id === 'p1').map((r) => r.id)).toEqual(['p1']);
  });

  it('a statement of October–November adds up: opening + invoiced − paid = closing; September brought in, August not', () => {
    const s = statementOf(lines, payments, '2026-10-01', '2026-11-30');
    expect([s.openingFils, s.invoicedFils, s.paidFils, s.unappliedFils, s.closingFils]).toEqual([160_000, 165_000, 160_000, 10_000, 165_000]);
    expect(s.openingFils + s.invoicedFils - s.paidFils).toBe(s.closingFils);
    expect(s.lines.map((l) => [l.number, l.paidFils, l.balanceFils, l.status, l.paidOn ?? '', l.brought])).toEqual([
      ['230', 160_000, 0, 'paid', '2026-11-02', true],
      ['INV-2026-350', 0, 120_000, 'unpaid', '', false],
      ['INV-2026-352', 0, 45_000, 'unpaid', '', false],
    ]);
    expect(s.months.map((m) => [m.month, m.count, m.totalFils, m.paidFils, m.balanceFils, m.status, m.brought])).toEqual([
      ['2026-09', 1, 160_000, 160_000, 0, 'paid', true],
      ['2026-10', 1, 120_000, 0, 120_000, 'unpaid', false],
      ['2026-11', 1, 45_000, 0, 45_000, 'unpaid', false],
    ]);
    // The payments the oldest first, each with what was owed after it.
    expect(s.payments.map((p) => [p.id, p.leftFils])).toEqual([
      ['p2', 180_000],
      ['p3', 120_000],
    ]);
  });

  it('a statement of everything: every invoice, the paid ones too; a refund counts back', () => {
    const refund = pay('r1', '2026-11-21', -5_000, [['h:aug-2', -5_000]], { source: 'payment', debt: false });
    const s = statementOf(lines, [...payments, refund], '2000-01-01', '2026-11-30');
    expect(s.openingFils).toBe(0);
    expect(s.lines).toHaveLength(5);
    expect(s.lines.find((l) => l.key === 'h:aug-2')).toMatchObject({ balanceFils: 5_000, status: 'part' });
    expect(s.openingFils + s.invoicedFils - s.paidFils).toBe(s.closingFils);
    expect(s.closingFils).toBe(170_000);
  });

  it('periods: a month to its last day, this year, all up to today, two days in either order', () => {
    expect(periodRange('month', { month: '2026-02' }, '2026-11-21')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('year', {}, '2026-11-21')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('all', {}, '2026-11-21')).toEqual({ from: '2000-01-01', to: '2026-11-21' });
    expect(periodRange('custom', { from: '2026-11-10', to: '2026-10-01' }, '2026-11-21')).toEqual({ from: '2026-10-01', to: '2026-11-10' });
  });
});
