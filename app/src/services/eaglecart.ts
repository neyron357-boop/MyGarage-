import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { normalizePhone } from '../domain/phone';
import { normalizePlate, plateSearchKey } from '../domain/plates';
import type { Customer, Emirate, ImportedFrom, Order, OrderItem, Ownership, Plate, Vehicle } from '../domain/types';
import { netFromGross } from '../domain/vat';
import { AppError } from './errors';

/*
 * Carrying the history over from Eaglecart (the garage's previous system).
 *
 * The export file is made once from the Eaglecart admin (workshop jobs with their lines, the cars and
 * the customers) and imported here: customers, cars and jobs. Only what MyGarage uses is kept — no
 * store, marketing or inventory data. Money: Eaglecart was not used consistently for payments
 * (most jobs were never closed there), so history jobs get no invoices or payments here and never
 * show as owed; what Eaglecart knew (its order number, the payment there) stays on the job.
 *
 * Importing twice is safe: every record has a fixed id derived from its Eaglecart id ("ec-…"),
 * customers already in MyGarage are matched by phone and cars by plate.
 */

export interface EcCustomer {
  id: string;
  type?: string;
  group?: string;
  name: string;
  phone?: string;
  email?: string;
  trn?: string;
  note?: string;
}
export interface EcVehicle {
  id: string;
  customerId: string;
  make?: string;
  model?: string;
  body?: string;
  color?: string;
  year?: string;
  vin?: string;
  plate?: string;
  zone?: string;
  engine?: string;
  fuel?: string;
}
/** [name, qty, unit price incl. VAT, unit price excl. VAT, taxed 0/1, cost] */
export type EcItem = [string, number, number, number, number, number];
export interface EcJob {
  id: string;
  no: string;
  status: string;
  at: string | null;
  customerId: string;
  vehicleId: string;
  km?: number;
  kmUnit?: string;
  discount?: number;
  pay?: string;
  items: EcItem[];
  order?: { no: string; pay: string; method: string; at: string | null; total: number };
}
export interface EaglecartExport {
  format: 'eaglecart-export';
  v: 1;
  exportedAt: string;
  store?: string;
  customers: EcCustomer[];
  vehicles: EcVehicle[];
  jobs: EcJob[];
}

export function parseEaglecartFile(text: string): EaglecartExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError('ec.badFile');
  }
  const d = data as Partial<EaglecartExport>;
  if (d?.format !== 'eaglecart-export' || !Array.isArray(d.customers) || !Array.isArray(d.vehicles) || !Array.isArray(d.jobs)) throw new AppError('ec.badFile');
  return d as EaglecartExport;
}

/* ---------------- Field conversions ---------------- */

const ZONE: Record<string, Emirate> = {
  'abu dhabi': 'AUH',
  dubai: 'DXB',
  sharjah: 'SHJ',
  ajman: 'AJM',
  'ras al khaimah': 'RAK',
  'umm al quwain': 'UAQ',
  fujairah: 'FUJ',
};

/**
 * "A-12345", "AA 12345", "5 / 87920", "12345 O", "12345" → code + number. The emirate comes from the
 * Eaglecart zone, except that a letter code is never Abu Dhabi (its codes are numbers): there the zone
 * was left at the form's default, and the garage's cars with letter codes are Dubai cars.
 */
export function parseEcPlate(raw: string | undefined, zone: string | undefined): Plate {
  const s = (raw ?? '').toUpperCase().trim();
  let code = '';
  let number = '';
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^([A-Z]{1,3}|\d{1,2})\s*[-–/\s]+\s*(\d{1,6})$/))) [code, number] = [m[1], m[2]];
  else if ((m = s.match(/^(\d{1,6})\s*[-–/\s]+\s*([A-Z]{1,3})$/))) [number, code] = [m[1], m[2]];
  else if ((m = s.match(/^([A-Z]{1,3})(\d{1,6})$/))) [code, number] = [m[1], m[2]];
  else number = s.replace(/[^A-Z0-9]/g, '');
  if (/^0+$/.test(number)) number = ''; // "00000": no plate was entered
  let emirate: Emirate = ZONE[(zone ?? '').trim().toLowerCase()] ?? 'DXB';
  if (emirate === 'AUH' && /^[A-Z]+$/.test(code)) emirate = 'DXB';
  return normalizePlate({ emirate, code, number });
}

