import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, sendVersion } from './estimate';
import { checkIn } from './orders';
import { saveSupplier, setPartsBatch } from './parts';
import { ensureSeed } from './seed';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('parts picked on a job, set at once (v0.29)', () => {
  it('one supplier and one state for all the picked parts; work and the customer’s own part are left alone', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'A', number: '55555' }, make: 'Toyota', model: 'Camry', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads', unitPriceFils: 18000 });
    const discs = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake discs', unitPriceFils: 42000 });
    const own = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Wiper', unitPriceFils: 0, customerSupplied: true });
    const work = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake service', unitPriceFils: 15000 });
    // Sent to the customer: their supplier and state still change (neither is on the quote).
    await sendVersion(o.id, { via: 'whatsapp' });
    const s = await saveSupplier({ name: 'Al Quoz Auto Parts', phone: '04 333 4455' });
    const n = await setPartsBatch([pads.id, discs.id, own.id, work.id], { supplierId: s.id, status: 'ordered' });
    expect(n).toBe(2);
    const [a, b, c, d] = await db.items.bulkGet([pads.id, discs.id, own.id, work.id]);
    expect([a!.supplierId, a!.procurementStatus, b!.supplierId, b!.procurementStatus]).toEqual([s.id, 'ordered', s.id, 'ordered']);
    expect(a!.orderedAt).toBeDefined();
    expect([c!.supplierId, d!.supplierId]).toEqual([undefined, undefined]);
    // Only the state this time: the supplier stays.
    await setPartsBatch([pads.id], { status: 'received' });
    expect(await db.items.get(pads.id)).toMatchObject({ supplierId: s.id, procurementStatus: 'received' });
  });
});
