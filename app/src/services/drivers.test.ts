import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { companyDrivers, driverJobs, setJobDriver, suggestDrivers, updateDriver, archiveDriver, clearJobDriver, restoreJobDriver } from './drivers';
import { createCustomer, createVehicle } from './customers';
import { loadDebtors } from './debts';
import { addItem } from './estimate';
import { approveAll, leaveOnDebt } from './flow';
import { quickInvoice } from './money';
import { bundleAmountDue, checkIn, loadOrderBundle } from './orders';
import { ensureSeed } from './seed';

/*
 * The checks the task asked for (v0.43): a company's job with a new driver; the saved one picked again (no second
 * record); one car with different drivers; one driver with different cars; his phone changed without touching the
 * jobs before; jobs from before (and a database from before) without drivers; the debt stays the company's; all of
 * it there after the app is opened again.
 */

let name = '';
beforeEach(async () => {
  db.close();
  name = `test-${uid()}`;
  setDb(new GarageDB(name));
  await ensureSeed();
});

const company = () => createCustomer({ name: 'Rashid', phone: '04 333 4455', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'company', companyName: 'ABC TRANSPORT LLC' });
const car = (customerId: string, number: string, model = 'Hiace') => createVehicle(customerId, { plate: { emirate: 'DXB', code: 'K', number }, make: 'Toyota', model });
/** A job for a car already in the base, at the counter: the driver typed or picked there. */
const visit = (vehicleId: string, driver?: { id?: string; name: string; phone: string }) =>
  checkIn({ vehicleId, plate: { emirate: 'DXB', code: '', number: '' }, make: '', model: '', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true, driver });

