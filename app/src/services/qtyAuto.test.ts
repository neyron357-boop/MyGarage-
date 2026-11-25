import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { qtyShort } from '../domain/sides';
import { addItem, updateItem } from './estimate';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

const job = () =>
  checkIn({ plate: { emirate: 'DXB', code: 'L', number: String(10000 + Math.floor(Math.random() * 89999)) }, make: 'Toyota', model: 'Corolla', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('the quantity a part’s name says, put by itself (v0.85)', () => {
  it('«LINK ROD LEFT AND RIGHT» is two at once — no question left on the line', async () => {
    const o = await job();
    const rod = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Link rod left and right', unitPriceFils: 5000 });
    expect(rod.qty).toBe(2);
    expect(qtyShort((await db.items.get(rod.id))!)).toBeUndefined();
    // A side alone, a set, work: as they are.
    expect((await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Link rod LH', unitPriceFils: 5000 })).qty).toBe(1);
    expect((await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Replace link rod left and right', unitPriceFils: 5000 })).qty).toBe(1);
  });

  it('a draft renamed to both sides becomes two; the quantity typed less by hand is the price for both — nothing to warn about', async () => {
    const o = await job();
    const pad = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Mirror glass', unitPriceFils: 3000 });
    await updateItem(pad.id, { titleEn: 'Mirror glass L+R', qty: 1 });
    expect((await db.items.get(pad.id))!.qty).toBe(2);
    await updateItem(pad.id, { qty: 1 });
    const back = (await db.items.get(pad.id))!;
    expect([back.qty, back.qtyNoted]).toEqual([1, 2]);
    expect(qtyShort(back)).toBeUndefined();
  });
});
