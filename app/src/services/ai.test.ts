import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { aiAfterPart, aiAllParts, aiFindPart, aiFixPartName, aiReadVin, aiWorking, onAiNotice, setAiTransport, type AiNotice } from './ai';
import { updateVehicle } from './customers';
import { addItem, updateItem } from './estimate';
import { addMedia } from './media';
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

  it('its number from the garage’s own jobs, no AI: fitted before on this car — written at once, with that line’s pictures', async () => {
    const first = await car('Toyota', 'Corolla');
    await updateVehicle(first.vehicleId, { year: 2018, engine: '1.8L' });
    const done = await addItem(first.id, { kind: 'part', block: 'A', titleEn: 'OIL FILTER', qty: 1, unitPriceFils: 0, partNumber: '90915-YZZE1' });
    const pic = await addMedia({ ownerType: 'item', ownerId: done.id, slot: 'diagram', file: new Blob([new Uint8Array(9000)], { type: 'image/png' }), name: 'https://www.amayama.com/p/1', compress: false });
    await db.items.update(done.id, { procurementStatus: 'received', diagramIds: [pic.id] });
    // The same model two years on, the engine the same: the same part.
    const next = await car('Toyota', 'Corolla');
    await updateVehicle(next.vehicleId, { year: 2020, engine: '1.8L' });
    const it1 = await addItem(next.id, { kind: 'part', block: 'A', titleRu: 'масляный фильтр', qty: 1, unitPriceFils: 0 });
    await aiFixPartName(it1.id);
    await aiFindPart(it1.id);
    expect(asked.filter((a) => a.path === 'part-find')).toHaveLength(0);
    const i = (await db.items.get(it1.id))!;
    expect(i.partNumber).toBe('90915-YZZE1');
    expect(i.aiFind).toMatchObject({ search: 'garage', filled: '90915-YZZE1' });
    expect(i.aiFind!.numbers[0]).toMatchObject({ number: '90915-YZZE1', garage: 1 });
    expect(i.diagramIds).toHaveLength(1);
    expect(i.diagramIds![0]).not.toBe(pic.id);
    expect(notices.find((n) => n.kind === 'number')).toMatchObject({ number: '90915-YZZE1', garage: 1, catalogs: 0 });
    // Another car: not the same part — the AI is asked, with the garage's number as a hint only when the car is the same.
    const other = await car('Nissan', 'Patrol');
    const it2 = await addItem(other.id, { kind: 'part', block: 'A', titleEn: 'OIL FILTER', qty: 1, unitPriceFils: 0 });
    await aiFindPart(it2.id);
    const q = asked.find((a) => a.path === 'part-find')!;
    expect(q.body).toMatchObject({ part: 'OIL FILTER', make: 'Nissan', hints: [] });
  });

  it('a number used before but not fitted is a hint to the AI and a candidate on the line; a web search made lately for the same part serves again', async () => {
    const first = await car('Toyota', 'Camry');
    await updateVehicle(first.vehicleId, { year: 2018, engine: '2.5L', vin: VIN });
    asked = [];
    const used = await addItem(first.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0, partNumber: '04465-33480' });
    expect(used.partNumber).toBe('04465-33480');
    const second = await car('Toyota', 'Camry');
    await updateVehicle(second.vehicleId, { year: 2019, engine: '2.5L' });
    const it1 = await addItem(second.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    await aiFindPart(it1.id);
    const q = asked.find((a) => a.path === 'part-find')!;
    expect(q.body).toMatchObject({ hints: ['04465-33480'], built: '' });
    // The garage's number came back from the web too (04465-12610 in the answer is another): seen once + used before = proven.
    const i = (await db.items.get(it1.id))!;
    expect(i.aiFind!.numbers.map((n) => [n.number, n.garage ?? 0])).toEqual([['04465-12610', 0], ['04465-02220', 0], ['04465-33480', 1]]);
    expect(i.partNumber).toBe('04465-12610');
    // A third car of the kind within the month: the web answer again — the AI is not asked.
    const third = await car('Toyota', 'Camry');
    await updateVehicle(third.vehicleId, { year: 2018, engine: '2.5L' });
    const it2 = await addItem(third.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    await aiFindPart(it2.id);
    expect(asked.filter((a) => a.path === 'part-find')).toHaveLength(1);
    const j = (await db.items.get(it2.id))!;
    expect(j.aiFind?.search).toBe('web');
    expect(j.partNumber).toBe('04465-12610');
    expect(j.diagramIds).toHaveLength(1);
    expect(j.sampleIds).toHaveLength(1);
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
    expect(asked.find((a) => a.path === 'part-find')?.body).toMatchObject({ part: 'FRONT BRAKE PADS', make: 'Toyota', model: 'Corolla', year: 2009, vin: VIN, built: 'Japan', hints: [] });
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

describe('every part of a job at once (v0.52)', () => {
  it('the names put right first (quietly), then each part looked up: a number only when it is the one found and proven; the pictures on every line; one card — «Отменить» brings names and numbers back', async () => {
    const o = await car('Toyota', 'Corolla');
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'колодки тормазные передние', qty: 1, unitPriceFils: 0 });
    const filter = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'OIL FILTER', qty: 1, unitPriceFils: 0 });
    const work = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'BRAKE SERVICE', qty: 1, unitPriceFils: 0 });
    // The filter's search finds two numbers, both seen in a catalogue: neither is written.
    const one = answers['part-find'];
    setAiTransport(async (path, body) => {
      asked.push({ path, body: body as Record<string, unknown> });
      if (path !== 'part-find') return answers[path];
      if ((body as { part: string }).part === 'OIL FILTER')
        return { ...(one as object), numbers: [{ number: '90915-YZZE1', brand: 'Toyota', seen: ['https://www.amayama.com/a', 'https://megazip.net/b'] }, { number: '90915-10003', brand: 'Toyota', seen: ['https://partsouq.com/c'] }] };
      return one;
    });
    const r = await aiAllParts(o.id);
    expect(r).toEqual({ lines: 2, names: 1, numbers: 1, pictures: 2 });
    expect(asked.filter((a) => a.path === 'part-find').map((a) => a.body.part).sort()).toEqual(['FRONT BRAKE PADS', 'OIL FILTER']);
    const [p, f, w] = await Promise.all([db.items.get(pads.id), db.items.get(filter.id), db.items.get(work.id)]);
    expect([p!.titleRu, p!.titleEn, p!.partNumber]).toEqual(['КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', 'FRONT BRAKE PADS', '04465-12610']);
    expect([f!.partNumber, f!.aiFind?.numbers.length]).toEqual([undefined, 2]);
    expect([p!.diagramIds?.length, p!.sampleIds?.length, f!.diagramIds?.length]).toEqual([1, 1, 1]);
    expect(w!.aiFind).toBeUndefined();
    // One card for all of it — no card per line.
    expect(notices.map((n) => n.kind)).toEqual(['parts']);
    await notices[0].undo();
    const back = (await db.items.get(pads.id))!;
    expect([back.titleRu, back.titleEn, back.partNumber]).toEqual(['КОЛОДКИ ТОРМАЗНЫЕ ПЕРЕДНИЕ', undefined, undefined]);
    expect(back.diagramIds).toHaveLength(1);
  });

  it('a line with its number but no pictures is looked up for them; a line already looked up is not asked again', async () => {
    const o = await car('Toyota', 'Corolla');
    const it1 = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0, partNumber: '04465-99999' });
    await aiAllParts(o.id);
    const i = (await db.items.get(it1.id))!;
    expect([i.partNumber, i.diagramIds?.length]).toEqual(['04465-99999', 1]);
    asked = [];
    await aiAllParts(o.id);
    expect(asked.filter((a) => a.path === 'part-find')).toHaveLength(0);
  });
});

