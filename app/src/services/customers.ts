import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { normalizePhone } from '../domain/phone';
import { normalizePlate, plateMatches, plateSearchKey } from '../domain/plates';
import type { Customer, Vehicle } from '../domain/types';
import { AppError } from './errors';

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'archivedAt'>;
export type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'archivedAt' | 'plateSearch' | 'customerId'>;

function cleanCustomer(input: Partial<CustomerInput>): Partial<CustomerInput> {
  const out: Partial<CustomerInput> = { ...input };
  if (input.phone !== undefined) {
    const p = normalizePhone(input.phone);
    if (!p) throw new AppError('err.phoneInvalid');
    out.phone = p;
  }
  if (input.whatsapp) out.whatsapp = normalizePhone(input.whatsapp) ?? undefined;
  if (input.name !== undefined) {
    out.name = input.name.trim();
    if (!out.name) throw new AppError('err.nameRequired');
  }
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
