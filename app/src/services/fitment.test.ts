import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import type { NumberCheck } from '../domain/fitment';
import { forgetPriorParts } from './ai';
import { updateVehicle } from './customers';
import { addItem, updateItem } from './estimate';
import { ackOrderRisks, loadFitment, markingOfText, orderRisks, readMarking, setMarking, setVinCheck } from './fitment';
import { addMedia } from './media';
import { checkIn } from './orders';
import { setProcurement } from './parts';
import { ensureSeed } from './seed';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
  forgetPriorParts();
});

const AT = '2026-11-21T10:00:00.000Z';
const civic = async () => {
  const o = await checkIn({ plate: { emirate: 'DXB', code: 'H', number: String(10000 + Math.floor(Math.random() * 89999)) }, make: 'Honda', model: 'Civic', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
  await updateVehicle(o.vehicleId, { year: 2008, engine: '1.8L' });
  return o;
};
const check = (spec?: string): NumberCheck => ({
  at: AT,
  epc: { state: 'read', url: 'https://www.megazip.net/parts/honda-x', name: 'Belt, Alternator (Bando)', kind: true, diagrams: 2, fit: 'model', headings: ['Civic · 2006–2011'] },
  web: [{ url: 'https://www.amayama.com/x', how: 'search' }],
  specs: spec ? [{ text: spec, by: 'page', from: 'https://belts.example/x' }] : [],
  named: 'search',
});

/** ENGINE BELT as v0.64 left it: 31110-RSA-G01 written by itself on «seen in two catalogues». */
async function beltLine() {
  const o = await civic();
  const it = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ENGINE BELT', qty: 1, unitPriceFils: 0, partNumber: '31110-RSA-G01' });
  await db.items.update(it.id, {
    aiFind: {
      at: AT,
      search: 'web',
      part: 'ENGINE BELT',
      filled: '31110-RSA-G01',
      numbers: [
        { number: '31110-RSA-G01', brand: 'Honda', seen: ['https://www.amayama.com/a', 'https://partsouq.com/b'], fits: true, name: 'Belt, Alternator (Bando)', check: check('7PK1535') },
        { number: '31110-RNA-004', brand: 'Honda', seen: [] },
      ],
    },
  });
  return { o, it };
}

describe('a line’s numbers judged again (v0.65)', () => {
  it('a number v0.64 wrote itself is not green now: on the model’s diagram — partial; the belt on the car typed — a conflict', async () => {
    const { it } = await beltLine();
    let f = (await loadFitment(it.id))!;
    expect(f.category).toBe('belt');
    expect(f.marked).toBe(true);
    expect(f.current?.fit?.status).toBe('partial');
    expect(f.rows.map((r) => [r.number, r.fit.status])).toEqual([
      ['31110-RSA-G01', 'partial'],
      ['31110-RNA-004', 'unverified'],
    ]);
    await setMarking(it.id, ' 7pk2164 ');
    f = (await loadFitment(it.id))!;
    expect(f.marking).toMatchObject({ text: '7PK2164', from: 'typed', confidence: 1 });
    expect(f.current?.fit).toMatchObject({ status: 'conflict', conflicts: [{ code: 'markingDiffers', params: { marking: '7PK2164', spec: '7PK1535' } }] });
    // Cleared: no marking.
    await setMarking(it.id, '');
    expect((await loadFitment(it.id))!.marking).toBeUndefined();
  });

  it('a number typed by hand or bought is the manager’s own: not judged, not stopped', async () => {
    const o = await civic();
    const it = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ENGINE BELT', qty: 1, unitPriceFils: 0, partNumber: '56992-RNA-A02' });
    const f = (await loadFitment(it.id))!;
    expect(f.current).toEqual({ number: '56992-RNA-A02', fit: undefined });
    expect(await orderRisks([it.id])).toEqual([]);
  });
});

describe('ordering a part whose number is not verified (v0.65)', () => {
  it('asks for the reason, keeps it with the part; the number stays as judged; asked again only when worse', async () => {
    const { it } = await beltLine();
    let risks = await orderRisks([it.id]);
    expect(risks.map((r) => [r.number, r.status])).toEqual([['31110-RSA-G01', 'partial']]);
    // The number typed in the sheet and not saved yet is the one judged: a number of the manager's own — nothing asked.
    expect(await orderRisks([it.id], { [it.id]: '56992-RNA-A02' })).toEqual([]);
    expect((await orderRisks([it.id], { [it.id]: '31110-RSA-G01' })).length).toBe(1);
    await expect(ackOrderRisks(risks, '  ')).rejects.toMatchObject({ code: 'fit.reasonNeeded' });
    await ackOrderRisks(risks, 'Supplier checked by VIN on the phone');
    const i = (await db.items.get(it.id))!;
    expect(i.fitment?.ack).toMatchObject({ number: '31110-RSA-G01', status: 'partial', reason: 'Supplier checked by VIN on the phone' });
    // The status is not changed by the risk taken.
    expect((await loadFitment(it.id))!.current?.fit?.status).toBe('partial');
    expect(await orderRisks([it.id])).toEqual([]);
    // The belt on the car typed since: a conflict — worse than what was accepted: asked again.
    await setMarking(it.id, '7PK2164');
    risks = await orderRisks([it.id]);
    expect(risks.map((r) => r.status)).toEqual(['conflict']);
    // Ordering itself still works as ever (the screens ask first).
    await setProcurement(it.id, { status: 'ordered' });
    expect((await db.items.get(it.id))!.procurementStatus).toBe('ordered');
  });

  it('a number fitted on this very car before is verified: nothing asked', async () => {
    const o = await civic();
    const before = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ENGINE BELT', qty: 1, unitPriceFils: 0, partNumber: '56992-RNA-A02' });
    await updateItem(before.id, { procurementStatus: 'installed' });
    forgetPriorParts();
    const now = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ENGINE BELT', qty: 1, unitPriceFils: 0, partNumber: '56992-RNA-A02' });
    await db.items.update(now.id, { aiFind: { at: AT, search: 'garage', part: 'ENGINE BELT', numbers: [{ number: '56992-RNA-A02', seen: [], garage: 1 }] } });
    expect((await loadFitment(now.id))!.current?.fit?.status).toBe('verified');
    expect(await orderRisks([now.id])).toEqual([]);
  });

  it('lines kept before v0.65 — no fitment, no checks, customer’s parts, works — are read as ever', async () => {
    const o = await civic();
    const own = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ENGINE BELT', qty: 1, unitPriceFils: 0, customerSupplied: true });
    const work = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'BELT REPLACEMENT', qty: 1, unitPriceFils: 0 });
    expect(await loadFitment(work.id)).toBeUndefined();
    expect((await loadFitment(own.id))!.rows).toEqual([]);
    expect(await orderRisks([own.id, work.id, 'gone'])).toEqual([]);
  });
});

