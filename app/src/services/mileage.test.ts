import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { createCustomer, createVehicle } from './customers';
import { mileageHistory, odometerPhotoOf, previousMileage, setJobMileage, setOdometerPhoto, takeOdometerRead } from './mileage';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

/*
 * The mileage of each visit (v0.44): a sure reading of the odometer's photo goes in by itself, a doubtful one is
 * offered; typed or looked at, it stays the job's; the car's next visit knows the last one.
 */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

const car = async () => {
  const c = await createCustomer({ name: 'Saeed', phone: '050 765 4321', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
  return createVehicle(c.id, { plate: { emirate: 'DXB', code: 'K', number: '12345' }, make: 'Toyota', model: 'Camry' });
};
const visit = (vehicleId: string) => checkIn({ vehicleId, plate: { emirate: 'DXB', code: '', number: '' }, make: '', model: '', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });

describe('the mileage of each visit (v0.44)', () => {
  it('a sure reading goes into a job without one; a doubtful one is offered and the job keeps its own', async () => {
    const v = await car();
    const o = await visit(v.id);
    expect(await takeOdometerRead(o.id, { km: 118_200, sure: true, offered: [118_200] })).toEqual({ filled: 118_200, offered: [], look: false });
    expect((await db.orders.get(o.id))!.mileageKm).toBe(118_200);
    // Read again, doubtful: offered — the mileage stays.
    expect(await takeOdometerRead(o.id, { km: 118_900, sure: false, offered: [118_900, 18_900] })).toEqual({ offered: [118_900, 18_900], look: true });
    expect(await db.orders.get(o.id)).toMatchObject({ mileageKm: 118_200, mileageOffered: [118_900, 18_900] });
    // Sure, but the job has another one already: offered, not over it.
    expect(await takeOdometerRead(o.id, { km: 119_000, sure: true, offered: [119_000] })).toEqual({ offered: [119_000], look: true });
    expect((await db.orders.get(o.id))!.mileageKm).toBe(118_200);
    // Doubtful, but the job's own mileage: nothing to look at — the offer before is done with.
    expect(await takeOdometerRead(o.id, { km: 118_200, sure: false, offered: [118_200, 18_200] })).toEqual({ offered: [], look: false });
    expect((await db.orders.get(o.id))!.mileageOffered).toBeUndefined();
    // Looked at: typed — the offers are done with.
    await takeOdometerRead(o.id, { km: 118_900, sure: false, offered: [118_900] });
    await setJobMileage(o.id, 118_950);
    expect(await db.orders.get(o.id)).toMatchObject({ mileageKm: 118_950 });
    expect((await db.orders.get(o.id))!.mileageOffered).toBeUndefined();
    // Nothing read off a photo of a job with its mileage: the photo is its proof, nothing waits.
    expect(await takeOdometerRead(o.id, { sure: false, offered: [] })).toEqual({ offered: [], look: false });
    expect((await db.orders.get(o.id))!.mileageOffered).toBeUndefined();
    // Taken off; then nothing read: the photo waits to be looked at (an empty offer — the chip's dot).
    await setJobMileage(o.id, undefined);
    expect((await db.orders.get(o.id))!.mileageKm).toBeUndefined();
    expect(await takeOdometerRead(o.id, { sure: false, offered: [] })).toEqual({ offered: [], look: true });
    expect((await db.orders.get(o.id))!.mileageOffered).toEqual([]);
    await expect(setJobMileage(o.id, -5)).rejects.toThrow();
  });

  it('the odometer’s photo is the job’s; a retake takes the place of the one before', async () => {
    const v = await car();
    const o = await visit(v.id);
    const a = await setOdometerPhoto(o.id, new Blob([new Uint8Array(5000)], { type: 'image/jpeg' }));
    expect(await odometerPhotoOf(o.id)).toBe(a);
    const b = await setOdometerPhoto(o.id, new Blob([new Uint8Array(6000)], { type: 'image/jpeg' }));
    expect(await odometerPhotoOf(o.id)).toBe(b);
    expect((await db.media.where('ownerId').equals(o.id).toArray()).filter((m) => m.slot === 'odometer')).toHaveLength(1);
  });

  it('the car’s next visit knows its last mileage — a job’s own, an old act’s or a scanner report’s', async () => {
    const v = await car();
    const first = await visit(v.id);
    await db.orders.update(first.id, { arrivedAt: '2026-09-01T08:00:00.000Z', createdAt: '2026-09-01T08:00:00.000Z' });
    // Before v0.44 the mileage was in the check-in act.
    await db.inspections.add({ id: uid(), orderId: first.id, kind: 'intake', step: 0, mileageKm: 101_000, warningLights: [], obdCodes: [], functionChecks: {}, skippedPhotos: {}, locked: true, createdAt: '2026-09-01T08:00:00.000Z' } as never);
    const second = await visit(v.id);
    await db.orders.update(second.id, { arrivedAt: '2026-10-01T08:00:00.000Z', createdAt: '2026-10-01T08:00:00.000Z', obdScans: [{ id: 's', at: '2026-10-01T08:00:00.000Z', codes: [], odometer: { value: 66_000, unit: 'mi' } } as never] });
    const third = await visit(v.id);
    await setJobMileage(third.id, 112_000);
    expect((await mileageHistory(v.id)).map((e) => e.km)).toEqual([101_000, 106_217, 112_000]);
    expect((await previousMileage((await db.orders.get(third.id))!))?.km).toBe(106_217);
    expect(await previousMileage((await db.orders.get(first.id))!)).toBeUndefined();
  });
});
