import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { normalizePhone } from '../domain/phone';
import { canonicalMake, canonicalModel } from '../domain/carCatalog';
import { normalizePlate, plateMatches, plateSearchKey } from '../domain/plates';
import type { Customer, Order, Vehicle } from '../domain/types';
import { AppError } from './errors';

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'archivedAt'>;
export type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'archivedAt' | 'plateSearch' | 'customerId'>;

/**
 * Name and phone may stay empty: the car is what gets checked in, the customer can be completed later.
 * A phone that is typed must be a valid one.
 */
function cleanCustomer(input: Partial<CustomerInput>): Partial<CustomerInput> {
  const out: Partial<CustomerInput> = { ...input };
  if (input.phone !== undefined) {
    if (!input.phone.trim()) out.phone = '';
    else {
      const p = normalizePhone(input.phone);
      if (!p) throw new AppError('err.phoneInvalid');
      out.phone = p;
    }
  }
  if (input.whatsapp) out.whatsapp = normalizePhone(input.whatsapp) ?? undefined;
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.trn !== undefined) out.trn = input.trn.replace(/\s/g, '') || undefined;
  return out;
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const c: Customer = { ...(cleanCustomer(input) as CustomerInput), id: uid(), createdAt: nowIso() };
  await db.customers.add(c);
  return c;
}

export async function updateCustomer(id: string, patch: Partial<CustomerInput>): Promise<void> {
  await db.customers.update(id, cleanCustomer(patch));
}

async function assertPlateFree(v: Pick<Vehicle, 'plate'>, exceptId?: string) {
  const key = plateSearchKey(v.plate);
  const same = await db.vehicles.where('plateSearch').equals(key).toArray();
  if (same.some((x) => x.id !== exceptId && !x.archivedAt && x.plate.emirate === v.plate.emirate)) {
    throw new AppError('err.plateExists');
  }
}

export async function createVehicle(customerId: string, input: VehicleInput): Promise<Vehicle> {
  const plate = normalizePlate(input.plate);
  if (!plate.number) throw new AppError('err.plateRequired');
  await assertPlateFree({ plate });
  const v: Vehicle = {
    ...input,
    plate,
    vin: input.vin?.toUpperCase().replace(/\s/g, '') || undefined,
    plateSearch: plateSearchKey(plate),
    customerId,
    id: uid(),
    createdAt: nowIso(),
  };
  await db.transaction('rw', db.vehicles, db.ownerships, async () => {
    await db.vehicles.add(v);
    await db.ownerships.add({ id: uid(), vehicleId: v.id, customerId, from: v.createdAt });
  });
  return v;
}

export async function updateVehicle(id: string, patch: Partial<VehicleInput>): Promise<void> {
  const out: Partial<Vehicle> = { ...patch };
  if (patch.plate) {
    out.plate = normalizePlate(patch.plate);
    await assertPlateFree({ plate: out.plate }, id);
    out.plateSearch = plateSearchKey(out.plate);
  }
  if (patch.vin !== undefined) out.vin = patch.vin.toUpperCase().replace(/\s/g, '') || undefined;
  await db.vehicles.update(id, out);
}

export async function changeVehicleOwner(vehicleId: string, customerId: string): Promise<void> {
  await db.transaction('rw', db.vehicles, db.ownerships, async () => {
    const now = nowIso();
    const open = await db.ownerships.where('vehicleId').equals(vehicleId).filter((o) => !o.to).toArray();
    for (const o of open) await db.ownerships.update(o.id, { to: now });
    await db.ownerships.add({ id: uid(), vehicleId, customerId, from: now });
    await db.vehicles.update(vehicleId, { customerId });
  });
}

/** An existing customer with this phone (to avoid creating the same person twice). */
export async function findCustomerByPhone(phone: string): Promise<Customer | undefined> {
  const p = normalizePhone(phone);
  if (!p) return undefined;
  return (await db.customers.where('phone').equals(p).toArray()).find((c) => !c.archivedAt);
}

/** An existing car with this plate in the same emirate, with its owner. */
export async function findVehicleByPlate(plate: Vehicle['plate']): Promise<{ vehicle: Vehicle; owner?: Customer } | undefined> {
  const n = normalizePlate(plate);
  if (!n.number) return undefined;
  const vehicle = (await db.vehicles.where('plateSearch').equals(plateSearchKey(n)).toArray()).find((v) => !v.archivedAt && v.plate.emirate === n.emirate);
  if (!vehicle) return undefined;
  return { vehicle, owner: await db.customers.get(vehicle.customerId) };
}

/** The car with this plate, its owner and the job it is in right now (if any) — for check-in. */
export async function findVehicleForCheckIn(plate: Vehicle['plate']): Promise<{ vehicle: Vehicle; owner?: Customer; activeOrder?: Order } | undefined> {
  const found = await findVehicleByPlate(plate);
  if (!found) return undefined;
  const orders = await db.orders.where('vehicleId').equals(found.vehicle.id).toArray();
  const activeOrder = orders.find((o) => !['delivered', 'closed', 'cancelled'].includes(o.stage));
  return { ...found, activeOrder };
}

export interface CheckInCar {
  vehicle: Vehicle;
  owner?: Customer;
  activeOrder?: Order;
}

/**
 * Cars with this plate number when the plate as typed is not in the base — the code left out (or typed
 * where the car has none), another emirate picked: the same number and a code that fits (the same, or one
 * of the two empty); this emirate first, then the car seen last. The number alone finds the car and its
 * owner at check-in — offered, not taken: the same number with another code is another car.
 */
