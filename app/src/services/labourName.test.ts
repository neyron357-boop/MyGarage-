import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { buildSuggestions } from '../domain/linePrices';
import { addItem, sendVersion, updateItem } from './estimate';
import { removeLines, restoreLines } from './flow';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

/*
 * The labour charge named by the job's parts (v0.80, the owner: «Labor Charge сформировалась автоматически исходя из
 * деталей»): it follows the parts as they are added, renamed, taken off and brought back — while it is a draft.
 */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

const job = () => checkIn({ plate: { emirate: 'DXB', code: 'K', number: '40780' }, make: 'Nissan', model: 'X-Trail', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
const titleOf = async (id: string) => (await db.items.get(id))?.titleEn;

describe('syncLabourNames (v0.80)', () => {
  it('follows the parts: added, renamed, taken off, brought back', async () => {
    const o = await job();
    const labour = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Labor charge', unitPriceFils: 35_000 });
    expect(await titleOf(labour.id)).toBe('LABOR CHARGE');
    const filter = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'gear filter', unitPriceFils: 21_600 });
    const cooler = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'transmission cooler', unitPriceFils: 48_000 });
    expect(await titleOf(labour.id)).toBe('LABOR CHARGE: GEAR FILTER, TRANSMISSION COOLER');
    await updateItem(cooler.id, { titleEn: 'TRANSMISSION OIL COOLER' });
    expect(await titleOf(labour.id)).toBe('LABOR CHARGE: GEAR FILTER, TRANSMISSION OIL COOLER');
    const removed = await removeLines([filter.id]);
    expect(await titleOf(labour.id)).toBe('LABOR CHARGE: TRANSMISSION OIL COOLER');
    await restoreLines(removed);
    expect(await titleOf(labour.id)).toBe('LABOR CHARGE: GEAR FILTER, TRANSMISSION OIL COOLER');
  });

  it('a labour charge added after the parts says them at once; one typed by hand stays as typed', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'GEAR FILTER', unitPriceFils: 21_600 });
    const labour = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'LABOUR CHARGES', unitPriceFils: 35_000 });
    expect(await titleOf(labour.id)).toBe('LABOUR CHARGES: GEAR FILTER');
    await updateItem(labour.id, { titleEn: 'LABOUR CHARGES: GEAR FILTER + FLUSH' });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'GASKET', unitPriceFils: 5_000 });
    expect(await titleOf(labour.id)).toBe('LABOUR CHARGES: GEAR FILTER + FLUSH');
    // Plain words again: the parts' once more.
    await updateItem(labour.id, { titleEn: 'LABOUR CHARGES' });
    expect(await titleOf(labour.id)).toBe('LABOUR CHARGES: GEAR FILTER, GASKET');
    // A price changed with the name as it shows: still the parts'.
    await updateItem(labour.id, { titleEn: 'LABOUR CHARGES: GEAR FILTER, GASKET', unitPriceFils: 40_000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'OIL SEAL', unitPriceFils: 3_000 });
    expect(await titleOf(labour.id)).toBe('LABOUR CHARGES: GEAR FILTER, GASKET, OIL SEAL');
  });

  it('told to the customer — its name is what they saw; other work keeps its own name', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'GEAR FILTER', unitPriceFils: 21_600 });
    const labour = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'LABOR CHARGE', unitPriceFils: 35_000 });
    const align = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'ALIGNMENT', unitPriceFils: 10_000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'GASKET', unitPriceFils: 5_000 });
    expect(await titleOf(labour.id)).toBe('LABOR CHARGE: GEAR FILTER');
    expect(await titleOf(align.id)).toBe('ALIGNMENT');
  });

  it('price memory: a labour charge named by its parts is the same labour charge', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'GEAR FILTER', unitPriceFils: 21_600 });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'LABOR CHARGE', unitPriceFils: 35_000 });
    const lines = await db.items.toArray();
    const s = buildSuggestions(lines, new Map(), [], { lang: 'en' });
    expect([...s.work.list.keys()]).toContain('LABOR CHARGE');
    expect([...s.work.list.keys()].some((k) => k.includes(':'))).toBe(false);
  });
});
