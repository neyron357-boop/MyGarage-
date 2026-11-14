import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { mulkiyaOf, setMulkiya } from './cover';
import { createCustomer, createVehicle, findVehicleForCheckIn, findVehiclesByNumber, popularMakes, popularModels } from './customers';
import { addMedia } from './media';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

const customer = (name: string, phone = '') => createCustomer({ name, phone, preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });

describe('a car found by its number without the code', () => {
  it('offers the cars with that number — the code left out, another emirate picked — not another code', async () => {
    const firaz = await customer('Firaz', '0508942721');
    const civic = await createVehicle(firaz.id, { plate: { emirate: 'AUH', code: '10', number: '95340' }, make: 'Honda', model: 'Civic' });
    const ali = await customer('Ali');
    const camry = await createVehicle(ali.id, { plate: { emirate: 'DXB', code: 'A', number: '12345' }, make: 'Toyota', model: 'Camry' });
    await createVehicle(ali.id, { plate: { emirate: 'DXB', code: 'B', number: '12345' }, make: 'Nissan', model: 'Sunny' });

    // Typed as the number alone, Dubai picked: the Abu Dhabi car with that number, its owner.
    const one = await findVehiclesByNumber({ emirate: 'DXB', code: '', number: '95340' });
    expect(one.map((c) => [c.vehicle.id, c.owner?.name])).toEqual([[civic.id, 'Firaz']]);
    // Two cars with the number: both offered, this emirate first.
    expect((await findVehiclesByNumber({ emirate: 'DXB', code: '', number: '12345' })).map((c) => c.vehicle.plate.code).sort()).toEqual(['A', 'B']);
    // A code typed that the car has another of: not offered; the exact plate is the match, not an offer.
    expect(await findVehiclesByNumber({ emirate: 'DXB', code: 'C', number: '12345' })).toEqual([]);
    expect(await findVehiclesByNumber({ emirate: 'DXB', code: 'A', number: '12345' })).toEqual([]);
    expect((await findVehicleForCheckIn({ emirate: 'DXB', code: 'A', number: '12345' }))?.vehicle.id).toBe(camry.id);
    // A car kept without its code: found when the code is typed.
    const noCode = await createVehicle(ali.id, { plate: { emirate: 'SHJ', code: '', number: '777' }, make: 'Kia', model: 'Rio' });
    expect((await findVehiclesByNumber({ emirate: 'SHJ', code: '3', number: '777' })).map((c) => c.vehicle.id)).toEqual([noCode.id]);
  });

  it('says when the car found is in a job right now', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'Z', number: '67274' }, make: 'Nissan', model: 'Kicks', name: 'Criscel', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const [c] = await findVehiclesByNumber({ emirate: 'DXB', code: '', number: '67274' });
    expect(c.activeOrder?.id).toBe(o.id);
  });
});

describe('one chip per make and model, however they were typed', () => {
  it('counts "HiAce", "HIACE" and "Hiace" as the catalogue\'s one model, the most frequent first', async () => {
    const c = await customer('Fleet');
    let n = 10000;
    for (const [make, model] of [['TOYOTA', 'HiAce'], ['toyota', 'HIACE'], ['Toyota', 'Hiace'], ['Toyota', 'HiLux'], ['Toyota', 'YARIS'], ['Toyota', 'YARIS']])
      await createVehicle(c.id, { plate: { emirate: 'DXB', code: 'M', number: String(n++) }, make, model });
    const makes = await popularMakes(['Nissan', 'Toyota']);
    expect(makes.filter((m) => m.toLowerCase() === 'toyota')).toEqual(['Toyota']);
    const models = await popularModels('toyota', ['Hilux', 'Hiace', 'Yaris', 'Camry']);
    expect(models.slice(0, 4)).toEqual(['Hiace', 'Yaris', 'Hilux', 'Camry']);
  });
});

describe('the Mulkiya of a car, both sides', () => {
  it('is kept with the car; before it was taken, the photos from the latest check-in act stand for it', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: '30303' }, make: 'Kia', model: 'Rio', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const act = uid();
    await db.inspections.add({ id: act, orderId: o.id, kind: 'intake', createdAt: new Date().toISOString(), locked: false } as never);
    const old = await addMedia({ ownerType: 'inspection', ownerId: act, slot: 'mulkiya_back', file: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), compress: false });
    expect(await mulkiyaOf(o.vehicleId)).toEqual({ mulkiya_back: old.id });
    const front = await setMulkiya(o.vehicleId, 'mulkiya', new Blob([new Uint8Array(20)], { type: 'image/jpeg' }));
    expect(await mulkiyaOf(o.vehicleId)).toEqual({ mulkiya: front.id, mulkiya_back: old.id });
    // A side taken again replaces the one taken for the car before (the act's photo stays with the act).
    const back = await setMulkiya(o.vehicleId, 'mulkiya_back', new Blob([new Uint8Array(30)], { type: 'image/jpeg' }));
    const again = await setMulkiya(o.vehicleId, 'mulkiya_back', new Blob([new Uint8Array(40)], { type: 'image/jpeg' }));
    expect(await mulkiyaOf(o.vehicleId)).toEqual({ mulkiya: front.id, mulkiya_back: again.id });
    expect(await db.media.get(back.id)).toBeUndefined();
    expect(await db.media.get(old.id)).toBeDefined();
  });
});