/** "+971 971 50…" (country code typed twice) and other slips → E.164, or '' if it is not a phone. */
export function parseEcPhone(raw: string | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const fixed = digits.replace(/^(?:00)?971(?:971)?0?/, '971');
  return normalizePhone('+' + fixed) ?? '';
}

const LABOR = /\b(LABOU?RS?|CHARGES?|SERVICE|SERVICING|WASH|SKIMMING|ALIGNMENT|BALANCING|RECOVERY|TOWING|MACHINE SHOP|REPAIR(ED|ING)?|FLUSH(ING)?|SCANN?ING|CLEANING|CHECK(ING|UP)?|DIAGNOS\w*|CHANGE OIL|OIL CHANGE|FITTING|INSTALL\w*|PAINT\w*|DENT\w*|POLISH\w*|WELDING|RECHARG\w*|OVERHAUL\w*|INSPECTION|PUNCTURE|TINTING|COATING)\b/i;

/** Eaglecart does not separate labour from parts: "LABOUR CHARGES", "CAR WASH", "AC SERVICE…" are work. */
export function classifyEcItem(name: string): 'labor' | 'part' {
  return LABOR.test(name) ? 'labor' : 'part';
}

const COMPANY = /\b(L\.?L\.?C\.?|FZE|FZCO|FZ-LLC|TRADING|GROUP|COMPANY|CO\.|EST\.?|ESTABLISHMENT|CONTRACTING|FACTORY|TRANSPORT\w*|RESTAURANT|CAFE|INTERNATIONAL|INDUSTR\w*|ENTERPRISES?|LTD|GULF|SERVICES)\b/i;

const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString() : undefined);
const fils = (aed: number) => Math.round(aed * 100);

/* ---------------- Plan ---------------- */

export interface ImportOptions {
  /** Not-delivered jobs from this moment on are continued as open jobs instead of history. */
  activeSince?: string;
  now?: string;
}

export interface ImportPlan {
  customers: Customer[];
  vehicles: Vehicle[];
  ownerships: Ownership[];
  orders: Order[];
  items: OrderItem[];
  stats: {
    customers: number;
    customersMatched: number;
    vehicles: number;
    vehiclesMatched: number;
    jobs: number;
    history: number;
    quotations: number;
    active: number;
    skippedEmpty: number;
    alreadyImported: number;
    totalFils: number;
    from?: string;
    to?: string;
  };
}

/** Existing MyGarage records the import connects to instead of duplicating. */
export interface Existing {
  ids: Set<string>;
  customerByPhone: Map<string, string>;
  vehicleByPlate: Map<string, string>;
}

const plateKey = (p: Plate) => `${p.emirate}:${plateSearchKey(p)}`;

/** Jobs the garage may still be working on: not delivered, not just a quotation, recent. */
function isActive(j: EcJob, opts: ImportOptions) {
  return !!opts.activeSince && j.status !== 'Delivered' && j.status !== 'Quotation' && !!j.at && iso(j.at)! >= opts.activeSince;
}

