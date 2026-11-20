import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { sheetEntries } from '../domain/diagramSheet';
import { addDiagram, diagramSheets, setDiagramMarks } from './diagramSheet';
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
  it('a diagram added by hand, the part outlined on it — several pieces — numbered as the list asked about, in the job order', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: '45123' }, make: 'Toyota', model: 'Camry', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const a = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 0 });
    const b = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'TIE ROD END', qty: 2, unitPriceFils: 0 });
    const first = await addDiagram(b.id, png());
    await setDiagramMarks(b.id, [{ id: first, x: 0.3, y: 0.4, rx: 0.1, ry: 0.08 }, { id: first, x: 0.7, y: 0.6, rx: 0.05, ry: 0.05 }]);
    let item = await db.items.get(b.id);
    expect(item!.diagramIds).toEqual([first]);
    expect(item!.diagramMarks).toHaveLength(2);
    expect((await db.media.get(first))!.slot).toBe('diagram');

    const data = await suppliersForJob(o.id, 'en');
    expect(data!.partLines.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(sheetEntries(data!.partLines).map((e) => [e.n, e.name, e.qty, e.marks.length])).toEqual([[2, 'TIE ROD END', 2, 2]]);

    // A second diagram by hand: first now, and the outlines on the other one come off (the part is outlined on this one).
    const second = await addDiagram(b.id, png());
    item = await db.items.get(b.id);
    expect(item!.diagramIds).toEqual([second, first]);
    expect(item!.diagramMarks).toBeUndefined();

    // Outlines on a picture that is not the part's, or on two pictures, are refused; kept sane; all taken off.
    await expect(setDiagramMarks(b.id, [{ id: 'nope', x: 0.5, y: 0.5, rx: 0.1, ry: 0.1 }])).rejects.toThrow();
    await expect(setDiagramMarks(b.id, [{ id: first, x: 0.5, y: 0.5, rx: 0.1, ry: 0.1 }, { id: second, x: 0.5, y: 0.5, rx: 0.1, ry: 0.1 }])).rejects.toThrow();
    await db.items.update(b.id, { diagramMark: { id: second, x: 0.5, y: 0.5, r: 0.09 } });
    await setDiagramMarks(b.id, [{ id: second, x: 2, y: -1, rx: 1, ry: 0 }]);
    item = await db.items.get(b.id);
    expect(item!.diagramMarks).toEqual([{ id: second, x: 1, y: 0, rx: 0.5, ry: 0.012 }]);
    expect(item!.diagramMark).toBeUndefined();
    await setDiagramMarks(b.id, []);
    expect((await db.items.get(b.id))!.diagramMarks).toBeUndefined();

    // Without a canvas (here) there are no sheets — the text still goes.
    expect(await diagramSheets(data!.partLines)).toEqual([]);
  });
});
