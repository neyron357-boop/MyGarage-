import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, updateItem } from './estimate';
import { removeLines } from './flow';
import { checkIn } from './orders';
import { fillPriceBook, loadPriceBook, priceHintsFor } from './priceBook';
import { ensureSeed } from './seed';

/* The price book (v0.91.7): every supplier's price kept with its car — made-up jobs and suppliers only. */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  globalThis.localStorage?.removeItem('mygarage.priceBook.filled');
});

const job = (model = 'Camry') =>
  checkIn({ plate: { emirate: 'DXB', code: 'A', number: String(10000 + Math.floor(Math.random() * 80000)) }, make: 'Toyota', model, name: 'Sam', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true, vin: 'JTNB11HK103456789' } as never);

describe('the price book', () => {
  it('a line’s offers go into it with the car; said again the same — once; the line gone — the prices stay; the next job’s line sees them', async () => {
    const o = await job();
    const sup = (await db.suppliers.add({ id: uid(), name: 'Noor Parts', phone: '+971507776655', createdAt: new Date().toISOString() } as never)) as string;
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads', qty: 1, unitPriceFils: 0 });
    const offers = [
      { id: 'wa:m1:0:0', kind: 'oem' as const, costFils: 18000, supplierId: sup, msg: 'M1' },
      { id: 'wa:m1:0:1', kind: 'aftermarket' as const, costFils: 9500, supplierId: sup, msg: 'M1', brand: 'TRW' },
    ];
    await updateItem(pads.id, { offers });
    let book = await db.priceBook.toArray();
    expect(book.map((p) => [p.part, p.costFils, p.kind, p.make, p.model, p.vin, p.via])).toEqual([
      ['FRONT BRAKE PADS', 18000, 'oem', 'Toyota', 'Camry', 'JTNB11HK103456789', 'wa'],
      ['FRONT BRAKE PADS', 9500, 'aftermarket', 'Toyota', 'Camry', 'JTNB11HK103456789', 'wa'],
    ]);
    const at = book[0].updatedAt;
    await updateItem(pads.id, { offers, qty: 1 });
    expect((await db.priceBook.get('wa:m1:0:0'))!.updatedAt).toBe(at);
    await removeLines([pads.id]);
    expect(await db.priceBook.count()).toBe(2);
    const view = await loadPriceBook();
    expect(view.groups.map((g) => [g.part, g.best?.costFils])).toEqual([['FRONT BRAKE PADS', 9500]]);
    // Another Camry's pads: the prices said before, at once.
    const o2 = await job();
    const pads2 = await addItem(o2.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    const h = await priceHintsFor(pads2.id);
    expect(h.hints.map((x) => [x.point.costFils, x.near])).toEqual([
      [18000, 3],
      [9500, 3],
    ]);
    expect(h.suppliers.get(sup)?.name).toBe('Noor Parts');
  });

  it('the offers on the lines before the book — put in it once', async () => {
    const o = await job();
    const sup = (await db.suppliers.add({ id: uid(), name: 'Noor Parts', phone: '+971507776655', createdAt: new Date().toISOString() } as never)) as string;
    const f = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'OIL FILTER', qty: 1, unitPriceFils: 0 });
    await db.items.update(f.id, { offers: [{ id: 'old1', kind: 'oem', costFils: 2500, supplierId: sup }] });
    expect(await db.priceBook.count()).toBe(0);
    expect(await fillPriceBook()).toBe(1);
    expect(await fillPriceBook()).toBe(0);
    expect((await db.priceBook.get('old1'))!.via).toBe('hand');
  });
});
