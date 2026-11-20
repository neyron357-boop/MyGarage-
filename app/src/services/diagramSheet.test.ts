import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { sheetEntries } from '../domain/diagramSheet';
import { addDiagram, diagramSheets, setDiagramMark } from './diagramSheet';
import { addItem } from './estimate';
import { checkIn } from './orders';
import { ensureSeed } from './seed';
import { suppliersForJob } from './supplierRank';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });

describe('the parts diagrams for a supplier (v0.59, no AI)', () => {
  it('a diagram added by hand, the part ringed on it — numbered as the list asked about, in the job order', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: '45123' }, make: 'Toyota', model: 'Camry', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const a = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    const b = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'TIE ROD END', qty: 2, unitPriceFils: 0 });
    const first = await addDiagram(b.id, png());
    await setDiagramMark(b.id, { id: first, x: 0.3, y: 0.4, r: 0.09 });
    let item = await db.items.get(b.id);
    expect(item!.diagramIds).toEqual([first]);
    expect(item!.diagramMark).toEqual({ id: first, x: 0.3, y: 0.4, r: 0.09 });
    expect((await db.media.get(first))!.slot).toBe('diagram');

    const data = await suppliersForJob(o.id, 'en');
    expect(data!.partLines.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(sheetEntries(data!.partLines).map((e) => [e.n, e.name, e.qty, !!e.mark])).toEqual([[2, 'TIE ROD END', 2, true]]);

    // A second diagram by hand: first now, and the ring on the other one comes off (the part is ringed on this one).
    const second = await addDiagram(b.id, png());
    item = await db.items.get(b.id);
    expect(item!.diagramIds).toEqual([second, first]);
    expect(item!.diagramMark).toBeUndefined();

    // A ring on a picture that is not the part's is refused; the ring taken off.
    await expect(setDiagramMark(b.id, { id: 'nope', x: 0.5, y: 0.5, r: 0.09 })).rejects.toThrow();
    await setDiagramMark(b.id, { id: second, x: 2, y: -1, r: 1 });
    expect((await db.items.get(b.id))!.diagramMark).toEqual({ id: second, x: 1, y: 0, r: 0.18 });
    await setDiagramMark(b.id, undefined);
    expect((await db.items.get(b.id))!.diagramMark).toBeUndefined();

    // Without a canvas (here) there are no sheets — the text still goes.
    expect(await diagramSheets(data!.partLines)).toEqual([]);
  });
});
