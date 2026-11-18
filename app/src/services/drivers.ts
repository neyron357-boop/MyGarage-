import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { driverUse, rankDrivers, sameDriver, type DriverTyped, type DriverUse } from '../domain/drivers';
import { normalizePhone } from '../domain/phone';
import type { Driver, JobDriver, Order, Vehicle } from '../domain/types';
import { AppError } from './errors';

/*
 * The customers' drivers (v0.43): who brought the car on each job — a company's driver mostly. The job keeps him as
 * he was then (`order.driver`: his record's id, name and phone); the list of drivers (`drivers`) is what is offered
 * next time. A driver is never the customer: invoices, payments and debts stay the company's — nothing here touches
 * them.
 */

/** What is typed or picked for a job's driver: `id` — one picked from the list. */
export interface DriverDraft {
  id?: string;
  name: string;
  phone: string;
}

/** How the company's drivers were used — read from its own jobs only. */
async function usage(customerId?: string, vehicleId?: string): Promise<Map<string, DriverUse>> {
  if (!customerId) return new Map();
  return driverUse(await db.orders.where('customerId').equals(customerId).toArray(), customerId, vehicleId);
}

/** A driver offered, and whether he brought this very car before. */
export interface DriverHit {
  driver: Driver;
  car: boolean;
}

/** Drivers offered while a driver's name or phone is typed — nothing typed: the company's own, this car's first. */
export async function suggestDrivers(typed: DriverTyped, ctx: { customerId?: string; vehicleId?: string; except?: string } = {}, limit = 5): Promise<DriverHit[]> {
  const [drivers, use] = await Promise.all([db.drivers.toArray(), usage(ctx.customerId, ctx.vehicleId)]);
  return rankDrivers(
    drivers.filter((d) => d.id !== ctx.except),
    use,
    typed,
    limit,
  ).map((driver) => ({ driver, car: !!use.get(driver.id)?.car }));
}

/** The name and phone as kept: the name without extra spaces, the phone in E.164 ('' — none); one of them at least. */
function clean(input: { name: string; phone: string }): { name: string; phone: string } {
  let name = input.name.replace(/\s+/g, ' ').trim();
  let phone = '';
  // A number typed into the name field, the phone field left empty: it is his phone (no name).
  const asPhone = !input.phone.trim() && /^[\d\s+()-]+$/.test(name) ? normalizePhone(name) : null;
  if (asPhone) {
    phone = asPhone;
    name = '';
  } else if (input.phone.trim()) {
    const p = normalizePhone(input.phone);
    if (!p) throw new AppError('err.phoneInvalid');
    phone = p;
  }
  if (!name && !phone) throw new AppError('err.driverEmpty');
  return { name, phone };
}

/** A driver taken off the list comes back to it (picked or typed again). */
async function back(d: Driver): Promise<Driver> {
  if (!d.archivedAt) return d;
  await db.drivers.update(d.id, { archivedAt: undefined });
  return { ...d, archivedAt: undefined };
}

/**
 * The driver for what was picked or typed — never the same man twice. Picked from the list: him (`edit`: with his
 * name and phone as typed now — the list follows, the jobs before keep theirs; a phone that is another driver's is
 * that driver). Typed: the one with this phone (without a phone, this name among the company's drivers), else a new
 * one.
 */
async function resolve(draft: DriverDraft, customerId: string, edit: boolean): Promise<Driver> {
  const all = await db.drivers.toArray();
  const picked = draft.id ? all.find((d) => d.id === draft.id) : undefined;
  if (picked && !edit) return back(picked);
  const { name, phone } = clean(draft);
  const now = nowIso();
  if (picked) {
    const taken = phone ? all.find((d) => d.id !== picked.id && d.phone === phone) : undefined;
    if (taken) return back(taken);
    const patch = { name, phone, updatedAt: now, archivedAt: undefined };
    await db.drivers.update(picked.id, patch);
    return { ...picked, ...patch };
  }
  const same = sameDriver(all, await usage(customerId), { name, phone });
  if (same) return back(same);
  const d: Driver = { id: uid(), name, phone, createdAt: now };
  await db.drivers.add(d);
  return d;
}

const noted = (orderId: string) => db.events.add({ id: uid(), orderId, at: nowIso(), type: 'updated', payload: { fields: ['driver'] } });

/**
 * Who brought the car on this job — picked or typed (`edit`: the picked driver's contact changed). The job keeps him
 * as he is now; other jobs keep theirs.
 */
