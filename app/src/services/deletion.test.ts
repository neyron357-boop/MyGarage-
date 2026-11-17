import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, ImmutableError, setDb, uid } from '../db/db';
import { AppError } from './errors';
import { addItem } from './estimate';
import { addInspectionPhoto, getOrCreateInspection } from './inspections';
import { addMedia } from './media';
import { addPayment, addExpense, cashState, closeCashDay, quickInvoice } from './money';
import { checkIn, deleteJob, jobDeleteBlock, jobHolds, loadOrderBundle, restoreJob } from './orders';
import { ensureSeed } from './seed';

const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, Math.random() * 255])], { type: 'image/png' });

async function job(number: string) {
  return checkIn({ plate: { emirate: 'DXB', code: 'Q', number }, make: 'Honda', model: 'Civic', name: '', phone: '', docLanguage: 'en', complaint: 'Brake noise', arrivedNow: true });
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('deleting a job', () => {
  it('a job without documents and money goes whole, the car stays, and Undo brings it all back', async () => {
    const o = await job('41544');
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads', unitPriceFils: 12000 });
    const insp = await getOrCreateInspection(o.id, 'intake');
    await addInspectionPhoto(insp.id, 'front', png());
    const cat = (await db.expenseCategories.toArray())[0];
    const exp = await addExpense({ date: new Date().toISOString().slice(0, 10), categoryId: cat.id, amountFils: 5000, method: 'cash', vatFils: 0, orderId: o.id });
    expect(await jobDeleteBlock(o.id)).toBeUndefined();

    const gone = await deleteJob(o.id);
    expect(await db.orders.get(o.id)).toBeUndefined();
    expect(await db.events.where('orderId').equals(o.id).count()).toBe(0);
    expect(await db.items.where('orderId').equals(o.id).count()).toBe(0);
    expect(await db.inspections.where('orderId').equals(o.id).count()).toBe(0);
    expect(await db.media.where('ownerId').equals(insp.id).count()).toBe(0);
    expect(await db.vehicles.get(o.vehicleId)).toBeDefined();
    // The money spent stays in the book, only unlinked from the deleted job.
    expect((await db.expenses.get(exp.id))?.orderId).toBeUndefined();

    await restoreJob(gone);
    const b = (await loadOrderBundle(o.id))!;
    expect(b.order.number).toBe(o.number);
    expect(b.items).toHaveLength(1);
    expect(b.media.filter((m) => m.slot === 'front')).toHaveLength(1);
    expect(b.events.length).toBeGreaterThan(0);
    expect((await db.expenses.get(exp.id))?.orderId).toBe(o.id);
  });

  it('a job with an invoice stays; its journal is still protected', async () => {
    const o = await job('41545');
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await quickInvoice(o.id);
    expect(await jobDeleteBlock(o.id)).toBe('invoice');
    await expect(deleteJob(o.id)).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'order.deleteBlock.invoice');
    expect(await db.orders.get(o.id)).toBeDefined();
    const ev = (await db.events.where('orderId').equals(o.id).first())!;
    await expect(db.events.delete(ev.id)).rejects.toBeInstanceOf(ImmutableError);
  });

  it('v0.38: confirmed, a job goes with its invoice and money — the cash box and its closing follow; Undo brings it all back', async () => {
    const o = await job('41546');
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const inv = await quickInvoice(o.id);
    const pdf = await addMedia({ ownerType: 'invoice', ownerId: inv.id, slot: 'document_pdf', file: png(), kind: 'pdf', compress: false, locked: true });
    const pay = await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: inv.totalFils });
    const closing = await closeCashDay((await cashState()).expected);
    expect(closing.actualFils).toBe(inv.totalFils);

    const h = await jobHolds(o.id);
    expect(h.holds).toEqual(['invoice', 'payment', 'sent']);
    expect(h.invoices).toEqual([inv.number]);
    expect(h.paidFils).toBe(inv.totalFils);

    const gone = await deleteJob(o.id, { withRecords: true });
    expect(await db.orders.get(o.id)).toBeUndefined();
    expect(await db.invoices.get(inv.id)).toBeUndefined();
    expect(await db.payments.get(pay.id)).toBeUndefined();
    expect(await db.media.get(pdf.id)).toBeUndefined();
    expect(await db.cashMovements.filter((m) => m.paymentId === pay.id).count()).toBe(0);
    expect(await db.events.where('orderId').equals(o.id).count()).toBe(0);
    // The counted cash stays as counted: the day's difference shows the money that left the book.
    const c = (await db.cashClosings.get(closing.id))!;
    expect(c.actualFils).toBe(inv.totalFils);
    expect(c.expectedFils).toBe(0);
    // Still guarded outside such a deletion.
    const other = await job('41547');
    await addItem(other.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const inv2 = await quickInvoice(other.id);
    await expect(db.invoices.delete(inv2.id)).rejects.toBeInstanceOf(ImmutableError);

    await restoreJob(gone);
    expect(await db.orders.get(o.id)).toBeDefined();
    expect((await db.invoices.get(inv.id))?.number).toBe(inv.number);
    expect(await db.payments.get(pay.id)).toBeDefined();
    expect(await db.media.get(pdf.id)).toBeDefined();
    expect(await db.cashMovements.filter((m) => m.paymentId === pay.id).count()).toBe(1);
    expect((await db.cashClosings.get(closing.id))!.expectedFils).toBe(inv.totalFils);
  });
});
