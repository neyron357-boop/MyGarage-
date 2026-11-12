import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiAt, dubaiDate, nowIso } from '../domain/dates';
import type { Customer, EstimateVersion, Order, SnapshotItem, Vehicle } from '../domain/types';
import { addItem } from './estimate';
import { approveAll } from './flow';
import { mechanicText, optionsText, partRequestText, reportText, simpleMessage, tidy, versionMessage } from './messages';
import { addNote, removeNote, restoreNote } from './notes';
import { checkIn, deleteJob, loadOrderBundle, restoreJob, updateOrder } from './orders';
import { importSuppliers, payOutsource, setOutsource, setProcurement, setReceivedQty, setReturnTerms } from './parts';
import { ensureSeed } from './seed';
import { tasksFor } from './today';

async function job() {
  return checkIn({ plate: { emirate: 'DXB', code: 'T', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Toyota', model: 'Camry', name: '', phone: '', docLanguage: 'en', complaint: 'Brake noise', arrivedNow: true });
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('job notes', () => {
  it('a typed note, a voice message; removed and put back; gone with a deleted job and back with Undo', async () => {
    const o = await job();
    await expect(addNote(o.id, { text: '   ' })).rejects.toThrow();
    const n1 = await addNote(o.id, { text: '  Front pads at 2 mm, discs OK  ' });
    const n2 = await addNote(o.id, { voice: new Blob(['x'], { type: 'audio/mp4' }), seconds: 7.4 });
    expect(n1.text).toBe('Front pads at 2 mm, discs OK');
    expect(n2).toMatchObject({ kind: 'voice', seconds: 7 });
    expect((await db.media.get(n2.mediaId!))?.kind).toBe('audio');
    let b = (await loadOrderBundle(o.id))!;
    expect(b.notes.map((n) => n.kind)).toEqual(['text', 'voice']);

    const removed = (await removeNote(n2.id))!;
    expect(await db.media.get(n2.mediaId!)).toBeUndefined();
    await restoreNote(removed);
    expect((await db.mediaBlobs.get(n2.mediaId!))?.blob).toBeTruthy();

    const gone = await deleteJob(o.id);
    expect(await db.notes.where('orderId').equals(o.id).count()).toBe(0);
    await restoreJob(gone);
    b = (await loadOrderBundle(o.id))!;
    expect(b.notes).toHaveLength(2);
  });
});

describe('parts: return terms, part of an order, work outside', () => {
  it('return deadline and no-returns; 2 of 3 came, then all', async () => {
    const o = await job();
    const p = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Spark plug', qty: 3, unitPriceFils: 3000 });
    await approveAll(o.id);
    await setProcurement(p.id, { status: 'ordered' });
    await setReturnTerms(p.id, { returnBy: '2026-11-20' });
    expect(await db.items.get(p.id)).toMatchObject({ returnBy: '2026-11-20' });
    await setReturnTerms(p.id, { noReturn: true });
    const it = (await db.items.get(p.id))!;
    expect(it.returnBy).toBeUndefined();
    expect(it.noReturn).toBe(true);

    await setReceivedQty(p.id, 2);
    expect(await db.items.get(p.id)).toMatchObject({ receivedQty: 2, procurementStatus: 'ordered' });
    await setReceivedQty(p.id, 3);
    const all = (await db.items.get(p.id))!;
    expect(all.procurementStatus).toBe('received');
    expect(all.receivedQty).toBeUndefined();
  });

  it('work outside: handed over, back, paid once — an expense of the job under "Subcontractors"', async () => {
    const o = await job();
    const paint = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Bumper paint', unitPriceFils: 50000 });
    await db.items.update(paint.id, { costPriceFils: 30000 });
    await approveAll(o.id);
    await setOutsource(paint.id, { state: 'out', dueAt: '2026-11-14' });
    let it = (await db.items.get(paint.id))!;
    expect(it.outsource).toMatchObject({ state: 'out', dueAt: '2026-11-14' });
    expect(it.outsource?.sentAt).toBeTruthy();
    await setOutsource(paint.id, { ...it.outsource!, state: 'back' });
    await payOutsource(paint.id, 'cash');
    await payOutsource(paint.id, 'cash');
    it = (await db.items.get(paint.id))!;
    const expenses = await db.expenses.where('orderId').equals(o.id).toArray();
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ amountFils: 30000, method: 'cash', id: it.outsource?.expenseId });
    const cat = await db.expenseCategories.get(expenses[0].categoryId);
    expect(cat?.code).toBe('subcontract');
    // The board's Today list: work outside due back — gone once it is back.
    await setOutsource(paint.id, { ...it.outsource!, state: 'out', dueAt: dubaiDate() });
    const b = (await loadOrderBundle(o.id))!;
    expect(tasksFor([b], undefined).map((t) => t.kind)).toContain('outsource');
  });
});

describe('paid to the owner (the manager took no money)', () => {
  it('closes the job, owes nothing, nothing in the cash or the money book, the revenue stays', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Engine overhaul', unitPriceFils: 200000 });
    await approveAll(o.id);
    const { quickInvoice } = await import('./money');
    const { closeUnpaid } = await import('./flow');
    const { jobProfit } = await import('../domain/profit');
    const doc = await quickInvoice(o.id);
    const cashBefore = await db.cashMovements.count();
    await closeUnpaid(o.id, 'owner');
    const b = (await loadOrderBundle(o.id))!;
    expect(b.order).toMatchObject({ stage: 'closed', outcome: 'completed', waived: { fils: doc.totalFils, via: 'owner' } });
    expect(b.payments).toHaveLength(0);
    expect(await db.cashMovements.count()).toBe(cashBefore);
    expect(b.events.find((e) => e.type === 'closed_owner')?.payload).toEqual({ fils: doc.totalFils });
    expect(b.events.some((e) => e.type === 'closed_unpaid')).toBe(false);
    const { bundleAmountDue } = await import('./orders');
    expect(bundleAmountDue(b)).toBe(0);
    // The garage's revenue all the same (let go — it would be cut).
    expect(jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses: [] }).revenue).toBe(doc.subtotalFils);
    expect(jobProfit({ order: { waived: { at: '', fils: doc.totalFils } }, items: b.items, invoices: b.invoices, expenses: [] }).revenue).toBe(0);
  });
});

