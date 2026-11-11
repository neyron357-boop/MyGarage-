import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { coverIndex, coverOf, setCover } from './cover';
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
});
