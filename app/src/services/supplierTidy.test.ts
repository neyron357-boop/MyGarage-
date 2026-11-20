import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { saveSupplier } from './parts';
import { ensureSeed } from './seed';
import { tidySuppliers } from './supplierTidy';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('putting the supplier base in order (v0.60)', () => {
  it('names in English and guesses in one go; «Отменить» puts back what nothing changed since; a field set by hand is no longer a guess', async () => {
    const ar = await saveSupplier({ name: 'البركة لقطع غيار السيارات المستعملة', parts: 'неизвестно' });
    const ko = await saveSupplier({ name: 'Korean Star Auto Spare Parts' });
    const done = await saveSupplier({ name: 'Test Motors', parts: 'Engines', makes: ['Toyota'] });
    const r = await tidySuppliers();
    expect([r.named, r.parts, r.makes]).toEqual([1, 2, 1]);
    const a = (await db.suppliers.get(ar.id))!;
    expect(a.name).toBe('Al Barakah Used Auto Spare Parts');
    expect(a.nameAr).toBe('البركة لقطع غيار السيارات المستعملة');
    expect(a.parts).toBe('Used parts');
    expect(a.guessed).toEqual(['parts', 'condition']);
    const k = (await db.suppliers.get(ko.id))!;
    expect(k.makes).toEqual(['Hyundai', 'Kia']);
    expect(k.parts).toBe('Spare parts');
    expect(await db.suppliers.get(done.id)).toEqual(done);

    // the manager writes what the Korean shop sells: no longer a guess; its makes still are
    await saveSupplier({ ...k, parts: 'Hyundai engines' });
    expect((await db.suppliers.get(ko.id))!.guessed).toEqual(['makes']);

    // «Отменить»: back where nothing changed since — the Korean shop keeps the manager's words
    await r.undo();
    const back = (await db.suppliers.get(ar.id))!;
    expect(back.name).toBe('البركة لقطع غيار السيارات المستعملة');
    expect(back.nameAr).toBeUndefined();
    expect(back.parts).toBe('неизвестно');
    expect(back.guessed).toBeUndefined();
    const kb = (await db.suppliers.get(ko.id))!;
    expect(kb.parts).toBe('Hyundai engines');
    expect(kb.makes).toBeUndefined();

    // run again: nothing left to do for the shop already in order
    expect((await tidySuppliers()).named).toBe(1);
  });
});
