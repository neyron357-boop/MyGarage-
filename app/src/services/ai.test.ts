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

  it('v0.88: the garage’s own car of the same VIN answers first — a model the AI wrote and a person put right is learned; the AI adds only what is left, never another car’s engine', async () => {
    // A Toyota built in Indonesia, named «Land Cruiser» by the AI; the owner put it right: «Veloz».
    const first = await car('Toyota');
    answers.vin = { vin: 'MHFAB1BY4P3069309', make: 'Toyota', model: 'Land Cruiser', year: 2023, engine: '4.0L V6', body: 'suv', confidence: 0.9 };
    await updateVehicle(first.vehicleId, { vin: 'MHFAB1BY4P3069309' });
    await until(async () => !!(await db.vehicles.get(first.vehicleId))?.vinAi);
    expect((await db.vehicles.get(first.vehicleId))!.model).toBe('Land Cruiser');
    await updateVehicle(first.vehicleId, { model: 'Veloz', engine: '1.5L 4-cyl', type: 'mpv' });
    expect((await db.vehicles.get(first.vehicleId))!.vinAi!.filled).toEqual(['year']);
    // The next car of the same maker and model code: the garage's word; the AI asked for the year only — its «Land
    // Cruiser» engine and body are another car's.
    answers.vin = { vin: 'MHFAB1BY0R3011111', make: 'Toyota', model: 'Land Cruiser', year: 2024, engine: '4.0L V6', body: 'suv', confidence: 0.9 };
    notices.length = 0;
    const second = await car();
    await updateVehicle(second.vehicleId, { vin: 'MHFAB1BY0R3011111' });
    await until(async () => !!(await db.vehicles.get(second.vehicleId))?.vinAi);
    const v = (await db.vehicles.get(second.vehicleId))!;
    expect([v.make, v.model, v.year, v.engine, v.type]).toEqual(['Toyota', 'Veloz', 2024, '1.5L 4-cyl', 'mpv']);
    expect(v.vinAi?.filled).toEqual(['year']);
    // Without the AI at all: the garage's word alone, said as the garage's (not the AI's card).
    setAiTransport(async () => {
      throw new Error('ai off');
    });
    notices.length = 0;
    const third = await car();
    await updateVehicle(third.vehicleId, { vin: 'MHFAB1BY2R3022222' });
    await until(async () => !!(await db.vehicles.get(third.vehicleId))?.model);
    const w = (await db.vehicles.get(third.vehicleId))!;
    expect([w.make, w.model, w.engine, w.type]).toEqual(['Toyota', 'Veloz', '1.5L 4-cyl', 'mpv']);
    expect(notices.find((n) => n.kind === 'car')).toMatchObject({ from: 'garage' });
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

describe('v0.89: the car off its photo, then its VIN', () => {
  const VELOZ = 'MHFAB1BY4P3069309';
  const photo = () => new Blob([new Uint8Array(4000).fill(7)], { type: 'image/jpeg' });

  it('a car with no make: its photo looked at once — the card filled (said as the photo’s); the VIN says another model — the person is asked; chosen — the question goes', async () => {
    const { carPhotoLater, settleCarCheck } = await import('./carPhoto');
    answers.car = { isCar: true, make: 'TOYOTA', model: 'Land Cruiser', confidence: 0.8 };
    answers.vin = { vin: VELOZ, make: 'Toyota', model: 'Veloz', year: 2023, confidence: 0.9 };
    const o = await car();
    const file = photo();
    carPhotoLater(o.vehicleId, file);
    await until(async () => !!(await db.vehicles.get(o.vehicleId))?.photoAi);
    let v = (await db.vehicles.get(o.vehicleId))!;
    expect([v.make, v.model]).toEqual(['Toyota', 'Land Cruiser']);
    expect(notices.find((n) => n.kind === 'car')).toMatchObject({ from: 'photo', filled: { make: 'Toyota', model: 'Land Cruiser' } });
    const pic = asked.find((a) => a.path === 'car')!.body.image as { type: string; data: string };
    expect(pic.type).toBe('image/jpeg');
    // The same photo again: not asked again.
    carPhotoLater(o.vehicleId, file);
    await new Promise((r) => setTimeout(r, 30));
    expect(asked.filter((a) => a.path === 'car')).toHaveLength(1);
    // The VIN: the card is the photo's guess — the VIN's model is asked of the AI and held against it.
    await updateVehicle(o.vehicleId, { vin: VELOZ });
    await until(async () => !!(await db.vehicles.get(o.vehicleId))?.carCheck);
    v = (await db.vehicles.get(o.vehicleId))!;
    expect(v.carCheck).toMatchObject({ photo: { make: 'Toyota', model: 'Land Cruiser' }, vin: { make: 'Toyota', model: 'Veloz' } });
    // What the photo said stays in the card until a person chooses — the VIN does not write over it.
    expect(v.model).toBe('Land Cruiser');
    await settleCarCheck(o.vehicleId, { make: 'Toyota', model: 'Veloz' });
    v = (await db.vehicles.get(o.vehicleId))!;
    expect([v.make, v.model, v.carCheck]).toEqual(['Toyota', 'Veloz', undefined]);
  });

  it('the photo and the VIN say the same car: nothing asked — the photo is proven; a car with its make and model typed is not looked at', async () => {
    const { carPhotoLater } = await import('./carPhoto');
    answers.car = { isCar: true, make: 'Toyota', model: 'Veloz', confidence: 0.8 };
    answers.vin = { vin: VELOZ, make: 'Toyota', model: 'Veloz', year: 2023, confidence: 0.9 };
    const o = await car();
    carPhotoLater(o.vehicleId, photo());
    await until(async () => !!(await db.vehicles.get(o.vehicleId))?.photoAi);
    await updateVehicle(o.vehicleId, { vin: VELOZ });
    await until(async () => !!(await db.vehicles.get(o.vehicleId))?.photoAi?.checked);
    const v = (await db.vehicles.get(o.vehicleId))!;
    expect([v.model, v.photoAi?.checked, v.carCheck]).toEqual(['Veloz', true, undefined]);
    // Typed: no tokens on its photo.
    const typed = await car('Nissan', 'Patrol');
    const before = asked.length;
    carPhotoLater(typed.vehicleId, photo());
    await new Promise((r) => setTimeout(r, 30));
    expect(asked.length).toBe(before);
  });

  it('a person writing the make or model answers the question', async () => {
    const { askCarCheck } = await import('./carPhoto');
    const o = await car('Toyota', 'Land Cruiser');
    await askCarCheck(o.vehicleId, { photo: { make: 'Toyota', model: 'Land Cruiser' }, vin: { make: 'Toyota', model: 'Veloz' } });
    await updateVehicle(o.vehicleId, { color: 'white' });
    expect((await db.vehicles.get(o.vehicleId))!.carCheck).toBeDefined();
    await updateVehicle(o.vehicleId, { model: 'Veloz' });
    expect((await db.vehicles.get(o.vehicleId))!.carCheck).toBeUndefined();
  });
});
