import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { mechanicsOf, toggled } from '../domain/crew';
import { flatPeaks, peaksOf, WAVE_BARS } from '../domain/waveform';
import { addNote } from './notes';
import { assignMechanic, checkIn, toggleMechanic } from './orders';
import { ensureSeed } from './seed';

const job = () =>
  checkIn({ plate: { emirate: 'DXB', code: 'G', number: '94406' }, make: 'Toyota', model: 'Hiace', name: 'AA Technical Service', phone: '', docLanguage: 'en', complaint: 'AC not cooling', arrivedNow: true });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('several mechanics on one job (v0.17.2)', () => {
  it('puts each on and off by itself, the first kept as the job’s mechanic', async () => {
    const o = await job();
    const [nakash, jaggie, khalid] = ['NAKASH', 'JAGGIE', 'KHALID'];
    expect(await toggleMechanic(o.id, nakash)).toEqual([nakash]);
    expect(await toggleMechanic(o.id, jaggie)).toEqual([nakash, jaggie]);
    expect(await toggleMechanic(o.id, khalid)).toEqual([nakash, jaggie, khalid]);
    // Off again: the others keep their order, the first is the one before.
    expect(await toggleMechanic(o.id, nakash)).toEqual([jaggie, khalid]);
    const saved = (await db.orders.get(o.id))!;
    expect([saved.mechanicIds, saved.mechanicId]).toEqual([[jaggie, khalid], jaggie]);
    expect(mechanicsOf(saved)).toEqual([jaggie, khalid]);
    // Everyone off: nobody, and no first.
    await toggleMechanic(o.id, jaggie);
    await toggleMechanic(o.id, khalid);
    const none = (await db.orders.get(o.id))!;
    expect([mechanicsOf(none), none.mechanicId]).toEqual([[], undefined]);
    // One and no other (the demo, an older call).
    await assignMechanic(o.id, khalid);
    expect(mechanicsOf((await db.orders.get(o.id))!)).toEqual([khalid]);
  });

  it('reads a job written before the list: its one mechanic', () => {
    expect(mechanicsOf({ mechanicId: 'm1' })).toEqual(['m1']);
    expect(mechanicsOf({})).toEqual([]);
    expect(mechanicsOf({ mechanicId: 'm1', mechanicIds: [] })).toEqual([]);
    expect(toggled(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggled(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

describe('the bars of a voice message', () => {
  it('are as loud as each slice of the recording, silence a dot', () => {
    // One second at 1000 samples: quiet, loud, silent thirds.
    const samples = Array.from({ length: 900 }, (_, i) => (i < 300 ? 0.1 : i < 600 ? 0.8 : 0) * Math.sin(i));
    const bars = peaksOf(samples, 9);
    expect(bars).toHaveLength(9);
    expect(Math.max(...bars.slice(3, 6))).toBe(1);
    expect(bars.slice(0, 3).every((b) => b > 0.12 && b < 0.6)).toBe(true);
    expect(bars.slice(6)).toEqual([0.12, 0.12, 0.12]);
    expect(peaksOf([], 4)).toEqual([0.12, 0.12, 0.12, 0.12]);
    expect(flatPeaks()).toHaveLength(WAVE_BARS);
  });

  it('are kept with a recorded note', async () => {
    const o = await job();
    const voice = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const n = await addNote(o.id, { voice, seconds: 16.4, peaks: [0.123, 1.5, -1, 0.5] });
    expect([n.kind, n.seconds, n.peaks]).toEqual(['voice', 16, [0.12, 1, 0, 0.5]]);
    expect((await db.notes.get(n.id))!.peaks).toEqual([0.12, 1, 0, 0.5]);
    // Without bars (a browser that cannot read its recording): none kept — the chat draws flat ones.
    expect((await addNote(o.id, { voice, seconds: 3 })).peaks).toBeUndefined();
  });
});
