import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, sendVersion, setLinePhotos } from './estimate';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

const photo = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n])], { type: 'image/jpeg' });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe("a line's photos", () => {
  it('are added, kept in order and taken off; one the customer was sent stays stored', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'A', number: '44444' }, make: 'Toyota', model: 'Camry', name: '', phone: '', docLanguage: 'en', complaint: 'Brakes', arrivedNow: true });
    const line = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads', unitPriceFils: 18000 });
    await setLinePhotos(line.id, [], [photo(1), photo(2)]);
    const [a, b] = (await db.items.get(line.id))!.mediaIds!;
    expect((await db.media.get(a))!.ownerType).toBe('item');

    // Taken off before the quote went: deleted.
    await setLinePhotos(line.id, [b], []);
    expect((await db.items.get(line.id))!.mediaIds).toEqual([b]);
    expect(await db.media.get(a)).toBeUndefined();

    // Sent to the customer, then taken off the line: what the customer saw stays.
    await sendVersion(o.id, { via: 'whatsapp' });
    await setLinePhotos(line.id, [], [photo(3)]);
    const now = (await db.items.get(line.id))!.mediaIds!;
    expect(now).toHaveLength(1);
    expect(now).not.toContain(b);
    expect(await db.media.get(b)).toBeDefined();
  });
});
