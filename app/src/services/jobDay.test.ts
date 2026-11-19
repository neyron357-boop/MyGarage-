import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate, shiftDay } from '../domain/dates';
import { leftBoardAt } from '../domain/flow';
import { invoiceDayFor, paymentDayFor } from '../domain/jobDay';
import { findVehicleForCheckIn } from './customers';
import { addItem } from './estimate';
import { addPayment, quickInvoice } from './money';
import { changeStage, checkIn, loadOrderBundle, setJobDay } from './orders';
import { ensureSeed } from './seed';

const plate = () => ({ emirate: 'DXB' as const, code: 'J', number: String(10000 + Math.floor(Math.random() * 89999)) });
const job = (extra: { day?: string; vehicleId?: string } = {}) =>
  checkIn({ plate: plate(), make: 'Nissan', model: 'Patrol', name: 'Omar', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true, ...extra });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('a job typed in after the fact (v0.53)', () => {
  it('is on the day it was: its invoice, its payment, its hand-over — the number of that day’s year', async () => {
    const today = dubaiDate();
    const past = shiftDay(today, -30);
    const o = await job({ day: past });
    expect([o.backdated, dubaiDate(o.arrivedAt!), dubaiDate(o.createdAt), dubaiDate(o.updatedAt)]).toEqual([true, past, past, today]);
    // «Готово» offers the job's own day.
    expect(invoiceDayFor(o)).toBe(past);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Engine service', qty: 1, unitPriceFils: 50000 });
    const inv = await quickInvoice(o.id, { day: past });
    expect(dubaiDate(inv.issuedAt)).toBe(past);
    expect(inv.number).toContain(past.slice(0, 4));
    let b = (await loadOrderBundle(o.id))!;
    expect([b.order.stage, dubaiDate(b.order.readyAt!)]).toEqual(['ready', past]);
    // The payment is offered on the invoice's day; paid then, handed over — the archive puts it on that day.
    expect(paymentDayFor(b.order, inv)).toBe(past);
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: inv.totalFils, date: past });
    await changeStage(o.id, 'closed');
    b = (await loadOrderBundle(o.id))!;
    expect([b.order.stage, dubaiDate(b.order.closedAt!), dubaiDate(b.order.deliveredAt!), dubaiDate(leftBoardAt(b.order))]).toEqual(['closed', past, past, past]);
  });

  it('an ordinary job stays today; the invoice not before the job’s day, nor after today', async () => {
    const today = dubaiDate();
    const o = await job();
    expect(o.backdated).toBeUndefined();
    expect(invoiceDayFor(o)).toBe(today);
    expect(paymentDayFor(o, undefined)).toBe(today);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wash', qty: 1, unitPriceFils: 5000 });
    await expect(quickInvoice(o.id, { day: shiftDay(today, -2) })).rejects.toThrow('err.beforeJobDay');
    await expect(quickInvoice(o.id, { day: shiftDay(today, 1) })).rejects.toThrow('err.futureDate');
    await expect(job({ day: shiftDay(today, 1) })).rejects.toThrow('err.futureDate');
  });

  it('«…» → «День»: an earlier day makes it typed in later, today an ordinary one again; not after its invoice', async () => {
    const today = dubaiDate();
    const o = await job();
    await setJobDay(o.id, shiftDay(today, -10));
    let order = (await db.orders.get(o.id))!;
    expect([order.backdated, dubaiDate(order.arrivedAt!), dubaiDate(order.createdAt)]).toEqual([true, shiftDay(today, -10), shiftDay(today, -10)]);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wash', qty: 1, unitPriceFils: 5000 });
    await quickInvoice(o.id, { day: shiftDay(today, -8) });
    await expect(setJobDay(o.id, shiftDay(today, -7))).rejects.toThrow('err.afterJobDocs');
    await expect(setJobDay(o.id, shiftDay(today, 1))).rejects.toThrow('err.futureDate');
    await setJobDay(o.id, shiftDay(today, -9));
    expect(dubaiDate((await db.orders.get(o.id))!.arrivedAt!)).toBe(shiftDay(today, -9));
    const fresh = await job();
    await setJobDay(fresh.id, shiftDay(today, -3));
    await setJobDay(fresh.id, today);
    order = (await db.orders.get(fresh.id))!;
    expect([order.backdated, dubaiDate(order.arrivedAt!)]).toEqual([undefined, today]);
  });
});

describe('a car in work takes a second job (v0.53)', () => {
  it('the same car and customer, two jobs open side by side', async () => {
    const first = await job();
    const v = (await db.vehicles.get(first.vehicleId))!;
    const found = (await findVehicleForCheckIn(v.plate))!;
    expect(found.activeOrder?.id).toBe(first.id);
    const second = await job({ vehicleId: found.vehicle.id });
    expect(second.id).not.toBe(first.id);
    expect([second.vehicleId, second.customerId]).toEqual([first.vehicleId, first.customerId]);
    const open = await db.orders.where('vehicleId').equals(first.vehicleId).filter((x) => x.stage !== 'closed').toArray();
    expect(open).toHaveLength(2);
    expect(await db.vehicles.where('customerId').equals(first.customerId).count()).toBe(1);
  });
});
