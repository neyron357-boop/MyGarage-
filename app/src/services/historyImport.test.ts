import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { readDocument } from '../domain/historyInvoices';
import type { PlanDoc } from '../domain/historyPlan';
import type { TextItem } from '../domain/obdReport';
import type { Order } from '../domain/types';
import { createCustomer, createVehicle } from './customers';
import { applyHistoryImport, expectedTable, planHistoryImport } from './historyImport';
import { ensureSeed } from './seed';

/*
 * A customer's invoices from before this app brought in from their PDFs (v0.45): a dry run writes nothing; the import
 * writes all of it or none; run again, nothing changes. Made-up documents (both templates and a summary), no real ones.
 */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

function items(page: number, rows: [number, number, string][]): TextItem[] {
  return rows.map(([x, y, str]) => ({ page, x, y, str, w: str.length * 5 }));
}

/** A Tax Invoice page (template B): "Job ID : <no>", the car and its plate, one line. */
function taxInvoice(page: number, no: string, plate: string, price: string, vat: string, total: string): TextItem[] {
  return items(page, [
    [38, 733, 'RUKN TEST GARAGE'],
    [245, 650, 'TAX INVOICE'],
    [38, 622, 'SELLER'],
    [504, 622, 'BILL TO'],
    [350, 614, 'ACME CONTRACTING LLC'],
    [510, 562, 'Mitsubishi Pajero'],
    [490, 548, 'PLATE'],
    [540, 548, ':'],
    [544, 548, plate],
    [38, 545, 'Job ID'],
    [133, 545, ':'],
    [138, 545, no],
    [38, 530, 'Date'],
    [84, 530, '1 Jul 2026, 4:50:00'],
    [164, 530, 'PM · GST'],
    [38, 502, '#'],
    [55, 502, 'Description'],
    [261, 502, 'Price'],
    [323, 502, 'Discount'],
    [404, 502, 'VAT'],
    [464, 502, 'Qty'],
    [523, 502, 'Total'],
    [38, 482, '1.'],
    [55, 482, 'CHANGE BATTERY'],
    [261, 482, 'AED'],
    [282, 482, price],
    [404, 482, 'AED'],
    [425, 482, vat],
    [481, 482, '1'],
    [528, 482, 'AED'],
    [550, 482, total],
    [38, 353, 'Total Qty'],
    [119, 353, '1'],
    [334, 297, 'Total'],
    [496, 297, 'AED'],
    [523, 297, total],
  ]);
}

/** An invoice of the old template (A): "# <no>", May, the car, its plate, one line. */
function oldInvoice(page: number, no: string, plate: string): TextItem[] {
  return items(page, [
    [400, 800, 'INVOICE'],
    [400, 786, `# ${no}`],
    [400, 772, 'Date:'],
    [460, 772, 'May 2, 2026'],
    [40, 758, 'Bill To:'],
    [40, 744, 'ACME CONTRACTING L.L.C.'],
    [40, 730, 'TOYOTA HILLUX'],
    [40, 716, `PLATE NO.${plate}`],
    [40, 702, 'Item'],
    [300, 702, 'Quantity'],
    [380, 702, 'Rate'],
    [470, 702, 'Amount'],
    [40, 688, 'CHANGE OIL'],
    [300, 688, '1'],
    [380, 688, 'AED 220.00'],
    [470, 688, 'AED 220.00'],
    [380, 674, 'Subtotal:'],
    [470, 674, 'AED 220.00'],
    [380, 660, 'Tax (5%):'],
    [470, 660, 'AED 11.00'],
    [380, 646, 'Total:'],
    [470, 646, 'AED 231.00'],
  ]);
}

