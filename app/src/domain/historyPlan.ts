import { parseCarText } from './docImport';
import { matchSummary, monthTable, plateKey, plateNear, type MonthRow, type ReadDocument, type ReadInvoice } from './historyInvoices';
import { normalizePlate, plateSearchKey } from './plates';
import type { Emirate, HistoryFlag, HistoryInvoice, HistorySummaryRow, Order, Ownership, Plate, Vehicle } from './types';
import { vehicleTypeOf } from './vehicleType';

/*
 * What an import of a customer's invoices from before this app would write (v0.45) — worked out before anything is
 * written, so that it can be looked at (a dry run) and checked: every invoice a record of its own (the same document read
 * again is the same record — its id is the template, the kind of number, the number and the day); the summaries' rows
 * apart from them, each with the invoice it is or «no document». Each invoice goes with:
 *   - its job here, when it is one (a Tax Invoice's number is its Eaglecart job's: the jobs brought in as history;
 *     a job Eaglecart had twice is the one kept here);
 *   - its car — the customer's car with that plate; a plate a typing slip off a car of theirs (the job's car first) is
 *     that car, marked; a plate not theirs at all — a car brought in with it (marked).
 * Nothing is put right silently: what does not agree (the job's sum or car, the plate) is a flag on the invoice. Pure.
 */

export interface PlanDoc {
  file: string;
  sha256: string;
  read: ReadDocument;
}

export interface PlanInput {
  customerId: string;
  docs: PlanDoc[];
  /** Every car here (a plate is one car's in the whole garage). */
  vehicles: Vehicle[];
  /** The customer's jobs. */
  orders: Order[];
  /** The customer's history invoices and summary rows already here (an import again changes only what differs). */
  existing: HistoryInvoice[];
  existingRows: HistorySummaryRow[];
  /** The standard service of a description (the catalogue), none — to be looked at. */
  serviceOf: (description: string) => string | undefined;
  now: string;
}

export interface HistoryPlan {
  /** Every invoice read, as it would stand. */
  invoices: HistoryInvoice[];
  rows: HistorySummaryRow[];
  /** Cars to bring in (a plate not the customer's) or to give their body (none set before). */
  vehicles: Vehicle[];
  ownerships: Ownership[];
  /** Only what is new or other than what is here. */
  write: { invoices: HistoryInvoice[]; rows: HistorySummaryRow[] };
  table: MonthRow[];
  /** Cars the invoices are of; of them brought in now. */
  cars: number;
  newCars: number;
  /** Pages not read, sums that do not add up, a document read twice: an import does not go on with any. */
  problems: string[];
  unchanged: number;
}

/** "H-10265" — a car's plate as code-number. */
export const carPlate = (p: Pick<Plate, 'code' | 'number'>) => plateKey(`${p.code} ${p.number}`);

/**
 * Plates compared as their letters and digits only, an emirate's letters before a numeric code left out: "AD1 2345" (an
 * invoice), "AD-12345" (Eaglecart glued it) and Abu Dhabi's "1-2345" are one car.
 */
export const matchKey = (key: string) =>
  key
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^(?:AD|AUH|DXB|DU|SHJ|AJM|RAK|UAQ|FUJ)(?=\d)/, '');

const EMIRATE_LETTERS: [RegExp, Emirate][] = [
  [/^(?:AD|AUH)(\d{1,2})$/, 'AUH'],
  [/^(?:SHJ)(\d{1,2})$/, 'SHJ'],
  [/^(?:AJM)(\d{1,2})$/, 'AJM'],
  [/^(?:RAK)(\d{1,2})$/, 'RAK'],
  [/^(?:UAQ)(\d{1,2})$/, 'UAQ'],
  [/^(?:FUJ)(\d{1,2})$/, 'FUJ'],
];

/** A printed plate as a car's plate: "AD1-2345" — Abu Dhabi, code 1; else Dubai (an invoice does not print the emirate). */
function plateOf(key: string): Plate {
  const [code, number] = key.includes('-') ? key.split('-') : ['', key];
  for (const [re, emirate] of EMIRATE_LETTERS) {
    const m = re.exec(code);
    if (m) return normalizePlate({ emirate, code: m[1], number });
  }
  return normalizePlate({ emirate: 'DXB', code, number });
}

