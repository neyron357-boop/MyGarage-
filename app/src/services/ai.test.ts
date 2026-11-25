import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { aiAfterPart, aiFixPartName, aiReadVin, aiWorking, onAiNotice, setAiTransport, type AiNotice } from './ai';
import { updateVehicle } from './customers';
import { addItem } from './estimate';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

const VIN = 'JTDBR42E39J016456';
let asked: { path: string; body: Record<string, unknown> }[] = [];
let answers: Record<string, unknown> = {};
const notices: AiNotice[] = [];
let stop: () => void;

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
  asked = [];
  notices.length = 0;
  answers = {
    vin: { vin: VIN, make: 'TOYOTA', model: 'Corolla', year: 2009, engine: '1.8L 4-cyl', body: 'sedan', confidence: 0.9 },
    'part-name': { fixed: 'колодки тормозные передние', english: 'FRONT BRAKE PADS', isPart: true, confidence: 0.95 },
  };
  setAiTransport(async (path, body) => {
    asked.push({ path, body: body as Record<string, unknown> });
    return answers[path];
  });
  stop = onAiNotice((n) => notices.push(n));
});
afterEach(() => {
  setAiTransport(undefined);
  stop();
});

async function car(make = '', model = '') {
  const o = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: String(10000 + Math.floor(Math.random() * 89999)) }, make, model, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
  return o;
}
const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 50 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('the AI reads a VIN put in the card', () => {
  it('fills what is empty, once a VIN; «Отменить» takes back what it wrote', async () => {
    const o = await car('Toyota');
    // Typed in the car's card: asked by itself, not waited for.
    await updateVehicle(o.vehicleId, { vin: VIN.toLowerCase() });
    await until(async () => !!(await db.vehicles.get(o.vehicleId))?.vinAi);
    const v = (await db.vehicles.get(o.vehicleId))!;
    expect([v.make, v.model, v.year, v.engine, v.type]).toEqual(['Toyota', 'Corolla', 2009, '1.8L 4-cyl', 'sedan']);
    expect(v.vinAi).toMatchObject({ vin: VIN, filled: ['model', 'year', 'engine', 'type'] });
    expect(asked).toEqual([{ path: 'vin', body: { vin: VIN } }]);
    // The same VIN is not asked about again.
    expect(await aiReadVin(o.vehicleId)).toBeUndefined();
    expect(asked).toHaveLength(1);
    // «Отменить»: what is still as the AI wrote it goes; the year typed since stays.
    await updateVehicle(o.vehicleId, { year: 2010 });
    const n = notices.find((x) => x.kind === 'car')!;
    await n.undo();
    const back = (await db.vehicles.get(o.vehicleId))!;
    expect([back.make, back.model, back.year, back.engine, back.type]).toEqual(['Toyota', '', 2010, undefined, undefined]);
  });

  it('a card with everything already is not asked about', async () => {
    const o = await car('Toyota', 'Corolla');
    await updateVehicle(o.vehicleId, { year: 2009, engine: '1.8L 4-cyl', type: 'sedan' });
    await updateVehicle(o.vehicleId, { vin: VIN });
    await until(async () => !!(await db.vehicles.get(o.vehicleId))?.vinAi);
    expect(asked).toHaveLength(0);
    expect((await db.vehicles.get(o.vehicleId))!.vinAi).toMatchObject({ vin: VIN, filled: [] });
  });

  it('without the garage’s server (or its key, or a network): nothing happens, quietly', async () => {
    const o = await car();
    setAiTransport(async () => {
      throw new Error('ai off');
    });
    await updateVehicle(o.vehicleId, { vin: VIN });
    expect(await aiReadVin(o.vehicleId)).toBeUndefined();
    const v = (await db.vehicles.get(o.vehicleId))!;
    expect([v.model, v.vinAi]).toEqual(['', undefined]);
  });
});

