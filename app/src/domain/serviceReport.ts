import { lineServices, type Catalog } from './serviceCatalog';
import type { Service, VehicleType } from './types';

/*
 * A customer's service report of a period (v0.46): the invoices, every line of them with its standard service and
 * category (the catalogue), and the figures a fleet's manager reads — by month, by category, by service, by car. The
 * numbers are the invoices' own: each sum is the sum of their lines. A car is its plate as printed on the invoices (the
 * customer's own way to look a car up). A line the catalogue does not know is «Other» here and waits in «Проверить».
 * Pure; the Excel is domain/customerExcel.ts.
 */

export interface ReportLine {
  description: string;
  qty: number;
  /** Price of one, without VAT. */
  unitNetFils: number;
  netFils: number;
  vatFils: number;
  grossFils: number;
}

export interface ReportInvoice {
  number: string;
  /** YYYY-MM-DD */
  date: string;
  plate: string;
  vehicle: string;
  type?: VehicleType;
  netFils: number;
  vatFils: number;
  totalFils: number;
  lines: ReportLine[];
}

/** What a line the catalogue does not know is in the report. */
export const OTHER = 'Other';

export interface WorkRow extends ReportLine {
  invoice: ReportInvoice;
  service: string;
  category: string;
  kind?: Service['kind'];
}

export interface ServiceRow {
  name: string;
  category: string;
  /** Lines of it. */
  times: number;
  vehicles: number;
  qty: number;
  netFils: number;
  vatFils: number;
  totalFils: number;
}

export interface VehicleRow {
  plate: string;
  vehicle: string;
  type?: VehicleType;
  visits: number;
  first: string;
  last: string;
  totalFils: number;
  oilChanges: number;
  lastOil?: string;
}

export interface MonthFigures {
  /** YYYY-MM */
  month: string;
  invoices: number;
  vehicles: number;
  netFils: number;
  vatFils: number;
  totalFils: number;
}

export interface CategoryRow {
  name: string;
  times: number;
  netFils: number;
  vatFils: number;
  totalFils: number;
}

export interface ServiceReport {
  invoices: ReportInvoice[];
  work: WorkRow[];
  /** The most done first. */
  services: ServiceRow[];
  /** The most spent on first. */
  vehicles: VehicleRow[];
  months: MonthFigures[];
  /** The most spent on first. */
  categories: CategoryRow[];
  totals: { invoices: number; lines: number; vehicles: number; netFils: number; vatFils: number; totalFils: number };
  /** Descriptions no service is known for, with their lines. */
  unmapped: { description: string; lines: number }[];
}

const byNumber = (a: ReportInvoice, b: ReportInvoice) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'en', { numeric: true });

export function serviceReport(list: ReportInvoice[], catalog: Catalog): ServiceReport {
  const invoices = [...list].sort(byNumber);
  const of = lineServices(catalog);
  const position = new Map(catalog.services.map((s) => [s.name, s.position]));
  const catPosition = new Map(catalog.categories.map((c) => [c.name, c.position]));
  const work: WorkRow[] = [];
  const unmapped = new Map<string, { description: string; lines: number }>();
  for (const invoice of invoices)
    for (const l of invoice.lines) {
      const { service, category } = of(l.description);
      if (!service) {
        const key = l.description.trim().toUpperCase();
        const u = unmapped.get(key) ?? unmapped.set(key, { description: l.description.trim(), lines: 0 }).get(key)!;
        u.lines++;
      }
      work.push({ ...l, invoice, service: service?.name ?? OTHER, category: category?.name ?? OTHER, ...(service?.kind ? { kind: service.kind } : {}) });
    }

  const services = new Map<string, ServiceRow & { plates: Set<string> }>();
  const categories = new Map<string, CategoryRow>();
  for (const w of work) {
    const s = services.get(w.service) ?? services.set(w.service, { name: w.service, category: w.category, times: 0, vehicles: 0, qty: 0, netFils: 0, vatFils: 0, totalFils: 0, plates: new Set() }).get(w.service)!;
    s.times++;
    s.qty += w.qty;
    s.netFils += w.netFils;
    s.vatFils += w.vatFils;
    s.totalFils += w.grossFils;
    s.plates.add(w.invoice.plate);
    const c = categories.get(w.category) ?? categories.set(w.category, { name: w.category, times: 0, netFils: 0, vatFils: 0, totalFils: 0 }).get(w.category)!;
    c.times++;
    c.netFils += w.netFils;
    c.vatFils += w.vatFils;
    c.totalFils += w.grossFils;
  }
  const serviceRows = [...services.values()]
    .map(({ plates, ...s }) => ({ ...s, vehicles: plates.size }))
    .sort((a, b) => b.times - a.times || b.totalFils - a.totalFils || (position.get(a.name) ?? 1e9) - (position.get(b.name) ?? 1e9) || a.name.localeCompare(b.name));
  const categoryRows = [...categories.values()].sort((a, b) => b.totalFils - a.totalFils || (catPosition.get(a.name) ?? 1e9) - (catPosition.get(b.name) ?? 1e9));

  const cars = new Map<string, VehicleRow>();
  for (const inv of invoices) {
    const v = cars.get(inv.plate);
    if (!v) cars.set(inv.plate, { plate: inv.plate, vehicle: inv.vehicle, ...(inv.type ? { type: inv.type } : {}), visits: 1, first: inv.date, last: inv.date, totalFils: inv.totalFils, oilChanges: 0 });
    else {
      v.visits++;
      v.last = inv.date;
      v.totalFils += inv.totalFils;
      // The latest invoice names the car.
      if (inv.vehicle) v.vehicle = inv.vehicle;
      if (inv.type) v.type = inv.type;
    }
  }
  for (const w of work)
    if (w.kind === 'oil') {
      const v = cars.get(w.invoice.plate)!;
      v.oilChanges++;
      if (!v.lastOil || w.invoice.date > v.lastOil) v.lastOil = w.invoice.date;
    }
  const vehicles = [...cars.values()].sort((a, b) => b.totalFils - a.totalFils || a.plate.localeCompare(b.plate, 'en', { numeric: true }));

  const months = new Map<string, MonthFigures & { plates: Set<string> }>();
  for (const inv of invoices) {
    const key = inv.date.slice(0, 7);
    const m = months.get(key) ?? months.set(key, { month: key, invoices: 0, vehicles: 0, netFils: 0, vatFils: 0, totalFils: 0, plates: new Set() }).get(key)!;
    m.invoices++;
    m.netFils += inv.netFils;
    m.vatFils += inv.vatFils;
    m.totalFils += inv.totalFils;
    m.plates.add(inv.plate);
  }
  return {
    invoices,
    work,
    services: serviceRows,
    vehicles,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(({ plates, ...m }) => ({ ...m, vehicles: plates.size })),
    categories: categoryRows,
    totals: {
      invoices: invoices.length,
      lines: work.length,
      vehicles: cars.size,
      netFils: invoices.reduce((a, i) => a + i.netFils, 0),
      vatFils: invoices.reduce((a, i) => a + i.vatFils, 0),
      totalFils: invoices.reduce((a, i) => a + i.totalFils, 0),
    },
    unmapped: [...unmapped.values()].sort((a, b) => b.lines - a.lines || a.description.localeCompare(b.description)),
  };
}