describe('suppliers from a list', () => {
  it('adds the new ones from a CSV, leaves those already here', async () => {
    const csv = 'Name,Phone,Brands,Type\nAl Wasl Parts,050 123 4567,"Toyota, Lexus",New\nSharjah Used,055 999 8877,Nissan,Used\n';
    expect(await importSuppliers(new Blob([csv]))).toEqual({ added: 2, skipped: 0 });
    expect(await importSuppliers(new Blob([csv]))).toEqual({ added: 0, skipped: 2 });
    const s = (await db.suppliers.toArray()).find((x) => x.name === 'Al Wasl Parts')!;
    expect(s).toMatchObject({ phone: '+971501234567', makes: ['Toyota', 'Lexus'], condition: 'new' });
    await expect(importSuppliers(new Blob(['nothing useful']))).rejects.toThrow();
  });
});

describe('Today list from the jobs on the board', () => {
  it('a car promised for today and a part agreed but not ordered', async () => {
    const o = await job();
    await updateOrder(o.id, { promisedReadyAt: dubaiAt(dubaiDate(), 23, 59) });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads', unitPriceFils: 18000 });
    await approveAll(o.id);
    const b = (await loadOrderBundle(o.id))!;
    expect(tasksFor([b], undefined, nowIso()).map((t) => t.kind).sort()).toEqual(['order', 'promised']);
  });
});

describe('messages of v0.7', () => {
  const ctx = (name = 'Musa Khan') => ({ customer: { name } as Customer, vehicle: { make: 'Nissan', model: 'Sunny', year: 2019, plate: { emirate: 'DXB', code: 'A', number: '12345' } } as Vehicle, order: { number: 7, complaint: 'Brake noise' } as Order, garageName: 'Rukn ZamZam' });
  it('a customer without a name gets a proper greeting', () => {
    expect(tidy('Hello , this is G.')).toBe('Hello , this is G.');
    expect(tidy('Hello !')).toBe('Hello!');
    expect(tidy(', your Sunny is ready!')).toBe('Your Sunny is ready!');
    expect(simpleMessage('carReady', ctx(''), 'ru', { amount: '100 AED' })).toMatch(/^Ваш Nissan Sunny/);
    expect(simpleMessage('followUp', ctx(''), 'en')).toMatch(/^Hello! This is Rukn ZamZam\./);
  });
  it('request to a seller, options for the customer, the work report, the mechanic task', () => {
    expect(partRequestText({ make: 'Toyota', model: 'Camry', year: 2018, vin: 'JT123' }, { titleEn: 'Headlight LH', partNumber: '81150-06B20', qty: 1 })).toBe(
      'Toyota Camry 2018\nVIN: JT123\n\nPart: Headlight LH\nPart No: 81150-06B20\n\nPrice and availability, please: original / aftermarket / used?',
    );
    const opts = optionsText(ctx(), 'en', 'Front brake pads', [
      { kind: 'oem', gross: 47250, days: 2 },
      { kind: 'aftermarket', gross: 29400, days: 0 },
    ]);
    expect(opts).toContain('1) Original — 472.50 AED, in 2 days\n2) Aftermarket — 294.00 AED, today');
    const rep = reportText(ctx(), 'ru', { done: ['Замена масла'], checks: ['Тест-драйв'], mileageKm: 87450, warrantyMonths: 3, warrantyKm: 5000 });
    expect(rep).toContain('✓ Замена масла');
    expect(rep).toContain('Гарантия на работу: 3 месяца / 5');
    expect(mechanicText(ctx().vehicle, ctx().order, [{ title: 'Oil change', who: 'Raju' }], ['pads at 2 mm'])).toBe(
      '#7 Nissan Sunny 2019 · ' + mechanicText(ctx().vehicle, ctx().order, [], []).split(' · ')[1].split('\n')[0] + '\nComplaint: Brake noise\n\nTo do:\n1. Oil change — Raju\n\nNotes:\n- pads at 2 mm',
    );
  });
  it('the estimate says the parts are ordered after an advance (from the garage threshold)', () => {
    const line = (title: string, gross: number, kind: SnapshotItem['kind']): SnapshotItem => ({ itemId: title, kind, block: 'A', title, qty: 1, unit: 'pcs', net: gross, vat: 0, gross });
    const v = { number: 1, language: 'en', items: [line('Clutch kit', 120000, 'part'), line('Labour', 90000, 'labor')], fixedGross: 210000, maxGross: 210000, recommendedGross: 0, validUntil: '2026-11-17T08:00:00.000Z' } as EstimateVersion;
    expect(versionMessage({ ...ctx(), partsAdvanceFrom: 30000 }, v)).toContain('We order the parts after an advance of 1,200.00 AED.');
    expect(versionMessage({ ...ctx(), partsAdvanceFrom: 200000 }, v)).not.toContain('advance');
  });
});