const summary = items(1, [
  [200, 800, 'COMPANY INVOICE SUMMARY'],
  [40, 786, 'DATE'],
  [120, 786, 'CAR NAME'],
  [260, 786, 'PLATE NO.'],
  [460, 786, 'AMOUNT'],
  [40, 772, '1-Jul-26'],
  [120, 772, 'MITSUBISHI PAJERO'],
  [260, 772, 'H-10257'],
  [460, 772, '430.50'],
  [40, 758, '29-Jul-26'],
  [120, 758, 'AUDI A6'],
  [260, 758, 'P-20202'],
  [460, 758, '315.00'],
  [360, 744, 'TOTAL'],
  [460, 744, '745.50'],
]);

const doc = (file: string, its: TextItem[], pages: number): PlanDoc => ({ file, sha256: file.padEnd(64, '0'), read: readDocument(its, pages, 500) });

async function company() {
  const c = await createCustomer({ name: 'ACME CONTRACTING LLC', phone: '', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'company', trn: '100000000000003' });
  const pajero = await createVehicle(c.id, { plate: { emirate: 'DXB', code: 'H', number: '10265' }, make: 'Mitsubishi', model: 'Pajero' });
  // Its July job, brought in from Eaglecart as history.
  const order: Order = {
    id: uid(),
    number: 107,
    customerId: c.id,
    vehicleId: pajero.id,
    stage: 'closed',
    outcome: 'completed',
    complaint: '',
    docLanguage: 'en',
    stageChangedAt: '2026-07-01T12:50:00.000Z',
    createdAt: '2026-07-01T12:50:00.000Z',
    updatedAt: '2026-07-01T12:50:00.000Z',
    arrivedAt: '2026-07-01T12:50:00.000Z',
    imported: { system: 'eaglecart', jobId: '185', jobNo: '107', status: 'Pending', totalFils: 43050, history: true, importedAt: '2026-11-11T00:00:00.000Z' },
  } as Order;
  await db.orders.add(order);
  return { c, pajero, order };
}

