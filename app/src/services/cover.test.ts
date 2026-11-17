import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { carOwned, coverIndex, coverOf, mulkiyaOf, removeCarPhoto, restoreCarPhoto, setCover, setMulkiya, setVinPhoto, vinPhotoOf } from './cover';
import { addInspectionPhoto, getOrCreateInspection } from './inspections';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

const photo = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n])], { type: 'image/jpeg' });
const job = (number: string, vehicleId?: string) =>
  checkIn({ vehicleId, plate: { emirate: 'DXB', code: 'A', number }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: 'Noise', arrivedNow: true });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe("the car's main photo", () => {
  it('is the front three-quarter of the check-in until one is taken for the car', async () => {
    const o = await job('11111');
    expect(await coverOf(o.vehicleId)).toBeUndefined();
    const insp = await getOrCreateInspection(o.id, 'intake');
    const rear = await addInspectionPhoto(insp.id, 'rear', photo(1));
    expect(await coverOf(o.vehicleId)).toBe(rear.id);
    const front = await addInspectionPhoto(insp.id, 'front_left', photo(2));
    await addInspectionPhoto(insp.id, 'dashboard', photo(3));
    expect(await coverOf(o.vehicleId)).toBe(front.id);

    // Taken for the car: it wins, and a new one replaces it.
    const first = await setCover(o.vehicleId, photo(4));
    expect(await coverOf(o.vehicleId)).toBe(first.id);
    const second = await setCover(o.vehicleId, photo(5));
    expect(await coverOf(o.vehicleId)).toBe(second.id);
    expect(await db.media.get(first.id)).toBeUndefined();
    expect(await db.media.get(front.id)).toBeDefined();
  });

  it('comes from the latest visit, for many cars at once', async () => {
    const a = await job('22222');
    const b = await job('33333');
    const old = await addInspectionPhoto((await getOrCreateInspection(a.id, 'intake')).id, 'front', photo(1));
    expect(await coverIndex([a.vehicleId, b.vehicleId])).toEqual(new Map([[a.vehicleId, old.id]]));
    // The same car again later: the new visit's photo.
    await db.orders.update(a.id, { stage: 'closed' });
    const again = await job('22222', a.vehicleId);
    expect(again.vehicleId).toBe(a.vehicleId);
    await db.orders.update(again.id, { createdAt: new Date(Date.now() + 60_000).toISOString() });
    const fresh = await addInspectionPhoto((await getOrCreateInspection(again.id, 'intake')).id, 'rear', photo(2));
    expect((await coverIndex([a.vehicleId])).get(a.vehicleId)).toBe(fresh.id);
  });

  it('a regular with many visits: the latest visit that has photos, its best angle (v0.37: visits gone over the latest first)', async () => {
    const first = await job('55555');
    const car = first.vehicleId;
    const other = await job('66666');
    let at = Date.now() - 40 * 86_400_000;
    const visits = [first.id];
    await db.orders.update(first.id, { stage: 'closed', createdAt: new Date(at).toISOString() });
    for (let n = 0; n < 34; n++) {
      const v = await job('55555', car);
      at += 86_400_000;
      await db.orders.update(v.id, { stage: 'closed', createdAt: new Date(at).toISOString() });
      visits.push(v.id);
    }
    // Photos on the 4th visit (a rear, then a front three-quarter) and on the 2nd; none on the thirty after.
    const four = (await getOrCreateInspection(visits[3], 'intake')).id;
    await addInspectionPhoto(four, 'rear', photo(1));
    const best = await addInspectionPhoto(four, 'front_left', photo(2));
    await addInspectionPhoto((await getOrCreateInspection(visits[1], 'intake')).id, 'front_left', photo(3));
    const otherPhoto = await addInspectionPhoto((await getOrCreateInspection(other.id, 'intake')).id, 'front', photo(4));
    expect(await coverIndex([car, other.vehicleId])).toEqual(new Map([[other.vehicleId, otherPhoto.id], [car, best.id]]));
  });
});

describe("the car's photos, edited in their full-screen view", () => {
  it('takes a wrong one off and puts it back (Undo); a check-in act keeps its own', async () => {
    const o = await job('44444');
    const vin = await setVinPhoto(o.vehicleId, photo(1));
    expect(await carOwned([vin.id, undefined])).toEqual(new Set([vin.id]));
    const removed = await removeCarPhoto(vin.id);
    expect(await vinPhotoOf(o.vehicleId)).toBeUndefined();
    expect(await db.mediaBlobs.get(vin.id)).toBeUndefined();
    await restoreCarPhoto(removed);
    expect(await vinPhotoOf(o.vehicleId)).toBe(vin.id);
    expect((await db.mediaBlobs.get(vin.id))?.blob.size).toBe(3);

    // The Mulkiya photographed in the check-in act: shown on the chip, not the car's own — it is not taken off.
    const act = await addInspectionPhoto((await getOrCreateInspection(o.id, 'intake')).id, 'mulkiya', photo(2));
    expect((await mulkiyaOf(o.vehicleId)).mulkiya).toBe(act.id);
    expect(await carOwned([act.id])).toEqual(new Set());
    await expect(removeCarPhoto(act.id)).rejects.toThrow();
    // A side taken for the car wins over the act's, and taken off, the act's shows again.
    const own = await setMulkiya(o.vehicleId, 'mulkiya', photo(3));
    expect((await mulkiyaOf(o.vehicleId)).mulkiya).toBe(own.id);
    await removeCarPhoto(own.id);
    expect((await mulkiyaOf(o.vehicleId)).mulkiya).toBe(act.id);
  });
});