export async function findVehiclesByNumber(plate: Vehicle['plate'], limit = 4): Promise<CheckInCar[]> {
  const n = normalizePlate(plate);
  if (!n.number) return [];
  const cars = (await db.vehicles.toArray()).filter((v) => {
    if (v.archivedAt) return false;
    const p = normalizePlate(v.plate);
    if (p.number !== n.number) return false;
    if (p.code === n.code && p.emirate === n.emirate) return false; // that one is the exact match
    return !n.code || !p.code || p.code === n.code;
  });
  if (!cars.length) return [];
  const orders = await db.orders.where('vehicleId').anyOf(cars.map((v) => v.id)).toArray();
  const last = (id: string) => orders.filter((o) => o.vehicleId === id).reduce((a, o) => (o.createdAt > a ? o.createdAt : a), '');
  const found = await Promise.all(
    cars.map(async (vehicle) => ({
      vehicle,
      owner: await db.customers.get(vehicle.customerId),
      activeOrder: orders.find((o) => o.vehicleId === vehicle.id && !['delivered', 'closed', 'cancelled'].includes(o.stage)),
    })),
  );
  return found
    .sort((a, b) => Number(b.vehicle.plate.emirate === n.emirate) - Number(a.vehicle.plate.emirate === n.emirate) || last(b.vehicle.id).localeCompare(last(a.vehicle.id)))
    .slice(0, limit);
}

/**
 * Existing customers matching what is being typed (3+ phone digits or 2+ letters of the name or the
 * company), but `except` (the customer being edited). Names starting with what is typed come first.
 */
export async function suggestCustomers(phone: string, name: string, limit = 3, except?: string): Promise<Customer[]> {
  const digits = phone.replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '');
  const n = name.trim().toLowerCase();
  if (digits.length < 3 && n.length < 2) return [];
  const all = await db.customers.toArray();
  const named = (c: Customer) => [c.name, c.companyName ?? ''].map((x) => x.toLowerCase());
  const byName = (c: Customer) => n.length >= 2 && named(c).some((x) => x.includes(n));
  const byPhone = (c: Customer) => digits.length >= 3 && !!c.phone && c.phone.replace(/\D/g, '').includes(digits);
  const starts = (c: Customer) => (n && named(c).some((x) => x.startsWith(n)) ? 0 : 1);
  return all
    .filter((c) => c.id !== except && !c.archivedAt && (byPhone(c) || byName(c)))
    .sort((a, b) => starts(a) - starts(b))
    .slice(0, limit);
}

/**
 * Names as one chip each, however they were typed ("HiAce", "HIACE", "Hiace" are one model): counted under
 * the catalogue's spelling (or the first typed one), the most frequent first, then the list's own order.
 */
function chipNames(seen: string[], spell: (s: string) => string, rest: string[], limit: number): string[] {
  const key = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, '');
  const counts = new Map<string, { name: string; n: number }>();
  for (const s of seen) {
    const name = spell(s.trim());
    if (!name) continue;
    const k = key(name);
    const had = counts.get(k);
    if (had) had.n++;
    else counts.set(k, { name, n: 1 });
  }
  const out = [...counts.values()].sort((a, b) => b.n - a.n).map((x) => x.name);
  for (const r of rest) if (!out.some((o) => key(o) === key(r))) out.push(r);
  return out.slice(0, limit);
}

/** Makes this garage sees most often first, then the usual UAE list (one-tap chips at check-in). */
export async function popularMakes(defaults: string[], limit = 12): Promise<string[]> {
  return chipNames((await db.vehicles.toArray()).map((v) => v.make), canonicalMake, defaults, limit);
}

/** Models of this make seen in the garage first, then the catalogue order — one chip per model. */
export async function popularModels(make: string, catalogue: string[], limit = 10): Promise<string[]> {
  const mk = canonicalMake(make);
  if (!mk) return [];
  const own = (await db.vehicles.toArray()).filter((v) => canonicalMake(v.make) === mk && v.model).map((v) => v.model);
  return chipNames(own, (s) => canonicalModel(mk, s), catalogue, limit);
}

export interface SearchHit {
  customer: Customer;
  vehicle?: Vehicle;
}

/** Search by plate, phone, name or VIN. The garage has a few thousand records at most, so we filter in memory. */
export async function search(query: string, limit = 30): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const [customers, vehicles] = await Promise.all([db.customers.toArray(), db.vehicles.toArray()]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  // Local formats: "050 123..." and "00971..." should match "+97150123...".
  const digits = q.replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '');
  const hits: SearchHit[] = [];
  const seenCustomers = new Set<string>();
  for (const v of vehicles) {
    if (v.archivedAt) continue;
    const c = byId.get(v.customerId);
    if (!c) continue;
    const match =
      plateMatches(v.plateSearch, q) ||
      (v.vin && v.vin.toLowerCase().includes(q)) ||
      `${v.make} ${v.model}`.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits));
    if (match) {
      hits.push({ customer: c, vehicle: v });
      seenCustomers.add(c.id);
    }
  }
  for (const c of customers) {
    if (seenCustomers.has(c.id) || c.archivedAt) continue;
    if (c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))) {
      hits.push({ customer: c });
    }
  }
  return hits.slice(0, limit);
}