describe('invoices from before the app brought in (v0.45)', () => {
  it('a month’s summary takes its invoices from every PDF given with it: those its own file left out, in a PDF of their own (v0.46.3)', async () => {
    const { c } = await company();
    const july = doc('july.pdf', [...summary, ...taxInvoice(2, '107', 'H-10265', '410.00', '20.50', '430.50')], 2);
    const more = doc('july-more.pdf', taxInvoice(1, '105', 'P-20202', '300.00', '15.00', '315.00'), 1);
    // The July PDF alone: the Audi's row has no document.
    await applyHistoryImport(c.id, await planHistoryImport(c.id, [july]));
    expect((await db.historySummaryRows.toArray()).find((r) => r.plate === 'P-20202')).toMatchObject({ status: 'missing' });
    // Then both: the invoice that came apart is written, and the row is its own now; nothing else changes.
    const plan = await planHistoryImport(c.id, [july, more]);
    expect(plan.problems).toEqual([]);
    expect(plan.write.invoices.map((i) => i.id)).toEqual(['hi-B-job-105-2026-07-01']);
    expect(plan.write.rows.map((r) => [r.plate, r.status, r.invoiceId])).toEqual([['P-20202', 'ok', 'hi-B-job-105-2026-07-01']]);
    await applyHistoryImport(c.id, plan);
    expect((await db.historySummaryRows.toArray()).map((r) => [r.plate, r.status]).sort()).toEqual([
      [undefined, 'total'],
      ['H-10257', 'plate'],
      ['P-20202', 'ok'],
    ]);
    expect(plan.table.at(-1)).toMatchObject({ invoices: 2, totalFils: 74550 });
    expect((await planHistoryImport(c.id, [july, more])).write).toEqual({ invoices: [], rows: [] });
  });

  it('a dry run writes nothing; the import: each invoice with its job and car, a new car, the summary’s rows; again — nothing changes', async () => {
    const { c, pajero, order } = await company();
    const docs = [doc('july.pdf', [...summary, ...taxInvoice(2, '107', 'H-10265', '410.00', '20.50', '430.50')], 2), doc('may.pdf', oldInvoice(1, '204', 'EE 12345'), 1)];
    const plan = await planHistoryImport(c.id, docs);
    expect(plan.problems).toEqual([]);
    expect(await db.historyInvoices.count()).toBe(0);
    expect(plan.invoices.map((i) => [i.id, i.orderId, i.vehicleId === pajero.id])).toEqual([
      ['hi-B-job-107-2026-07-01', order.id, true],
      ['hi-A-invoice-204-2026-05-02', undefined, false],
    ]);
    expect(plan.newCars).toBe(1);
    expect(plan.table.at(-1)).toEqual({ month: 'all', invoices: 2, lines: 2, netFils: 63000, vatFils: 3150, totalFils: 66150 });
    // The summary: a plate typed wrong, a row without its document, the printed total.
    expect(plan.rows.map((r) => [r.kind, r.plate, r.status, !!r.invoiceId])).toEqual([
      ['row', 'H-10257', 'plate', true],
      ['row', 'P-20202', 'missing', false],
      ['total', undefined, 'total', false],
    ]);

    const done = await applyHistoryImport(c.id, plan, expectedTable(JSON.stringify({ months: [{ month: '2026-05', invoices: 1, lines: 1, net: '220.00', vat: '11.00', total: '231.00' }, { month: '2026-07', invoices: 1, lines: 1, net: '410.00', vat: '20.50', total: '430.50' }, { month: 'all', invoices: 2, lines: 2, net: '630.00', vat: '31.50', total: '661.50' }] })));
    expect(done).toMatchObject({ invoices: 2, rows: 3, cars: 1 });
    const fresh = (await db.vehicles.where('customerId').equals(c.id).toArray()).find((v) => v.id !== pajero.id)!;
    expect(fresh).toMatchObject({ plate: { emirate: 'DXB', code: 'EE', number: '12345' }, make: 'Toyota', type: 'pickup' });
    expect(await db.ownerships.where('vehicleId').equals(fresh.id).count()).toBe(1);
    // The job and its money are not touched: the history invoice is not this app's invoice.
    expect(await db.invoices.count()).toBe(0);
    expect((await db.orders.get(order.id))!.stage).toBe('closed');

    const again = await planHistoryImport(c.id, docs);
    expect(again.write).toEqual({ invoices: [], rows: [] });
    expect(again.unchanged).toBe(2);
    await applyHistoryImport(c.id, again);
    expect(await db.historyInvoices.count()).toBe(2);
    expect(await db.vehicles.where('customerId').equals(c.id).count()).toBe(2);
  });

  it('figures other than the expected ones — nothing is written; other than the plan’s once written — all of it rolled back', async () => {
    const { c } = await company();
    const docs = [doc('may.pdf', oldInvoice(1, '204', 'EE 12345'), 1)];
    const plan = await planHistoryImport(c.id, docs);
    await expect(applyHistoryImport(c.id, plan, [{ month: 'all', invoices: 1, lines: 1, netFils: 22000, vatFils: 1100, totalFils: 23101 }])).rejects.toMatchObject({ code: 'history.mismatch' });
    // A plan whose table is not what its invoices make: written, counted again, rolled back — the new car too.
    const bad = { ...plan, table: plan.table.map((r) => ({ ...r, totalFils: r.totalFils + 1 })) };
    await expect(applyHistoryImport(c.id, bad)).rejects.toMatchObject({ code: 'history.mismatch' });
    expect(await db.historyInvoices.count()).toBe(0);
    expect(await db.vehicles.where('customerId').equals(c.id).count()).toBe(1);
    // A sum that does not add up stops it before anything.
    const wrong = { ...plan, problems: ['page 2: the lines add up to 231.00, the total printed is 232.00'] };
    await expect(applyHistoryImport(c.id, wrong)).rejects.toMatchObject({ code: 'history.problems' });
  });
});
