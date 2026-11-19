import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { aiFindPart, aiFixPartName, aiReadVin, onAiNotice, setAiTransport, type AiNotice } from './ai';
import { updateVehicle } from './customers';
import { addItem, updateItem } from './estimate';
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
    'part-find': {
      search: 'web',
      numbers: [
        { number: '04465-12610', brand: 'Toyota', seen: ['https://www.amayama.com/p/1', 'https://megazip.net/p/2'] },
        { number: '04465-02220', brand: 'Toyota', seen: [] },
      ],
      images: [
        { type: 'image/png', data: btoa('x'.repeat(9000)), source: 'https://www.amayama.com/p/1', number: '04465-12610', kind: 'diagram' },
        { type: 'image/jpeg', data: btoa('y'.repeat(9000)), source: 'https://www.rockauto.com/p/2', kind: 'photo' },
      ],
    },
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
  it('its name: the typing mistakes put right and its English name; «Отменить» brings the name as typed', async () => {
    const o = await car('Toyota', 'Corolla');
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'колодки тормазные передние', qty: 1, unitPriceFils: 0 });
    expect(await aiFixPartName(it1.id)).toBe(true);
    expect(asked[0]).toEqual({ path: 'part-name', body: { name: 'КОЛОДКИ ТОРМАЗНЫЕ ПЕРЕДНИЕ', make: 'Toyota', model: 'Corolla', year: '' } });
    let i = (await db.items.get(it1.id))!;
    expect([i.titleRu, i.titleEn]).toEqual(['КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', 'FRONT BRAKE PADS']);
    // Not asked again about the name it gave.
    expect(await aiFixPartName(it1.id)).toBe(false);
    await notices.find((x) => x.kind === 'name')!.undo();
    i = (await db.items.get(it1.id))!;
    expect([i.titleRu, i.titleEn]).toEqual(['КОЛОДКИ ТОРМАЗНЫЕ ПЕРЕДНИЕ', undefined]);
    // …nor about the name brought back.
    expect(await aiFixPartName(it1.id)).toBe(false);
    expect(asked.filter((a) => a.path === 'part-name')).toHaveLength(1);
  });

  it('a line sent to the customer keeps its words', async () => {
    const o = await car();
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'alternater', qty: 1, unitPriceFils: 0 });
    await db.items.update(it1.id, { approvalState: 'approved' });
    expect(await aiFixPartName(it1.id)).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it('its number: one seen in two catalogues written itself, the others offered; the diagram kept with the line', async () => {
    const o = await car('Toyota', 'Corolla');
    await updateVehicle(o.vehicleId, { vin: VIN, year: 2009 });
    asked = [];
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    await aiFindPart(it1.id);
    expect(asked.find((a) => a.path === 'part-find')?.body).toMatchObject({ part: 'FRONT BRAKE PADS', make: 'Toyota', model: 'Corolla', year: 2009, vin: VIN });
    const i = (await db.items.get(it1.id))!;
    expect(i.partNumber).toBe('04465-12610');
    expect(i.aiFind).toMatchObject({ search: 'web', part: 'FRONT BRAKE PADS', filled: '04465-12610' });
    expect(i.aiFind!.numbers.map((n) => n.number)).toEqual(['04465-12610', '04465-02220']);
    // The diagram: a picture of the line's own, not one of its photos (those go with a quote).
    expect(i.diagramIds).toHaveLength(1);
    expect(i.mediaIds).toBeUndefined();
    expect((await db.media.get(i.diagramIds![0]))?.slot).toBe('diagram');
    // A photo of the part itself — a sample, kept apart from the diagram and from the line's own photos.
    expect(i.sampleIds).toHaveLength(1);
    expect((await db.media.get(i.sampleIds![0]))?.slot).toBe('sample');
    // Looked up again: the new pictures take the place of the earlier ones.
    const old = [...i.diagramIds!, ...i.sampleIds!];
    await aiFindPart(it1.id, { again: true });
    const j = (await db.items.get(it1.id))!;
    expect([j.diagramIds!.length, j.sampleIds!.length]).toEqual([1, 1]);
    for (const id of old) expect(await db.media.get(id)).toBeUndefined();
    // Not looked up again; «Отменить» takes the number off.
    expect(await aiFindPart(it1.id)).toBeUndefined();
    await notices.find((x) => x.kind === 'number')!.undo();
    expect((await db.items.get(it1.id))!.partNumber).toBeUndefined();
  });

  it('a guess made without the web is looked up again; a find on the web is not', async () => {
    const o = await car('Toyota', 'Corolla');
    answers['part-find'] = { search: 'model', numbers: [{ number: '04465-02220', seen: [] }], images: [] };
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'BRAKE PADS', qty: 1, unitPriceFils: 0 });
    await aiFindPart(it1.id);
    // The paid plan on since: the same line, saved again, goes to the catalogues.
    answers['part-find'] = { search: 'web', numbers: [{ number: '04465-02220', seen: ['https://a.com/1', 'https://b.com/2'] }], images: [] };
    await aiFindPart(it1.id);
    expect((await db.items.get(it1.id))!.aiFind?.search).toBe('web');
    expect(await aiFindPart(it1.id)).toBeUndefined();
    expect(asked.filter((a) => a.path === 'part-find')).toHaveLength(2);
  });

  it('a number not proven is only offered; a new name is looked up again', async () => {
    const o = await car('Toyota', 'Corolla');
    answers['part-find'] = { search: 'model', numbers: [{ number: '04465-02220', seen: [] }], images: [] };
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'BRAKE PADS', qty: 1, unitPriceFils: 0 });
    await aiFindPart(it1.id);
    expect((await db.items.get(it1.id))!.partNumber).toBeUndefined();
    expect(notices.some((n) => n.kind === 'number')).toBe(false);
    await updateItem(it1.id, { titleEn: 'REAR BRAKE PADS' });
    await aiFindPart(it1.id);
    expect(asked.filter((a) => a.path === 'part-find').map((a) => a.body.part)).toEqual(['BRAKE PADS', 'REAR BRAKE PADS']);
    // A number typed by hand: not looked up, unless asked (✦).
    await updateItem(it1.id, { titleEn: 'OIL FILTER', partNumber: '90915-YZZE1' });
    expect(await aiFindPart(it1.id)).toBeUndefined();
    await aiFindPart(it1.id, { again: true });
    expect((await db.items.get(it1.id))!.partNumber).toBe('90915-YZZE1');
  });
});