describe('the part search only when asked (v0.53)', () => {
  it('a part saved: its name put right at once, its number not looked up — until asked', async () => {
    const o = await car('Toyota', 'Corolla');
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'колодки тормазные передние', qty: 1, unitPriceFils: 0 });
    aiAfterPart(pads.id);
    await until(async () => !!(await db.items.get(pads.id))?.titleEn);
    await until(async () => !aiWorking(`name:${pads.id}`));
    await new Promise((r) => setTimeout(r, 30));
    const i = (await db.items.get(pads.id))!;
    expect([i.titleRu, i.titleEn, i.partNumber, i.aiFind]).toEqual(['КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', 'FRONT BRAKE PADS', undefined, undefined]);
    expect(asked.filter((a) => a.path === 'part-find')).toHaveLength(0);
    // Asked («Найти номер» in its sheet): looked up.
    await aiFindPart(pads.id, { again: true });
    expect((await db.items.get(pads.id))!.partNumber).toBe('04465-12610');
  });

  it('the same part picked again on the same car: the garage’s memory answers (the web search of minutes ago), the server is not asked', async () => {
    const o = await car('Toyota', 'Corolla');
    const first = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    await aiFindPart(first.id, { again: true });
    const second = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    asked = [];
    const r = await aiAllParts(o.id, { only: [second.id] });
    expect(r).toEqual({ lines: 1, names: 0, numbers: 1, pictures: 1 });
    expect(asked.filter((a) => a.path === 'part-find')).toHaveLength(0);
    const i = (await db.items.get(second.id))!;
    expect([i.partNumber, i.aiFind?.search, i.diagramIds?.length, i.sampleIds?.length]).toEqual(['04465-12610', 'web', 1, 1]);
  });

  it('the parts picked on the job: only they are looked at', async () => {
    const o = await car('Toyota', 'Corolla');
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    const filter = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'OIL FILTER', qty: 1, unitPriceFils: 0 });
    const r = await aiAllParts(o.id, { only: [filter.id] });
    expect(r?.lines).toBe(1);
    expect(asked.filter((a) => a.path === 'part-find').map((a) => a.body.part)).toEqual(['OIL FILTER']);
    expect((await db.items.get(pads.id))!.aiFind).toBeUndefined();
    expect((await db.items.get(filter.id))!.diagramIds).toHaveLength(1);
  });
});