describe('the AI looks at a part', () => {
  it('its name by the dictionary, no AI: the typing mistakes put right and its English name; «Отменить» brings the name as typed', async () => {
    const o = await car('Toyota', 'Corolla');
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'колодки тормазные передние', qty: 1, unitPriceFils: 0 });
    expect(await aiFixPartName(it1.id)).toBe(true);
    expect(asked).toHaveLength(0);
    let i = (await db.items.get(it1.id))!;
    expect([i.titleRu, i.titleEn]).toEqual(['КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', 'FRONT BRAKE PADS']);
    // Not asked again about the name it gave.
    expect(await aiFixPartName(it1.id)).toBe(false);
    await notices.find((x) => x.kind === 'name')!.undo();
    i = (await db.items.get(it1.id))!;
    expect([i.titleRu, i.titleEn]).toEqual(['КОЛОДКИ ТОРМАЗНЫЕ ПЕРЕДНИЕ', undefined]);
    // …nor about the name brought back.
    expect(await aiFixPartName(it1.id)).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it('a name the dictionary does not know goes to the AI; a line typed the same later takes that answer without asking', async () => {
    const o = await car('Toyota', 'Corolla');
    answers['part-name'] = { fixed: 'флюгер карбюратора', english: 'CARBURETTOR VANE', isPart: true, confidence: 0.9 };
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'флюгер карбюратора', qty: 1, unitPriceFils: 0 });
    expect(await aiFixPartName(it1.id)).toBe(true);
    expect(asked).toEqual([{ path: 'part-name', body: { name: 'ФЛЮГЕР КАРБЮРАТОРА', make: 'Toyota', model: 'Corolla', year: '' } }]);
    expect((await db.items.get(it1.id))!.titleEn).toBe('CARBURETTOR VANE');
    const it2 = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'флюгер карбюратора', qty: 1, unitPriceFils: 0 });
    expect(await aiFixPartName(it2.id)).toBe(true);
    expect((await db.items.get(it2.id))!.titleEn).toBe('CARBURETTOR VANE');
    expect(asked).toHaveLength(1);
  });

  it('a line sent to the customer keeps its words', async () => {
    const o = await car();
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'alternater', qty: 1, unitPriceFils: 0 });
    await db.items.update(it1.id, { approvalState: 'approved' });
    expect(await aiFixPartName(it1.id)).toBe(false);
    expect(asked).toHaveLength(0);
  });


  it('a part saved: its name put right at once — and nothing else is asked (v0.85: the search for its number is gone)', async () => {
    const o = await car('Toyota', 'Corolla');
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'колодки тормазные передние', qty: 1, unitPriceFils: 0 });
    aiAfterPart(pads.id);
    await until(async () => !!(await db.items.get(pads.id))?.titleEn);
    await until(async () => !aiWorking(`name:${pads.id}`));
    await new Promise((r) => setTimeout(r, 30));
    const i = (await db.items.get(pads.id))!;
    expect([i.titleRu, i.titleEn, i.partNumber, i.aiFind, i.diagramIds, i.sampleIds]).toEqual(['КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', 'FRONT BRAKE PADS', undefined, undefined, undefined, undefined]);
    expect(asked.map((a) => a.path).filter((p) => p !== 'part-name')).toEqual([]);
  });
});

describe('v0.86: every line’s name, the labour charge said by the parts', () => {
  it('a work line’s name is put right too (not only a part’s)', async () => {
    const o = await car('Toyota', 'Corolla');
    answers['part-name'] = { fixed: 'WHEEL ALIGNMENT', english: 'WHEEL ALIGNMENT', isPart: true, confidence: 0.95 };
    const w = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'whel alignmnet', unitPriceFils: 10000 });
    expect(await aiFixPartName(w.id)).toBe(true);
    expect((await db.items.get(w.id))!.titleEn).toBe('WHEEL ALIGNMENT');
  });

  it('«LABOR CHARGE» says what is done with the parts; the parts changed — by the parts again, then said anew', async () => {
    const { aiLabourName } = await import('./ai');
    const o = await car('Toyota', 'Corolla');
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads', unitPriceFils: 20000 });
    const labour = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Labor charge', unitPriceFils: 15000 });
    expect((await db.items.get(labour.id))!.titleEn).toBe('LABOR CHARGE: FRONT BRAKE PADS');
    answers.labour = { text: 'REPLACE FRONT BRAKE PADS' };
    expect(await aiLabourName(o.id)).toBe(true);
    expect((await db.items.get(labour.id))!.titleEn).toBe('LABOR CHARGE: REPLACE FRONT BRAKE PADS');
    expect(asked.find((a) => a.path === 'labour')!.body).toMatchObject({ parts: ['FRONT BRAKE PADS'] });
    // The same parts: not asked again.
    const n = asked.length;
    expect(await aiLabourName(o.id)).toBe(false);
    expect(asked.length).toBe(n);
    // A part added: the parts' names at once, the AI's words for the new parts after.
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake discs', unitPriceFils: 30000 });
    expect((await db.items.get(labour.id))!.titleEn).toBe('LABOR CHARGE: FRONT BRAKE PADS, FRONT BRAKE DISCS');
    answers.labour = { text: 'REPLACE FRONT BRAKE PADS & DISCS' };
    await aiLabourName(o.id);
    expect((await db.items.get(labour.id))!.titleEn).toBe('LABOR CHARGE: REPLACE FRONT BRAKE PADS & DISCS');
  });
});
