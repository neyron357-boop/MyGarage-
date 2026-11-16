import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import type { CashClosing } from '../domain/types';
import { countedBy } from './cashDays';
import { removeEntry, restoreEntry, updateEntry } from './entries';
import { addItem } from './estimate';
import { approveAll } from './flow';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { addExpense, addPayment, cashState, closeCashDay, quickInvoice } from './money';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

/*
 * v0.23.1 — which day closing counted an operation: typed on its own day — the first closing after it was typed;
 * typed on a later day (or moved to an earlier one) — that day's own count, whatever the hour it was typed at; moved
 * to today — counted by the next count. The clock is set by hand here (a file of its own: moments only go forward).
 */

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const cat = async (code: string) => (await db.expenseCategories.where('code').equals(code).first())!.id;
const cash = async () => {
  const [book, box] = await Promise.all([loadLedger(), cashState()]);
  expect(book.cash).toBe(box.expected);
  return book.cash;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterAll(() => {
  vi.useRealTimers();
});

let day = 0;
/** A fresh book and a clock on a new day each time (moments only go forward). */
beforeEach(async () => {
  day += 10;
  at(new Date(Date.UTC(2027, 1, day, 5)).toISOString());
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  await setOpeningBalances(100_000, 0);
});

/** Day `n` of this test's days, `hh:mm` Dubai. */
const t = (n: number, hhmm: string) => {
  const d = new Date(Date.UTC(2027, 1, day + n));
  return new Date(`${d.toISOString().slice(0, 10)}T${hhmm}:00+04:00`).toISOString();
};
const dayOf = (n: number) => new Date(Date.UTC(2027, 1, day + n)).toISOString().slice(0, 10);

describe('which closing counted an operation', () => {
  it('the rule itself', () => {
    const c = (id: string, closedAt: string) => ({ id, closedAt }) as CashClosing;
    const list = [c('a', '2027-01-05T08:00:00.000Z'), c('b', '2027-01-05T15:00:00.000Z'), c('c', '2027-01-08T15:00:00.000Z')];
    const now = '2027-01-09T06:00:00.000Z';
    // Typed on its day: the first count after it (12:00 Dubai of the 5th — between the two counts of that day).
    expect(countedBy('2027-01-05', '2027-01-05T08:30:00.000Z', list, now)).toBe('b');
    // Typed later for the 5th: the 5th's own last count, at any hour it is typed.
    expect(countedBy('2027-01-05', '2027-01-07T18:00:00.000Z', list, now)).toBe('b');
    expect(countedBy('2027-01-05', '2027-01-07T02:00:00.000Z', list, now)).toBe('b');
    // A day with no count of its own: the first count after it.
    expect(countedBy('2027-01-06', '2027-01-07T18:00:00.000Z', list, now)).toBe('c');
    // Moved to today: not counted yet.
    expect(countedBy('2027-01-09', '2027-01-04T10:00:00.000Z', list, now)).toBeUndefined();
  });

  it('typed the next day at 20:00 for a day counted at 19:00: in that day’s count, the box as it was', async () => {
    at(t(0, '19:00'));
    const c = await closeCashDay(100_000);
    at(t(1, '20:00'));
    await addExpense({ date: dayOf(0), categoryId: await cat('parts'), amountFils: 3_000, vatFils: 0, method: 'cash' });
    expect((await db.cashMovements.toArray()).map((m) => m.closingId)).toEqual([c.id]);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashOutFils: 3_000, diffFils: 3_000 });
    expect(await cash()).toBe(100_000);
    // An operation of today, moved to that day in its sheet — the same.
    const i = await addIncome({ category: 'sales', amountFils: 1_000, method: 'cash' });
    await updateEntry({ source: 'income', id: i.id }, { date: dayOf(0) });
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 1_000, cashOutFils: 3_000, diffFils: 2_000 });
    expect(await cash()).toBe(100_000);
  });

  it('a card payment moved to today is not later than now, and is counted once', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: '45454' }, make: 'Toyota', model: 'Camry', name: 'Saeed', phone: '050 765 4321', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Repair', unitPriceFils: 60_000, vatRateBp: 0 });
    await approveAll(o.id);
    await quickInvoice(o.id);
    at(t(0, '20:00'));
    const p = await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 60_000 });
    at(t(1, '10:00'));
    await updateEntry({ source: 'payment', id: p.id }, { date: dayOf(1) });
    expect((await db.payments.get(p.id))!.receivedAt <= new Date().toISOString()).toBe(true);
    at(t(1, '11:00'));
    const c1 = await closeCashDay(100_000);
    expect(c1.cardTotalFils).toBe(60_000);
    at(t(2, '11:00'));
    const c2 = await closeCashDay(100_000);
    expect(c2.cardTotalFils).toBe(0);
  });

  it('«Отменить» of an operation moved to a later day: back in the open cash box, not in the old count', async () => {
    at(t(0, '10:00'));
    const i = await addIncome({ category: 'sales', amountFils: 16_500, method: 'cash' });
    at(t(0, '19:00'));
    const c = await closeCashDay(116_500);
    at(t(1, '11:00'));
    await updateEntry({ source: 'income', id: i.id }, { date: dayOf(1) });
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 0, diffFils: 16_500 });
    expect(await cash()).toBe(133_000);
    const removed = await removeEntry({ source: 'income', id: i.id });
    await restoreEntry(removed);
    expect((await db.cashMovements.toArray()).map((m) => m.closingId)).toEqual([undefined]);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 0, diffFils: 16_500 });
    expect(await cash()).toBe(133_000);
  });
});
