import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { zipStore } from '../domain/zip';
import { saveSupplier } from './parts';
import { ensureSeed } from './seed';
import { suppliersRanked } from './supplierRank';
import { learnExports, readExports } from './waExport';

/* Chats exported from the phone (v0.91.5) — made-up exports only: read, matched, counted; nothing of their words kept. */

const IPHONE = [
  '[12/03/2025, 09:14:05] Rukn Garage: *Toyota Camry 2018*',
  '1. FRONT BUMPER',
  '[12/03/2025, 09:30:41] Al Noor Parts: org 950 dup 400',
  '[14/03/2025, 18:02:10] Rukn Garage: Toyota Prado 2016 headlight?',
  '[14/03/2025, 18:10:00] Al Noor Parts: 650',
  '[20/03/2025, 10:00:00] Rukn Garage: Lexus LX570 brake pads available?',
  '[20/03/2025, 10:05:00] Al Noor Parts: 280',
].join('\n');
const ANDROID = ['3/12/25, 9:14 AM - Garage: Nissan Patrol 2016 gearbox mounting?', '3/12/25, 1:05 PM - +971 50 111 0002: not available'].join('\n');

const enc = new TextEncoder();
const zipOf = (name: string, text: string) => new File([zipStore([{ name: '_chat.txt', data: enc.encode(text) }, { name: '00000001-PHOTO.jpg', data: new Uint8Array(2000) }])], name, { type: 'application/zip' });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  await saveSupplier({ name: 'Al Noor Parts', phone: '+971501110001' });
});

describe('chats exported from the phone (v0.91.5)', () => {
  it('an iPhone zip and an Android text: matched to their chats (by name, by number), the garage side found, counted', async () => {
    const items = await readExports([zipOf('WhatsApp Chat - Al Noor Parts.zip', IPHONE), new File([ANDROID], 'WhatsApp Chat with +971 50 111 0002.txt', { type: 'text/plain' })]);
    expect(items[0]).toMatchObject({ name: 'Al Noor Parts', garage: 'Rukn Garage', count: 6, group: false, empty: false, chat: { id: '971501110001@c.us', phone: '971501110001' } });
    expect(items[1]).toMatchObject({ chat: { id: '971501110002@c.us' }, garage: 'Garage', count: 2 });
    const r = await learnExports(items);
    expect(r).toMatchObject({ chats: 2, turns: 4 });
    const fact = await db.chatFacts.get('971501110001@c.us');
    expect(fact?.turns).toHaveLength(3);
    expect(fact?.exportFrom).toBe(Date.UTC(2025, 2, 12, 9, 14, 5) - 4 * 3600_000);
    expect(fact?.signs).toEqual({ car: 1, parts: 1 });
    // Nothing of the words kept.
    expect(JSON.stringify(await db.chatFacts.toArray())).not.toContain('BUMPER');
    // The supplier of the base now known by its whole history: answered three of three, with prices.
    const ranked = await suppliersRanked();
    const k = ranked.know.get(ranked.list.find((s) => s.name === 'Al Noor Parts')!.id)!;
    expect(k.seen).toMatchObject({ turns: 3, answered: 3, priced: 3 });
    expect(k.makes[0]).toMatchObject({ make: 'Toyota', by: 'seen', n: 2 });
  });

  it('read again later: the export takes its own time only — requests read from the server since stay', async () => {
    await db.chatFacts.put({ id: '971501110001@c.us', phone: '971501110001', turns: [{ t: Date.UTC(2026, 10, 20), r: 60, p: 1 }], updatedAt: '2026-11-20T00:00:00.000Z' });
    await learnExports(await readExports([zipOf('WhatsApp Chat - Al Noor Parts.zip', IPHONE)]));
    expect((await db.chatFacts.get('971501110001@c.us'))?.turns).toHaveLength(4);
  });

  it('not an export, a group, an unknown chat — shown, not counted', async () => {
    const group = ['[01/02/2025, 10:00:00] A: hi', '[01/02/2025, 10:01:00] B: hello', '[01/02/2025, 10:02:00] C: ok'].join('\n');
    const items = await readExports([new File(['just some notes'], 'notes.txt'), new File([group], 'WhatsApp Chat - Friends.txt'), new File([IPHONE], 'WhatsApp Chat - Nobody Known.txt')]);
    expect(items.map((x) => [x.empty, x.group, !!x.chat])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ]);
    expect((await learnExports(items)).chats).toBe(0);
  });
});