export async function setJobDriver(orderId: string, draft: DriverDraft, opts: { edit?: boolean } = {}): Promise<Driver> {
  return db.transaction('rw', [db.orders, db.drivers, db.events], async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new AppError('err.notFound');
    const d = await resolve(draft, order.customerId, !!opts.edit);
    const driver: JobDriver = { id: d.id, name: d.name, phone: d.phone };
    const had = order.driver;
    if (!had || had.id !== driver.id || had.name !== driver.name || had.phone !== driver.phone) {
      await db.orders.update(orderId, { driver, updatedAt: nowIso() });
      await noted(orderId);
    }
    return d;
  });
}

/** No driver on the job any more (the list keeps him). Returns the one it had — for «Отменить». */
export async function clearJobDriver(orderId: string): Promise<JobDriver | undefined> {
  return db.transaction('rw', [db.orders, db.events], async () => {
    const order = await db.orders.get(orderId);
    if (!order?.driver) return undefined;
    await db.orders.update(orderId, { driver: undefined, updatedAt: nowIso() });
    await noted(orderId);
    return order.driver;
  });
}

/** The driver the job had back on it, as it had him («Отменить» after «Убрать»). */
export async function restoreJobDriver(orderId: string, driver: JobDriver): Promise<void> {
  await db.transaction('rw', [db.orders, db.events], async () => {
    if (!(await db.orders.get(orderId))) return;
    await db.orders.update(orderId, { driver, updatedAt: nowIso() });
    await noted(orderId);
  });
}

/** A driver's name or phone changed in the list: offered so from now on; the jobs he brought keep theirs. */
export async function updateDriver(id: string, input: { name: string; phone: string }): Promise<void> {
  await db.transaction('rw', db.drivers, async () => {
    const d = await db.drivers.get(id);
    if (!d) throw new AppError('err.notFound');
    const { name, phone } = clean(input);
    if (phone && (await db.drivers.where('phone').equals(phone).toArray()).some((x) => x.id !== id && !x.archivedAt)) throw new AppError('err.driverTaken');
    await db.drivers.update(id, { name, phone, updatedAt: nowIso() });
  });
}

/** Off the list of drivers — not offered any more; the jobs he brought keep him. */
export async function archiveDriver(id: string): Promise<void> {
  await db.drivers.update(id, { archivedAt: nowIso() });
}

/** Back on the list («Отменить»). */
export async function restoreDriver(id: string): Promise<void> {
  await db.drivers.update(id, { archivedAt: undefined });
}

export interface DriverJob {
  order: Order;
  vehicle?: Vehicle;
}

/** The jobs a driver brought, the latest first, with their cars (whichever company's). */
export async function driverJobs(driverId: string): Promise<DriverJob[]> {
  const orders = await db.orders.where('driver.id').equals(driverId).toArray();
  const vehicles = await db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId))]);
  const byId = new Map(vehicles.filter((v): v is Vehicle => !!v).map((v) => [v.id, v]));
  return orders
    .map((order) => ({ order, vehicle: byId.get(order.vehicleId) }))
    .sort((a, b) => (b.order.arrivedAt || b.order.createdAt).localeCompare(a.order.arrivedAt || a.order.createdAt));
}

export interface CompanyDriver {
  driver: Driver;
  /** The company's jobs he brought. */
  jobs: number;
  /** Its cars he brought. */
  cars: number;
  last: string;
}

/** The drivers who brought this customer's cars, the latest first (the ones taken off the list are not among them). */
export async function companyDrivers(customerId: string): Promise<CompanyDriver[]> {
  const jobs = (await db.orders.where('customerId').equals(customerId).toArray()).filter((o) => o.driver?.id);
  const by = new Map<string, { jobs: number; cars: Set<string>; last: string }>();
  for (const o of jobs) {
    const id = o.driver!.id;
    const at = o.arrivedAt || o.createdAt;
    const x = by.get(id) ?? { jobs: 0, cars: new Set<string>(), last: '' };
    x.jobs++;
    x.cars.add(o.vehicleId);
    if (at > x.last) x.last = at;
    by.set(id, x);
  }
  const records = await db.drivers.bulkGet([...by.keys()]);
  return records
    .filter((d): d is Driver => !!d && !d.archivedAt)
    .map((driver) => {
      const x = by.get(driver.id)!;
      return { driver, jobs: x.jobs, cars: x.cars.size, last: x.last };
    })
    .sort((a, b) => b.last.localeCompare(a.last));
}
