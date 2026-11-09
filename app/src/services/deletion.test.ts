import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, ImmutableError, setDb, uid } from '../db/db';
import { AppError } from './errors';
import { addItem } from './estimate';
import { addInspectionPhoto, getOrCreateInspection } from './inspections';
import { addExpense, quickInvoice } from './money';
import { checkIn, deleteJob, jobDeleteBlock, loadOrderBundle, restoreJob } from './orders';
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
});