export function planEaglecartImport(data: EaglecartExport, existing: Existing, opts: ImportOptions = {}): ImportPlan {
  const now = opts.now ?? nowIso();
  const stats: ImportPlan['stats'] = { customers: 0, customersMatched: 0, vehicles: 0, vehiclesMatched: 0, jobs: 0, history: 0, quotations: 0, active: 0, skippedEmpty: 0, alreadyImported: 0, totalFils: 0 };

  // Jobs oldest first; a job without a date takes the date of the job before it.
  const jobs = [...data.jobs].sort((a, b) => Number(a.no) - Number(b.no));
  let lastAt: string | undefined;
  const jobAt = new Map<string, string>();
  for (const j of jobs) {
    const at = iso(j.at) ?? lastAt ?? now;
    jobAt.set(j.id, at);
    lastAt = at;
  }
  const used = jobs.filter((j) => {
    if (j.items.length) return true;
    stats.skippedEmpty++;
    return false;
  });

  // Customers: one per Eaglecart customer; an existing MyGarage customer with the same phone is reused.
  const ecCustomers = new Map(data.customers.map((c) => [c.id, c]));
  const customerId = new Map<string, string>();
  const customers: Customer[] = [];
  const firstSeen = new Map<string, string>();
  for (const j of used) if (!firstSeen.has(j.customerId)) firstSeen.set(j.customerId, jobAt.get(j.id)!);
  for (const [ecId, at] of firstSeen) {
    const c = ecCustomers.get(ecId) ?? { id: ecId, name: '' };
    const id = `ec-c-${ecId}`;
    const phone = parseEcPhone(c.phone);
    const match = phone ? existing.customerByPhone.get(phone) : undefined;
    if (existing.ids.has(id)) {
      customerId.set(ecId, id);
      continue;
    }
    if (match) {
      customerId.set(ecId, match);
      stats.customersMatched++;
      continue;
    }
    const name = c.name.replace(/\s+/g, ' ').trim();
    const company = c.type === 'Business' || c.group === 'Corporate' || COMPANY.test(name);
    customers.push({
      id,
      name,
      phone,
      preferredChannel: /^\+9715/.test(phone) ? 'whatsapp' : 'call',
      docLanguage: 'en',
      type: company ? 'company' : 'individual',
      companyName: company ? name : undefined,
      trn: c.trn?.replace(/\s/g, '') || undefined,
      email: c.email || undefined,
      notes: c.note || undefined,
      createdAt: at,
    });
    if (phone) existing.customerByPhone.set(phone, id);
    customerId.set(ecId, id);
  }
  stats.customers = customers.length;

  // Cars: Eaglecart has some cars twice; one car per plate (and emirate), the details merged.
  const ecVehicles = new Map(data.vehicles.map((v) => [v.id, v]));
  const vehicleId = new Map<string, string>();
  const vehicles = new Map<string, Vehicle>();
  const matchedVehicles = new Set<string>();
  const owners = new Map<string, { customerId: string; from: string }[]>();
  for (const j of used) {
    const at = jobAt.get(j.id)!;
    const cust = customerId.get(j.customerId)!;
    let vid = vehicleId.get(j.vehicleId);
    if (!vid) {
      const ev = ecVehicles.get(j.vehicleId) ?? { id: j.vehicleId, customerId: j.customerId };
      const plate = parseEcPlate(ev.plate, ev.zone);
      const key = plate.number ? plateKey(plate) : `ec:${ev.id}`;
      const own = `ec-v-${ev.id}`;
      vid = existing.vehicleByPlate.get(key) ?? (existing.ids.has(own) ? own : undefined);
      if (vid) {
        // A car the garage already has in MyGarage (not one from an earlier import of this file).
        if (!vehicles.has(vid) && !vid.startsWith('ec-v-') && !matchedVehicles.has(vid)) {
          matchedVehicles.add(vid);
          stats.vehiclesMatched++;
        }
      } else {
        vid = own;
        vehicles.set(vid, {
          id: vid,
          plate,
          plateSearch: plateSearchKey(plate),
          vin: ev.vin?.toUpperCase().replace(/\s/g, '') || undefined,
          make: (ev.make ?? '').trim(),
          model: (ev.model ?? '').trim(),
          year: Number(ev.year) > 1900 ? Number(ev.year) : undefined,
          color: ev.color?.trim() || undefined,
          customerId: cust,
          createdAt: at,
        });
        existing.vehicleByPlate.set(key, vid);
      }
      vehicleId.set(j.vehicleId, vid);
    }
    // Fill details another Eaglecart record of the same car had (VIN, colour, year).
    const v = vehicles.get(vid);
    const ev = ecVehicles.get(j.vehicleId);
    if (v && ev) {
      v.vin ??= ev.vin?.toUpperCase().replace(/\s/g, '') || undefined;
      v.color ??= ev.color?.trim() || undefined;
      v.year ??= Number(ev.year) > 1900 ? Number(ev.year) : undefined;
      v.customerId = cust; // the latest job's customer owns the car now
    }
    const list = owners.get(vid) ?? [];
    if (list[list.length - 1]?.customerId !== cust) list.push({ customerId: cust, from: at });
    owners.set(vid, list);
  }
  stats.vehicles = vehicles.size;
  const ownerships: Ownership[] = [];
  for (const [vid, list] of owners) {
    if (!vehicles.has(vid)) continue;
    list.forEach((o, i) => ownerships.push({ id: `ec-own-${vid}-${i}`, vehicleId: vid, customerId: o.customerId, from: o.from, to: list[i + 1]?.from }));
  }

  // Jobs.
  const orders: Order[] = [];
  const items: OrderItem[] = [];
  for (const j of used) {
    const id = `ec-o-${j.id}`;
    if (existing.ids.has(id)) {
      stats.alreadyImported++;
      continue;
    }
    const at = jobAt.get(j.id)!;
    const active = isActive(j, opts);
    const quote = j.status === 'Quotation';
    const closedAt = iso(j.order?.at) ?? at;
    const gross = j.items.reduce((s, i) => s + fils(i[2] * i[1]), 0) - fils(j.discount ?? 0);
    const imported: ImportedFrom = {
      system: 'eaglecart',
      jobId: j.id,
      jobNo: j.no,
      status: j.status,
      orderNo: j.order?.no,
      paidFils: j.order && /paid/i.test(j.order.pay) && !/partial|unpaid/i.test(j.order.pay) ? fils(j.order.total) : undefined,
      payMethod: j.order?.method || undefined,
      totalFils: gross,
      history: !active,
      importedAt: now,
    };
    orders.push({
      id,
      number: Number(j.no) || 0,
      customerId: customerId.get(j.customerId)!,
      vehicleId: vehicleId.get(j.vehicleId)!,
      stage: active ? 'diagnostics' : quote ? 'cancelled' : 'closed',
      outcome: active ? 'in_progress' : quote ? 'repair_declined' : 'completed',
      complaint: '',
      docLanguage: 'en',
      arrivedAt: at,
      deliveredAt: active || quote ? undefined : closedAt,
      closedAt: active || quote ? undefined : closedAt,
      imported,
      stageChangedAt: active ? at : quote ? at : closedAt,
      createdAt: at,
      updatedAt: now,
    });
    j.items.forEach(([name, qty, price, priceNet, taxed], n) => {
      const rate = taxed ? 500 : 0;
      const unitNet = taxed ? (priceNet ? fils(priceNet) : netFromGross(fils(price), rate)) : fils(price);
      items.push({
        id: `ec-i-${j.id}-${n}`,
        orderId: id,
        kind: classifyEcItem(name),
        block: 'A',
        titleEn: name.replace(/\s+/g, ' ').trim(),
        qty: qty || 1,
        unit: 'pcs',
        unitPriceFils: unitNet,
        vatRateBp: rate,
        approvalState: active ? 'draft' : quote ? 'declined' : 'approved',
        done: !active && !quote,
        doneAt: !active && !quote ? closedAt : undefined,
        createdAt: at,
      });
    });
    if (j.discount) {
      items.push({
        id: `ec-i-${j.id}-discount`,
        orderId: id,
        kind: 'discount',
        block: 'A',
        titleEn: 'Discount',
        qty: 1,
        unit: 'pcs',
        unitPriceFils: netFromGross(fils(j.discount), 500),
        vatRateBp: 500,
        approvalState: active ? 'draft' : quote ? 'declined' : 'approved',
        done: !active && !quote,
        createdAt: at,
      });
    }
    stats.jobs++;
    if (active) stats.active++;
    else if (quote) stats.quotations++;
    else {
      stats.history++;
      stats.totalFils += gross;
    }
    if (!stats.from || at < stats.from) stats.from = at;
    if (!stats.to || at > stats.to) stats.to = at;
  }

  return { customers, vehicles: [...vehicles.values()], ownerships, orders, items, stats };
}

