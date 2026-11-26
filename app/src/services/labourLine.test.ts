import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { byPosition } from '../domain/items';
import { addItem, ensureLabourLine, updateItem } from './estimate';
import { removeLines, setUnconfirmed } from './flow';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

/*
 * v0.90, the owner's note #70: the labour charge comes by itself with a job's first part, stays last of the lines, is named
 * by the parts and priced by the garage's history while nobody typed its price; taken off by hand — not again.
 */

async function job(make = 'Nissan', model = 'Altima') {
  return checkIn({ plate: { emirate: 'DXB', code: 'V', number: String(Math.floor(Math.random() * 90000) + 10000) }, make, model, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
}
const lines = async (orderId: string) => (await db.items.where('orderId').equals(orderId).toArray()).sort(byPosition);
const charge = async (orderId: string) => (await lines(orderId)).find((i) => i.kind === 'labor');

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('the labour charge by itself (v0.90, #70)', () => {
  it('comes with the first part, once, last of the lines, named by the parts', async () => {
    const o = await job();
    expect(await ensureLabourLine(o.id)).toBeUndefined();
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Engine mount' });
    const added = await ensureLabourLine(o.id);
    expect(added?.autoLabour).toBe(true);
    expect(await ensureLabourLine(o.id)).toBeUndefined();
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Gear oil' });
    await ensureLabourLine(o.id);
    const all = await lines(o.id);
    expect(all.map((i) => i.titleEn)).toEqual(['ENGINE MOUNT', 'GEAR OIL', 'LABOUR CHARGES: ENGINE MOUNT, GEAR OIL']);
    // Without a history — no price: «+ Цена».
    expect(all[2].unitPriceFils).toBe(0);
  });

  it('a labour charge of the job already — none added; a job with no parts — none', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Labor charge', unitPriceFils: 20_000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Alternator' });
    expect(await ensureLabourLine(o.id)).toBeUndefined();
    const p = await job();
    await addItem(p.id, { kind: 'labor', block: 'A', titleEn: 'Wheel alignment', unitPriceFils: 10_000 });
    expect(await ensureLabourLine(p.id)).toBeUndefined();
  });

  it('priced by the history: the same work before; the parts one by one; a price typed by hand stays', async () => {
    // The garage's history: an engine mount for 300 + VAT, brake pads for 100.
    const a = await job('Toyota', 'Corolla');
    await addItem(a.id, { kind: 'part', block: 'A', titleEn: 'ENGINE MOUNT AFTERMARKET', unitPriceFils: 40_000 });
    await addItem(a.id, { kind: 'labor', block: 'A', titleEn: 'LABOUR CHARGES', unitPriceFils: 30_000, unitGrossFils: 31_500 });
    const b = await job('Toyota', 'Corolla');
    await addItem(b.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', unitPriceFils: 18_000 });
    await addItem(b.id, { kind: 'labor', block: 'A', titleEn: 'LABOUR CHARGES', unitPriceFils: 10_000 });

    const o = await job();
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Engine mount full set original' });
    await ensureLabourLine(o.id);
    let c = (await charge(o.id))!;
    expect([c.unitPriceFils, c.unitGrossFils, c.labourGuess?.basis]).toEqual([30_000, 31_500, 'same']);
    // Another part: the price follows (each part's labour) — still the history's.
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads' });
    c = (await charge(o.id))!;
    expect(c.labourGuess?.basis).toBe('parts');
    expect(c.unitPriceFils).toBe(c.labourGuess?.fils);
    expect(c.unitPriceFils).toBeGreaterThan(30_000);
    // Typed by hand: it stays when the parts change.
    await updateItem(c.id, { unitPriceFils: 50_000, unitGrossFils: undefined });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Engine mount bolt' });
    expect((await charge(o.id))!.unitPriceFils).toBe(50_000);
  });

  it('taken off by hand — not added again; its own, untouched, goes with the last part', async () => {
    const o = await job();
    const part = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Radiator' });
    await ensureLabourLine(o.id);
    // The parts gone (or not confirmed): the app's own labour charge goes too.
    await setUnconfirmed([part.id], true);
    expect(await charge(o.id)).toBeUndefined();
    await setUnconfirmed([part.id], false);
    await ensureLabourLine(o.id);
    const c = (await charge(o.id))!;
    await removeLines([c.id]);
    expect((await db.orders.get(o.id))?.labourOff).toBe(true);
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Radiator hose' });
    expect(await ensureLabourLine(o.id)).toBeUndefined();
    expect(await charge(o.id)).toBeUndefined();
  });

  it('work of the job’s own carries the labour: none added beside it; the app’s own goes when such work comes', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 8_000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Oil filter' });
    expect(await ensureLabourLine(o.id)).toBeUndefined();
    const p = await job();
    await addItem(p.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads' });
    expect((await ensureLabourLine(p.id))?.autoLabour).toBe(true);
    await addItem(p.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 12_000 });
    expect(await charge(p.id)).toMatchObject({ titleEn: 'FRONT BRAKE PADS REPLACEMENT' });
    expect((await lines(p.id)).some((i) => i.autoLabour)).toBe(false);
  });

  it('a labour charge put first by hand goes last as lines are added', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Labour charges', unitPriceFils: 15_000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Water pump' });
    await ensureLabourLine(o.id);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wheel alignment', unitPriceFils: 8_000 });
    // A document carried over keeps the paper's order: only a line added by hand puts it last.
    expect((await lines(o.id)).map((i) => i.titleEn)).toEqual(['WATER PUMP', 'LABOUR CHARGES: WATER PUMP', 'WHEEL ALIGNMENT']);
    await ensureLabourLine(o.id);
    expect((await lines(o.id)).map((i) => i.titleEn)).toEqual(['WATER PUMP', 'WHEEL ALIGNMENT', 'LABOUR CHARGES: WATER PUMP']);
  });
});