describe('drivers of company customers (v0.43)', () => {
  it('1 · a company job with a new driver: the job keeps him, the list has him once, the customer is still the company', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const o = await visit(hiace.id, { name: ' Muhammad ', phone: '050 111 2233' });
    const job = (await db.orders.get(o.id))!;
    expect(job.customerId).toBe(abc.id);
    expect(job.driver).toMatchObject({ name: 'Muhammad', phone: '+971501112233' });
    const list = await db.drivers.toArray();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: job.driver!.id, name: 'Muhammad', phone: '+971501112233' });
    // The company itself is as it was: the driver is not its contact, not a customer.
    expect(await db.customers.get(abc.id)).toMatchObject({ name: 'Rashid', phone: '+97143334455' });
    expect(await db.customers.count()).toBe(1);
  });

  it('2 · the saved driver offered as soon as the next job starts, by part of his name or number; picked or typed again — the same record', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const first = await visit(hiace.id, { name: 'Muhammad', phone: '050 111 2233' });
    const m = (await db.orders.get(first.id))!.driver!;
    // Nothing typed: the company's drivers (this car's first) — one tap.
    expect((await suggestDrivers({ name: '', phone: '' }, { customerId: abc.id, vehicleId: hiace.id })).map((h) => [h.driver.id, h.car])).toEqual([[m.id, true]]);
    for (const typed of [{ name: 'muh', phone: '' }, { name: '', phone: '111 22' }, { name: '', phone: '0501' }, { name: '', phone: '+971 50 111 2233' }])
      expect((await suggestDrivers(typed, { customerId: abc.id }))[0]?.driver.id).toBe(m.id);
    // Picked from the list, and typed again in another way: no second record.
    const second = await visit(hiace.id, { id: m.id, name: 'Muhammad', phone: '+971501112233' });
    const third = await visit(hiace.id, { name: 'MUHAMMAD', phone: '+971 50 111 2233' });
    expect((await db.orders.get(second.id))!.driver?.id).toBe(m.id);
    expect((await db.orders.get(third.id))!.driver?.id).toBe(m.id);
    expect(await db.drivers.count()).toBe(1);
  });

  it('3 · one car with different drivers — each job keeps its own', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const a = await visit(hiace.id, { name: 'Muhammad', phone: '050 111 2233' });
    const b = await visit(hiace.id, { name: 'Ahmed', phone: '055 222 3344' });
    const c = await visit(hiace.id);
    await setJobDriver(c.id, { id: (await db.orders.get(a.id))!.driver!.id, name: '', phone: '' });
    const jobs = await db.orders.where('vehicleId').equals(hiace.id).toArray();
    const by = new Map(jobs.map((o) => [o.id, o.driver?.name]));
    expect([by.get(a.id), by.get(b.id), by.get(c.id)]).toEqual(['Muhammad', 'Ahmed', 'Muhammad']);
    expect(await db.drivers.count()).toBe(2);
  });

  it('4 · one driver with different cars — one record, all his jobs and cars', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const urvan = await car(abc.id, '22222', 'Urvan');
    const a = await visit(hiace.id, { name: 'Muhammad', phone: '050 111 2233' });
    const id = (await db.orders.get(a.id))!.driver!.id;
    const b = await visit(urvan.id, { id, name: 'Muhammad', phone: '+971501112233' });
    expect(await db.drivers.count()).toBe(1);
    const jobs = await driverJobs(id);
    expect(jobs.map((j) => j.order.id).sort()).toEqual([a.id, b.id].sort());
    expect(new Set(jobs.map((j) => j.vehicle?.id))).toEqual(new Set([hiace.id, urvan.id]));
    expect(await companyDrivers(abc.id)).toMatchObject([{ driver: { id }, jobs: 2, cars: 2 }]);
  });

  it('5 · his phone changed: the list and the job it was changed on follow; the jobs before keep the phone they had', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const before = await visit(hiace.id, { name: 'Muhammad', phone: '050 111 2233' });
    const id = (await db.orders.get(before.id))!.driver!.id;
    const now = await visit(hiace.id, { id, name: 'Muhammad', phone: '+971501112233' });
    await setJobDriver(now.id, { id, name: 'Muhammad', phone: '052 999 8877' }, { edit: true });
    expect((await db.drivers.get(id))!.phone).toBe('+971529998877');
    expect((await db.orders.get(now.id))!.driver).toEqual({ id, name: 'Muhammad', phone: '+971529998877' });
    expect((await db.orders.get(before.id))!.driver).toEqual({ id, name: 'Muhammad', phone: '+971501112233' });
    // Changed in the list itself: the jobs keep theirs; taken off the list: the jobs keep him, he is not offered.
    await updateDriver(id, { name: 'Muhammad Ali', phone: '052 999 8877' });
    expect((await db.orders.get(now.id))!.driver?.name).toBe('Muhammad');
    await archiveDriver(id);
    expect((await db.orders.get(before.id))!.driver?.name).toBe('Muhammad');
    expect(await suggestDrivers({ name: 'muh', phone: '' }, { customerId: abc.id })).toEqual([]);
    expect(await companyDrivers(abc.id)).toEqual([]);
    // Typed again with his number: the same record, back on the list.
    const again = await visit(hiace.id, { name: 'Muhammad Ali', phone: '052 999 8877' });
    expect((await db.orders.get(again.id))!.driver?.id).toBe(id);
    expect((await db.drivers.get(id))!.archivedAt).toBeUndefined();
    // Off this job, and «Отменить».
    const had = await clearJobDriver(again.id);
    expect((await db.orders.get(again.id))!.driver).toBeUndefined();
    await restoreJobDriver(again.id, had!);
    expect((await db.orders.get(again.id))!.driver?.id).toBe(id);
  });

  it('6 · a job from before (no driver) opens as before; a private customer’s job needs none', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const old = await visit(hiace.id);
    const b = (await loadOrderBundle(old.id))!;
    expect(b.order.driver).toBeUndefined();
    expect(await companyDrivers(abc.id)).toEqual([]);
    const own = await checkIn({ plate: { emirate: 'DXB', code: 'A', number: '33333' }, make: 'Kia', model: 'Rio', name: 'Saeed', phone: '050 765 4321', docLanguage: 'en', complaint: '', arrivedNow: true });
    expect((await db.orders.get(own.id))!.driver).toBeUndefined();
    expect(await db.drivers.count()).toBe(0);
  });

  it('6 · a database from before v0.43 opens: its jobs stay, the list of drivers is there, empty', async () => {
    db.close();
    const old = `old-${uid()}`;
    // The database as v0.40–v0.42 left it (schema 7): a job, no table of drivers.
    const v7 = new Dexie(old);
    v7.version(7).stores({ customers: 'id, name, phone, createdAt, _t', vehicles: 'id, customerId, plateSearch, vin, _t', orders: 'id, number, customerId, vehicleId, stage, createdAt, _t' });
    await v7.table('customers').add({ id: 'c1', name: 'ABC', phone: '', type: 'company', createdAt: '2026-11-01T08:00:00.000Z' });
    await v7.table('orders').add({ id: 'o1', number: 120, customerId: 'c1', vehicleId: 'v1', stage: 'closed', createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z' });
    v7.close();
    setDb(new GarageDB(old));
    expect(await db.orders.get('o1')).toMatchObject({ number: 120, customerId: 'c1' });
    expect(await db.drivers.count()).toBe(0);
    expect(await db.orders.where('driver.id').equals('x').count()).toBe(0);
  });

  it('7 · the debt is the company’s, the same with a driver on the job', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const o = await visit(hiace.id, { name: 'Muhammad', phone: '050 111 2233' });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brakes', unitPriceFils: 50_000, vatRateBp: 500 });
    await approveAll(o.id);
    await quickInvoice(o.id);
    const owed = bundleAmountDue((await loadOrderBundle(o.id))!);
    expect(owed).toBe(52_500);
    await leaveOnDebt(o.id, { amountFils: owed, dueDate: '2026-12-01', signature: new Blob(['sig'], { type: 'image/png' }) });
    const cards = await loadDebtors();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ totalFils: 52_500 });
    expect(cards[0].customer.id).toBe(abc.id);
    const debt = (await db.debts.where('orderId').equals(o.id).first())!;
    expect(debt.customerId).toBe(abc.id);
    expect((await db.invoices.where('orderId').equals(o.id).first())!.buyer).not.toHaveProperty('driver');
    // A driver changed after the invoice: the money stays as it was.
    await setJobDriver(o.id, { name: 'Ahmed', phone: '055 222 3344' });
    expect(bundleAmountDue((await loadOrderBundle(o.id))!)).toBe(owed);
    expect((await loadDebtors())[0]).toMatchObject({ totalFils: 52_500 });
  });

  it('8 · after the app is opened again: the list and each job’s driver are there', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const o = await visit(hiace.id, { name: 'Muhammad', phone: '050 111 2233' });
    db.close();
    setDb(new GarageDB(name));
    expect((await db.orders.get(o.id))!.driver).toMatchObject({ name: 'Muhammad', phone: '+971501112233' });
    expect(await db.drivers.count()).toBe(1);
    expect((await suggestDrivers({ name: '', phone: '' }, { customerId: abc.id }))[0]?.driver.name).toBe('Muhammad');
  });

  it('a number typed into the name field (the phone field empty) is his phone — and the same driver when typed so again', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const o = await visit(hiace.id, { name: '050 111 2233', phone: '' });
    const first = (await db.orders.get(o.id))!.driver!;
    expect(first).toMatchObject({ name: '', phone: '+971501112233' });
    const again = await visit(hiace.id, { name: '+971 50 111 2233', phone: '' });
    expect((await db.orders.get(again.id))!.driver?.id).toBe(first.id);
    expect(await db.drivers.count()).toBe(1);
    // A name with digits in it stays a name.
    const named = await visit(hiace.id, { name: 'Ali 2', phone: '' });
    expect((await db.orders.get(named.id))!.driver).toMatchObject({ name: 'Ali 2', phone: '' });
  });

  it('a phone that is not a phone, or nothing at all, is not saved', async () => {
    const abc = await company();
    const hiace = await car(abc.id, '11111');
    const o = await visit(hiace.id);
    await expect(setJobDriver(o.id, { name: 'Muhammad', phone: '12' })).rejects.toThrow();
    await expect(setJobDriver(o.id, { name: '  ', phone: '' })).rejects.toThrow();
    expect(await db.drivers.count()).toBe(0);
    // Another driver's number cannot be given to this one in the list.
    const a = await setJobDriver(o.id, { name: 'Muhammad', phone: '050 111 2233' });
    const b = await setJobDriver(o.id, { name: 'Ahmed', phone: '055 222 3344' });
    await expect(updateDriver(b.id, { name: 'Ahmed', phone: '050 111 2233' })).rejects.toThrow();
    expect((await db.drivers.get(a.id))!.phone).toBe('+971501112233');
  });
});
