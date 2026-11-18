import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { monthTable, readDocument, tableDiff, type MonthRow } from '../domain/historyInvoices';
import { planHistory, type HistoryPlan, type PlanDoc } from '../domain/historyPlan';
import type { HistoryInvoice } from '../domain/types';
import { AppError } from './errors';
import { sha256Hex } from './media';

/*
 * A customer's invoices from before this app, brought in from their PDFs (v0.45 — a corporate customer's May–October 2026). Each PDF is
 * read on the device (domain/historyInvoices.ts) and the import is worked out first (domain/historyPlan.ts) — the month
 * table, the cars, every flag — to be looked at: a dry run writes nothing. The import then writes in one transaction and,
 * inside it, counts the month table again from what it wrote: other than the plan's (or than the expected one given) —
 * nothing of it stays. Run again, it writes only what differs (none — nothing). Nothing here is ever deleted.
 */

/** A month's PDF read: its pages, invoices (checked), summary. */
export async function readHistoryPdf(file: Blob, name: string): Promise<PlanDoc> {
  const { pdfTextPages } = await import('./pdfText');
  const [{ items, pages }, sha256] = await Promise.all([pdfTextPages(file), sha256Hex(file)]);
  const rate = (await db.settings.get('main'))?.vatRateBp ?? 500;
  return { file: name, sha256, read: readDocument(items, pages, rate) };
}

/** What an import of these PDFs would write into the customer's card — nothing is written. */
export async function planHistoryImport(customerId: string, docs: PlanDoc[]): Promise<HistoryPlan> {
  const [vehicles, orders, existing, existingRows] = await Promise.all([
    db.vehicles.toArray(),
    db.orders.where('customerId').equals(customerId).toArray(),
    db.historyInvoices.where('customerId').equals(customerId).toArray(),
    db.historySummaryRows.where('customerId').equals(customerId).toArray(),
  ]);
  return planHistory({ customerId, docs, vehicles, orders, existing, existingRows, now: nowIso() });
}

export interface HistoryImportResult {
  /** Records written: invoices, summary rows, cars (with their ownership). */
  invoices: number;
  rows: number;
  cars: number;
  /** The month table counted from what is here now. */
  table: MonthRow[];
}

/**
 * The plan written — all of it or none: a page not read or a sum that does not add up stops it before anything; inside
 * the transaction the month table is counted again from the invoices as written and must be the plan's and the expected
 * one (when given), else it is rolled back.
 */
export async function applyHistoryImport(customerId: string, plan: HistoryPlan, expected?: MonthRow[]): Promise<HistoryImportResult> {
  if (plan.problems.length) throw new AppError('history.problems', { n: plan.problems.length });
  if (expected) {
    const diff = tableDiff(plan.table, expected);
    if (diff.length) throw new AppError('history.mismatch', { diff: diff.join('; ') });
  }
  return db.transaction('rw', [db.historyInvoices, db.historySummaryRows, db.vehicles, db.ownerships], async () => {
    const newCars = plan.vehicles.filter((v) => v.id.startsWith('hv-'));
    // A car brought in by an import before is here already: added once.
    const here = new Set((await db.vehicles.bulkGet(newCars.map((v) => v.id))).filter(Boolean).map((v) => v!.id));
    const cars = plan.vehicles.filter((v) => !here.has(v.id) || !v.id.startsWith('hv-'));
    if (cars.length) await db.vehicles.bulkPut(cars);
    const owners = plan.ownerships.filter((o) => !here.has(o.vehicleId));
    if (owners.length) await db.ownerships.bulkPut(owners);
    if (plan.write.invoices.length) await db.historyInvoices.bulkPut(plan.write.invoices);
    if (plan.write.rows.length) await db.historySummaryRows.bulkPut(plan.write.rows);
    // Counted again from what is written: the plan's figures, to the fils.
    const back = (await db.historyInvoices.bulkGet(plan.invoices.map((i) => i.id))).filter((i): i is HistoryInvoice => !!i && i.customerId === customerId);
    const table = monthTable(back);
    const diff = [...tableDiff(table, plan.table), ...(expected ? tableDiff(table, expected) : [])];
    if (back.length !== plan.invoices.length || diff.length) throw new AppError('history.mismatch', { diff: diff.join('; ') || `${back.length} of ${plan.invoices.length}` });
    return { invoices: plan.write.invoices.length, rows: plan.write.rows.length, cars: cars.filter((v) => v.id.startsWith('hv-')).length, table };
  });
}

/** An expected month table from its file (as the terminal check takes it): { months: [{ month, invoices, lines, net, vat, total }] }. */
export function expectedTable(json: string): MonthRow[] {
  const parsed = JSON.parse(json) as { months?: { month: string; invoices: number; lines: number; net: string | number; vat: string | number; total: string | number }[] };
  if (!Array.isArray(parsed.months)) throw new AppError('history.expectedBad');
  const fils = (v: string | number) => Math.round(Number(String(v).replace(/,/g, '')) * 100);
  return parsed.months.map((m) => ({ month: m.month, invoices: Number(m.invoices), lines: Number(m.lines), netFils: fils(m.net), vatFils: fils(m.vat), totalFils: fils(m.total) }));
}