/* ---------------- Database ---------------- */

async function loadExisting(): Promise<Existing> {
  const [customers, vehicles, orders] = await Promise.all([db.customers.toArray(), db.vehicles.toArray(), db.orders.toArray()]);
  const ids = new Set<string>([...customers.map((c) => c.id), ...vehicles.map((v) => v.id), ...orders.map((o) => o.id)]);
  const customerByPhone = new Map<string, string>();
  for (const c of customers) if (c.phone && !c.archivedAt && !customerByPhone.has(c.phone)) customerByPhone.set(c.phone, c.id);
  const vehicleByPlate = new Map<string, string>();
  for (const v of vehicles) if (v.plate.number && !v.archivedAt) vehicleByPlate.set(plateKey(v.plate), v.id);
  return { ids, customerByPhone, vehicleByPlate };
}

/** What the import would add, without changing anything. */
export async function previewEaglecartImport(data: EaglecartExport, opts: ImportOptions = {}): Promise<ImportPlan['stats']> {
  return planEaglecartImport(data, await loadExisting(), opts).stats;
}

export async function importEaglecart(data: EaglecartExport, opts: ImportOptions = {}): Promise<ImportPlan['stats']> {
  return db.transaction('rw', [db.customers, db.vehicles, db.ownerships, db.orders, db.items], async () => {
    const plan = planEaglecartImport(data, await loadExisting(), opts);
    await db.customers.bulkAdd(plan.customers);
    await db.vehicles.bulkAdd(plan.vehicles);
    await db.ownerships.bulkPut(plan.ownerships);
    await db.orders.bulkAdd(plan.orders);
    await db.items.bulkPut(plan.items);
    return plan.stats;
  });
}

