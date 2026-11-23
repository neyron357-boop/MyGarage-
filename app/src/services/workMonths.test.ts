import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { addDebtPayment } from './debts';
import { addItem } from './estimate';
import { amendInvoice, approveAll, closeUnpaid, leaveOnDebt } from './flow';
import { discountIssuedInvoice, quickInvoice } from './money';
import { setMonthLocked } from './monthLock';
import { checkIn, createOrder, deleteJob, setJobDay } from './orders';
import { ensureSeed } from './seed';
import { loadWorkMonths } from './workMonths';

/*
 * v0.69: a customer's works by month and its closed months — the user: «удобное пространство для просмотра всех работ по
 * месяцам… замок на месяцы, которые нельзя редактировать… плюс для быстрого добавления упущенных работ».
 */

const signature = () => new Blob(['sig'], { type: 'image/png' });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

/** A job of `customerId` (a new company when none) with one line of `aed`, invoiced and gone on credit. */
async function goneOnCredit(aed: number, customerId?: string, phone = '056 691 7711') {
  const o = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Toyota', model: 'Hilux', customerId, name: customerId ? '' : 'Kabri', phone: customerId ? '' : phone, docLanguage: 'en', complaint: '', arrivedNow: true });
  await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Repair', unitPriceFils: aed * 100, vatRateBp: 0 });
  await approveAll(o.id);
  await quickInvoice(o.id);
  await leaveOnDebt(o.id, { amountFils: aed * 100, dueDate: '2026-12-31', signature: signature() });
  return o;
}

describe('a customer’s works by month (v0.69)', () => {
  it('its jobs gone, each with what is left; a job in the workshop in its month, not in its sums', async () => {
    const a = await goneOnCredit(600);
    const b = await goneOnCredit(400, a.customerId);
    await addDebtPayment({ amountFils: 50_000, method: 'cash', customerId: a.customerId });
    const inWork = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: '77777' }, make: 'Nissan', model: 'Urvan', customerId: a.customerId, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(inWork.id, { kind: 'labor', block: 'A', titleEn: 'Wash', unitPriceFils: 5_000, vatRateBp: 0 });
    const view = (await loadWorkMonths(a.customerId))!;
    const month = dubaiDate().slice(0, 7);
    expect(view.months.map((m) => m.month)).toEqual([month]);
    const m = view.months[0];
    // Paid 500 of 1000, the oldest first: the first job paid off, 100 left of the second.
    expect([m.totalFils, m.leftFils, m.open, view.leftFils]).toEqual([100_000, 50_000, 1, 50_000]);
    const by = new Map(m.works.map((w) => [w.key, w]));
    expect(by.get(a.id)).toMatchObject({ kind: 'job', leftFils: 10_000 });
    expect(by.get(b.id)).toMatchObject({ kind: 'job', leftFils: 40_000 });
    expect(by.get(inWork.id)).toMatchObject({ kind: 'open', totalFils: 5_000 });
    expect(view.jobs.get(inWork.id)?.phase).toBeTruthy();
    expect(view.jobs.get(a.id)?.vehicle?.model).toBe('Hilux');
  });
});

describe('a closed month (v0.69)', () => {
  it('its jobs are not changed, deleted, reopened, moved or written off; nothing goes in; payments do; opened — as before', async () => {
    const a = await goneOnCredit(600);
    const month = dubaiDate().slice(0, 7);
    await setMonthLocked(a.customerId, month, true);
    expect((await db.customers.get(a.customerId))!.lockedMonths).toEqual([month]);
    const refused = { code: 'err.monthLocked' };
    await expect(amendInvoice(a.id)).rejects.toMatchObject(refused);
    await expect(discountIssuedInvoice(a.id, { fils: 1_000 } as never)).rejects.toMatchObject(refused);
    await expect(deleteJob(a.id, { withRecords: true })).rejects.toMatchObject(refused);
    await expect(setJobDay(a.id, dubaiDate())).rejects.toMatchObject(refused);
    await expect(closeUnpaid(a.id)).rejects.toMatchObject(refused);
    // A job of the month in the workshop: worked on — but its invoice does not go into the closed month.
    const inWork = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: '66666' }, make: 'Nissan', model: 'Urvan', customerId: a.customerId, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(inWork.id, { kind: 'labor', block: 'A', titleEn: 'Wash', unitPriceFils: 5_000, vatRateBp: 0 });
    await approveAll(inWork.id);
    await expect(quickInvoice(inWork.id)).rejects.toMatchObject(refused);
    // Payments come in as always.
    await addDebtPayment({ amountFils: 10_000, method: 'cash', customerId: a.customerId });
    expect((await loadWorkMonths(a.customerId))!.months[0]).toMatchObject({ locked: true, leftFils: 50_000 });
    // Opened again: changed as before.
    await setMonthLocked(a.customerId, month, false);
    expect((await db.customers.get(a.customerId))!.lockedMonths).toBeUndefined();
    await amendInvoice(a.id);
    expect((await db.invoices.where('orderId').equals(a.id).toArray()).some((i) => i.type === 'credit_note')).toBe(true);
  });

  it('a job typed in on a day of a closed month is refused; another customer’s month is not closed by it', async () => {
    const a = await goneOnCredit(300);
    const b = await goneOnCredit(200, undefined, '050 222 3344');
    const vehicle = (await db.orders.get(a.id))!.vehicleId;
    await setMonthLocked(a.customerId, '2026-01', true);
    await expect(createOrder({ customerId: a.customerId, vehicleId: vehicle, complaint: '', arrivedNow: true, day: '2026-01-15' })).rejects.toMatchObject({ code: 'err.monthLocked' });
    const other = (await db.orders.get(b.id))!.vehicleId;
    await expect(createOrder({ customerId: b.customerId, vehicleId: other, complaint: '', arrivedNow: true, day: '2026-01-15' })).resolves.toBeTruthy();
  });
});
