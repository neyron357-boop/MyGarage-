import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { whatsappUrl } from './messages';
import { saveSupplier } from './parts';
import { ensureSeed } from './seed';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('a supplier added (v0.24)', () => {
  it('keeps its number as E.164, however typed; a number kept as typed before still opens its WhatsApp', async () => {
    const s = await saveSupplier({ name: 'Al Quoz Auto Parts', phone: '050 123 4567' });
    expect((await db.suppliers.get(s.id))!.phone).toBe('+971501234567');
    await saveSupplier({ id: s.id, name: s.name, phone: '' });
    expect((await db.suppliers.get(s.id))!.phone).toBeUndefined();
    expect(whatsappUrl('050 123 4567', '')).toBe('https://wa.me/971501234567?text=');
  });
});