/** How much Eaglecart history is in the database. */
export async function eaglecartImported(): Promise<{ orders: number; customers: number; vehicles: number }> {
  const [orders, customers, vehicles] = await Promise.all([
    db.orders.filter((o) => !!o.imported).count(),
    db.customers.filter((c) => c.id.startsWith('ec-c-')).count(),
    db.vehicles.filter((v) => v.id.startsWith('ec-v-')).count(),
  ]);
  return { orders, customers, vehicles };
}

/**
 * Take the import back: imported jobs that have not been worked on in MyGarage (no invoice, payment,
 * act or estimate sent), then imported cars and customers nothing else refers to any more.
 */
export async function removeEaglecartImport(): Promise<number> {
  return db.transaction('rw', [db.customers, db.vehicles, db.ownerships, db.orders, db.items, db.invoices, db.payments, db.inspections, db.versions, db.debts], async () => {
    const imported = await db.orders.filter((o) => !!o.imported).toArray();
    let removed = 0;
    for (const o of imported) {
      const touched =
        (await db.invoices.where('orderId').equals(o.id).count()) +
        (await db.payments.where('orderId').equals(o.id).count()) +
        (await db.inspections.where('orderId').equals(o.id).count()) +
        (await db.versions.where('orderId').equals(o.id).count()) +
        (await db.debts.where('orderId').equals(o.id).count());
      if (touched) continue;
      await db.items.where('orderId').equals(o.id).delete();
      await db.orders.delete(o.id);
      removed++;
    }
    const orders = await db.orders.toArray();
    const usedVehicles = new Set(orders.map((o) => o.vehicleId));
    const usedCustomers = new Set(orders.map((o) => o.customerId));
    for (const v of await db.vehicles.filter((v) => v.id.startsWith('ec-v-') && !usedVehicles.has(v.id)).toArray()) {
      await db.ownerships.where('vehicleId').equals(v.id).delete();
      await db.vehicles.delete(v.id);
    }
    const ownersLeft = new Set((await db.vehicles.toArray()).map((v) => v.customerId));
    for (const c of await db.customers.filter((c) => c.id.startsWith('ec-c-') && !usedCustomers.has(c.id) && !ownersLeft.has(c.id)).toArray()) {
      await db.customers.delete(c.id);
    }
    return removed;
  });
}