const fmt = (fils: number) => (fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An object as text with its keys in order (two records the same whatever order their fields came in). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
/** Two records the same but for when they were brought in and what the sync marks them with (`_t`). */
const sameRecord = <T extends { importedAt: string }>(a: T, b: T) => {
  const plain = (r: T) => Object.fromEntries(Object.entries({ ...r, importedAt: '' }).filter(([k]) => !k.startsWith('_')));
  return stable(plain(a)) === stable(plain(b));
};

export function planHistory(input: PlanInput): HistoryPlan {
  const { customerId, now } = input;
  const problems: string[] = [];
  const mine = input.vehicles.filter((v) => v.customerId === customerId && !v.archivedAt);
  const cars = new Map(mine.map((v) => [matchKey(carPlate(v.plate)), v]));
  const others = new Map(input.vehicles.filter((v) => v.customerId !== customerId).map((v) => [v.plateSearch, v]));
  const added = new Map<string, Vehicle>();
  const ownerships: Ownership[] = [];

  // Jobs by their numbers here and in Eaglecart; a job Eaglecart had twice — by the double's number too.
  const byNo = new Map<string, Order[]>();
  for (const o of input.orders)
    for (const k of new Set([String(o.number), o.imported?.jobNo, o.eaglecartNo !== undefined ? String(o.eaglecartNo) : undefined].filter((x): x is string => !!x))) (byNo.get(k) ?? byNo.set(k, []).get(k)!).push(o);
  const twinOf = new Map<string, Order>();
  for (const o of input.orders) for (const t of o.imported?.twins ?? []) twinOf.set(t.jobNo, o);
  const day = (o: Order) => Date.parse((o.arrivedAt || o.createdAt).slice(0, 10));
  const jobOf = (inv: ReadInvoice): { order: Order; twin: boolean } | undefined => {
    if (inv.template !== 'B') return undefined;
    const at = Date.parse(inv.date);
    const close = (o: Order) => Math.abs(day(o) - at) <= 45 * 86_400_000;
    const hits = (byNo.get(inv.number) ?? []).filter(close).sort((a, b) => Math.abs(day(a) - at) - Math.abs(day(b) - at));
    if (hits.length) return { order: hits[0], twin: false };
    const twin = twinOf.get(inv.number);
    return twin && close(twin) ? { order: twin, twin: true } : undefined;
  };

  const broughtIn = (inv: ReadInvoice): HistoryFlag => ({ code: 'new-car', text: `a car brought in: ${inv.plate} ${inv.vehicleText}`.trim() });
  /** The plates whose car an import brought in, flagged already on the invoice that brought it (the first with it). */
  const flaggedNew = new Set<string>();
  const carOf = (inv: ReadInvoice, order?: Order): { vehicle: Vehicle; flags: HistoryFlag[] } | undefined => {
    const key = matchKey(inv.plate);
    const exact = cars.get(key) ?? added.get(key);
    // A car an import brought in before: the invoice it came with keeps saying so (an import again changes nothing).
    if (exact && exact.id.startsWith(`hv-${customerId}-`) && !added.has(key) && !flaggedNew.has(key)) {
      flaggedNew.add(key);
      return { vehicle: exact, flags: [broughtIn(inv)] };
    }
    if (exact) return { vehicle: exact, flags: [] };
    const jobCar = order && mine.find((v) => v.id === order.vehicleId);
    const near = jobCar && plateNear(matchKey(carPlate(jobCar.plate)), key) ? [jobCar] : mine.filter((v) => plateNear(matchKey(carPlate(v.plate)), key));
    if (near.length === 1) return { vehicle: near[0], flags: [{ code: 'plate', text: `printed ${inv.plate}, the car is ${carPlate(near[0].plate)}` }] };
    const plate = plateOf(inv.plate);
    if (!plate.number) {
      problems.push(`${inv.number} (${inv.date}): no plate to know the car by`);
      return undefined;
    }
    const taken = others.get(plateSearchKey(plate));
    if (taken) {
      problems.push(`${inv.number} (${inv.date}): ${inv.plate} is another customer's car here`);
      return undefined;
    }
    const car = parseCarText(inv.vehicleText);
    car.model = car.model.replace(/\b([A-Z])([A-Z]{3,})\b/g, (_, a: string, b: string) => a + b.toLowerCase());
    const v: Vehicle = {
      id: `hv-${customerId}-${key}`,
      plate,
      plateSearch: plateSearchKey(plate),
      make: car.make,
      model: car.model,
      ...(car.color ? { color: car.color } : {}),
      ...(inv.vin ? { vin: inv.vin } : {}),
      ...(vehicleTypeOf(car.make, car.model) ? { type: vehicleTypeOf(car.make, car.model) } : {}),
      customerId,
      notes: `Brought in with invoice ${inv.number} of ${inv.date}`,
      createdAt: now,
    };
    added.set(key, v);
    flaggedNew.add(key);
    ownerships.push({ id: `ho-${v.id}`, vehicleId: v.id, customerId, from: `${inv.date}T00:00:00.000Z` });
    return { vehicle: v, flags: [broughtIn(inv)] };
  };

  const existing = new Map(input.existing.map((i) => [i.id, i]));
  const invoices: HistoryInvoice[] = [];
  const ids = new Map<ReadInvoice, string>();
  for (const doc of input.docs) {
    for (const inv of doc.read.invoices) {
      const id = `hi-${inv.template}-${inv.numberKind}-${inv.number}-${inv.date}`;
      ids.set(inv, id);
      if (invoices.some((i) => i.id === id)) {
        problems.push(`${doc.file}, page ${inv.page}: ${inv.number} of ${inv.date} is read twice`);
        continue;
      }
      const job = jobOf(inv);
      const found = carOf(inv, job?.order);
      if (!found) continue;
      const flags: HistoryFlag[] = [...found.flags];
      const total = inv.lines.reduce((a, l) => a + l.grossFils, 0);
      if (job) {
        const o = job.order;
        if (job.twin) flags.push({ code: 'job-twin', text: `Eaglecart's job ${inv.number} is its double of job ${o.number}` });
        if (o.imported && o.imported.totalFils !== total) flags.push({ code: 'job-sum', text: `job ${o.number} here: ${fmt(o.imported.totalFils)}` });
        if (o.vehicleId !== found.vehicle.id) {
          const jobCar = input.vehicles.find((v) => v.id === o.vehicleId);
          flags.push({ code: 'job-car', text: `job ${o.number} here is on ${jobCar ? carPlate(jobCar.plate) : 'another car'}` });
        }
      } else if (inv.template === 'B') flags.push({ code: 'no-job', text: `no job ${inv.number} here` });
      const before = existing.get(id);
      const lines = inv.lines.map((l, i) => {
        // A service set by hand stays; else the catalogue's.
        const kept = before?.lines[i]?.description === l.description ? before.lines[i].serviceId : undefined;
        const serviceId = kept ?? input.serviceOf(l.description);
        return { ...l, ...(serviceId ? { serviceId } : {}) };
      });
      const record: HistoryInvoice = {
        id,
        customerId,
        vehicleId: found.vehicle.id,
        ...(job ? { orderId: job.order.id } : {}),
        template: inv.template,
        numberKind: inv.numberKind,
        number: inv.number,
        date: inv.date,
        ...(inv.time ? { time: inv.time } : {}),
        plateRaw: inv.plateRaw,
        plate: inv.plate,
        vehicleText: inv.vehicleText,
        ...(inv.vin ? { vin: inv.vin } : {}),
        lines,
        netFils: lines.reduce((a, l) => a + l.netFils, 0),
        vatFils: lines.reduce((a, l) => a + l.vatFils, 0),
        totalFils: total,
        ...(inv.paymentMethod ? { paymentMethod: inv.paymentMethod } : {}),
        source: { file: doc.file, sha256: doc.sha256, page: inv.page, ...(inv.pages && inv.pages > 1 ? { pages: inv.pages } : {}) },
        ...(flags.length ? { flags } : {}),
        importedAt: now,
      };
      invoices.push(before && sameRecord(record, before) ? before : record);
    }
    problems.push(...doc.read.problems.map((p) => `${doc.file}: ${p}`));
  }

  // The summaries' rows, each with its invoice (or none), and their printed totals.
  const rows: HistorySummaryRow[] = [];
  const existingRows = new Map(input.existingRows.map((r) => [r.id, r]));
  for (const doc of input.docs) {
    const s = doc.read.summary;
    if (!s) continue;
    const months = s.rows.map((r) => r.date?.slice(0, 7)).filter((m): m is string => !!m);
    const month = months.sort((a, b) => months.filter((x) => x === b).length - months.filter((x) => x === a).length)[0] ?? doc.read.invoices[0]?.date.slice(0, 7);
    if (!month) continue;
    const { matches } = matchSummary(s.rows, doc.read.invoices);
    const put = (row: HistorySummaryRow) => {
      const before = existingRows.get(row.id);
      rows.push(before && sameRecord(row, before) ? before : row);
    };
    for (const m of matches) {
      const r = m.row;
      put({
        id: `hs-${customerId}-${month}-${r.no}`,
        customerId,
        month,
        kind: 'row',
        no: r.no,
        ...(r.date ? { date: r.date } : {}),
        vehicleText: r.vehicleText,
        plateRaw: r.plateRaw,
        plate: r.plate,
        ...(r.invoiceNo ? { invoiceNo: r.invoiceNo } : {}),
        amountFils: r.amountFils,
        ...(m.invoice !== undefined ? { invoiceId: ids.get(doc.read.invoices[m.invoice]) } : {}),
        status: m.status,
        source: { file: doc.file, sha256: doc.sha256, page: r.page },
        importedAt: now,
      });
    }
    if (s.totalFils !== undefined)
      put({ id: `hs-${customerId}-${month}-0`, customerId, month, kind: 'total', no: 0, amountFils: s.totalFils, status: 'total', source: { file: doc.file, sha256: doc.sha256, page: s.page }, importedAt: now });
  }

  // Cars without a body: the one their make and model say.
  const typed = mine.filter((v) => !v.type && invoices.some((i) => i.vehicleId === v.id) && vehicleTypeOf(v.make, v.model)).map((v) => ({ ...v, type: vehicleTypeOf(v.make, v.model) }));
  const write = {
    invoices: invoices.filter((i) => existing.get(i.id) !== i),
    rows: rows.filter((r) => existingRows.get(r.id) !== r),
  };
  return {
    invoices,
    rows,
    vehicles: [...added.values(), ...typed],
    ownerships,
    write,
    table: monthTable(invoices),
    cars: new Set(invoices.map((i) => i.vehicleId)).size,
    newCars: added.size,
    problems,
    unchanged: invoices.length - write.invoices.length,
  };
}