describe('the belt’s marking off the line’s photo (v0.65)', () => {
  it('read once a photo; one clean reading — likely, not sure; never over the typed one; only a belt line is read', async () => {
    const { o, it } = await beltLine();
    const photo = await addMedia({ ownerType: 'item', ownerId: it.id, slot: 'photo', file: new Blob([new Uint8Array(2000)], { type: 'image/jpeg' }), compress: false });
    await db.items.update(it.id, { mediaIds: [photo.id] });
    let reads = 0;
    const ocr = async () => (reads++, 'BANDO\nRIBSTAR 7PK2164\nJAPAN');
    const m = await readMarking(it.id, ocr);
    expect(m).toMatchObject({ text: '7PK2164', from: 'photo', confidence: 0.75, mediaId: photo.id });
    expect(m?.raw).toContain('RIBSTAR 7PK2164');
    // An unsure reading off a photo: the conflict still shows (every reading disagrees with 7PK1535), never a green tick.
    expect((await loadFitment(it.id))!.current?.fit?.status).toBe('conflict');
    // The same photo is not read twice.
    await readMarking(it.id, ocr);
    expect(reads).toBe(1);
    // Typed — the manager's word stays.
    await setMarking(it.id, '7PK2165');
    const photo2 = await addMedia({ ownerType: 'item', ownerId: it.id, slot: 'photo', file: new Blob([new Uint8Array(2000)], { type: 'image/jpeg' }), compress: false });
    await db.items.update(it.id, { mediaIds: [photo.id, photo2.id] });
    expect(await readMarking(it.id, ocr)).toBeUndefined();
    expect((await db.items.get(it.id))!.fitment?.marking?.text).toBe('7PK2165');
    // Not a belt: nothing read.
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0, mediaIds: [photo.id] });
    expect(await readMarking(pads.id, ocr)).toBeUndefined();
  });

  it('a reading with letters put right or two readings is less sure; nothing like a marking — none', () => {
    expect(markingOfText('7PK2l64', 'm1', AT)).toMatchObject({ text: '7PK2164', confidence: 0.5 });
    expect(markingOfText('7PK2164 7PK2154', 'm1', AT)).toMatchObject({ text: '7PK2164', confidence: 0.4, alternatives: ['7PK2154'] });
    expect(markingOfText('MADE IN JAPAN', 'm1', AT)).toBeUndefined();
  });
});

describe('a number found by the car’s VIN in a catalogue (v0.66)', () => {
  it('the manager says where: the number typed is verified for this car — nothing asked when ordered; no VIN — not taken; taken back — as before', async () => {
    const o = await civic();
    const it = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ENGINE BELT', qty: 1, unitPriceFils: 0 });
    // No VIN in the card: there is nothing it was found by.
    await expect(setVinCheck(it.id, '56992-RNA-A02', 'emexdwc.ae')).rejects.toMatchObject({ code: 'fit.noVin' });
    await updateVehicle(o.vehicleId, { vin: 'JHMFD16408S200000' });
    await setVinCheck(it.id, '56992rnaa02', 'emexdwc.ae');
    let f = (await loadFitment(it.id))!;
    expect(f.vinCheck).toMatchObject({ number: '56992-RNA-A02', vin: 'JHMFD16408S200000', source: 'emexdwc.ae' });
    // Typed in the sheet, not saved yet: judged already.
    expect(f.vinFit?.fit.status).toBe('verified');
    await updateItem(it.id, { partNumber: '56992-RNA-A02' });
    f = (await loadFitment(it.id))!;
    expect(f.current?.fit?.status).toBe('verified');
    expect(f.vehicle).toMatchObject({ vin: 'JHMFD16408S200000', make: 'Honda', model: 'Civic', year: 2008 });
    expect(await orderRisks([it.id])).toEqual([]);
    // Another number typed: it does not hold for it.
    expect((await orderRisks([it.id], { [it.id]: '31110-RSA-G01' })).length).toBe(0);
    await setVinCheck(it.id, undefined);
    f = (await loadFitment(it.id))!;
    expect([f.vinCheck, f.current?.fit]).toEqual([undefined, undefined]);
  });
});
