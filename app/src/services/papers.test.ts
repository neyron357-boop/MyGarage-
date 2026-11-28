import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import type { ReceiptRead } from '../domain/receipt';
import { setAiTransport } from './ai';
import { createCustomer } from './customers';
import { addItem } from './estimate';
import { addExpense } from './money';
import { checkIn } from './orders';
import { addPapers, loadPapers, notePaperPrices, paperToExpense, readPapers, removePaper, rereadFailed, resetPaperReader, setPaperDate, supplierPaperStats, tidyPapers } from './papers';
import { askAgainText, historyOffersFor, priceFromHistory, priceHintsFor, searchBoughtParts, undoHistoryPrices } from './priceBook';
import { getSettings } from './settings';
import { updateItem } from './estimate';
import { withMarkup } from '../domain/money';
import { ensureSeed } from './seed';
import { suppliersForJob, suppliersRanked } from './supplierRank';

/*
 * The multi-scanner of the suppliers' paper invoices (v1.05), the garage's AI played here: what each picture is read as is
 * said by a word in it. Every seller, TRN, number, part and price is made up.
 */

const SELLER = { vendor: 'Al Noor Auto Spare Parts LLC', vendorTrn: '100000000000003', vendorPhone: '+971500000001', kind: 'parts' };
const READS: Record<string, ReceiptRead> = {
  A: {
    isReceipt: true,
    ...SELLER,
    invoiceNo: 'INV-0420',
    dateText: '05/02/2025',
    date: '2025-02-05',
    carText: 'TOYOTA HIACE 2018',
    items: [
      { name: 'Brake pad front', part: 'FRONT BRAKE PADS', qty: 1, unitPrice: 180, total: 180 },
      { name: 'Oil filter', part: 'OIL FILTER', qty: 2, unitPrice: 25, total: 50 },
    ],
    subtotal: 230,
    vat: 11.5,
    total: 241.5,
    confidence: 0.9,
  },
  // The same seller spelt otherwise, its TRN the same: the same supplier.
  B: {
    isReceipt: true,
    ...SELLER,
    vendor: 'AL-NOOR SPARE PARTS',
    vendorPhone: '',
    invoiceNo: 'INV-0533',
    dateText: '10/06/2025',
    date: '2025-06-10',
    carText: 'TOYOTA HIACE',
    items: [{ name: 'Brake pad front', part: 'FRONT BRAKE PADS', qty: 1, unitPrice: 175, total: 175 }],
    total: 175,
    confidence: 0.9,
  },
  // The first one again, photographed otherwise: a twin.
  C: { isReceipt: true, ...SELLER, invoiceNo: 'INV 420', dateText: '05/02/2025', date: '2025-02-05', items: [{ name: 'Brake pad front', qty: 1, unitPrice: 180, total: 180 }], total: 241.5, confidence: 0.9 },
  // A seller not in the base, already an expense.
  D: { isReceipt: true, vendor: 'Gulf Radiators', kind: 'service', invoiceNo: '7701', dateText: '20/11/2026', date: '2026-11-20', items: [{ name: 'Radiator repair', qty: 1, unitPrice: 300, total: 300 }], total: 300, confidence: 0.9 },
  N: { isReceipt: false, items: [], total: 0, confidence: 0.9 },
};
let down = false;
const asked: string[] = [];

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  resetPaperReader();
  down = false;
  asked.length = 0;
  setAiTransport(async (path, body) => {
    if (path !== 'receipt') throw new Error(`not played: ${path}`);
    const data = (body as { image: { data: string } }).image.data;
    const word = atob(data).match(/PAPER-(\w)/)?.[1] ?? '';
    asked.push(word);
    if (down) throw new Error('no server');
    return READS[word];
  });
});
afterEach(() => setAiTransport(undefined));

const photo = (word: string, extra = '') => new File([`PAPER-${word} ${extra}`.padEnd(2000, '.')], `${word}.jpg`, { type: 'image/jpeg' });

describe('the suppliers’ paper invoices read in bulk (v1.05)', () => {
  it('taken in (the same photo once), read by the AI; a seller new to the base added off the paper, known again by its TRN; a twin told', async () => {
    expect(await addPapers([photo('A'), photo('A'), photo('B'), photo('C', 'other photo')])).toEqual({ added: 3, twins: 1 });
    expect((await loadPapers()).counts.waiting).toBe(3);
    expect(await readPapers()).toBe(3);
    const view = await loadPapers();
    expect(view.counts).toMatchObject({ all: 3, waiting: 0, done: 2, twin: 1 });
    const sups = await db.suppliers.toArray();
    const noor = sups.filter((s) => /noor/i.test(s.name));
    // One supplier, made off the first paper: its phone, its TRN in the notes, what it sold.
    expect(noor).toHaveLength(1);
    expect([noor[0].name, noor[0].phone, noor[0].notes, noor[0].parts]).toEqual(['Al Noor Auto Spare Parts LLC', '+971500000001', 'TRN 100000000000003', 'FRONT BRAKE PADS, OIL FILTER']);
    const a = view.papers.find((p) => p.invoiceNo === 'INV-0420')!;
    expect([a.state, a.added, a.supplierId, a.date, a.dateSure, a.totalFils, a.make, a.model, a.lines?.length]).toEqual(['done', true, noor[0].id, '2025-02-05', true, 24150, 'Toyota', 'Hiace', 2]);
    expect(view.papers.find((p) => p.invoiceNo === 'INV-0533')).toMatchObject({ state: 'done', supplierId: noor[0].id });
    expect(view.papers.find((p) => p.state === 'twin')?.twinOf).toBe(a.id);
    expect(view.learnt).toEqual({ suppliers: 1, added: 1, lines: 3, prices: 3 });
    // Its card: two invoices, the money, the pads bought twice (the last price), for Toyota.
    const st = await supplierPaperStats(noor[0].id);
    expect([st.papers, st.totalFils, st.lastAt, st.parts[0], st.makes]).toEqual([2, 41650, '2025-06-10', { part: 'FRONT BRAKE PADS', times: 2, lastFils: 17500, make: 'Toyota' }, [{ make: 'Toyota', n: 2 }]]);
  });

  it('what it teaches: the supplier’s rating and «Брали» for a Toyota job, its prices in «+ Цена» of a new job’s line', async () => {
    await addPapers([photo('A'), photo('B')]);
    await readPapers();
    const noor = (await db.suppliers.toArray()).find((s) => /noor/i.test(s.name))!;
    const ranked = await suppliersRanked();
    expect(ranked.use.get(noor.id)).toMatchObject({ jobs: 0, papers: 2, lines: 3, makeJobs: { toyota: 2 } });
    const c = await createCustomer({ name: 'Omar', phone: '050 765 4321', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'K', number: '12345' }, make: 'Toyota', model: 'Hiace', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads', unitPriceFils: 0 });
    const job = (await suppliersForJob(o.id, 'en'))!;
    const first = job.parts.find((r) => r.supplier.id === noor.id)!;
    expect(first.why.map((w) => w.kind)).toEqual(expect.arrayContaining(['boughtFor', 'sold']));
    const hints = await priceHintsFor(pads.id);
    expect(hints.hints.map((h) => [h.point.supplierId === noor.id, h.point.costFils, h.point.via, h.near])).toEqual([[true, 17500, 'paper', 2]]);
  });

  it('already an expense: told, not recorded again; another put in the money book by hand, with «Отменить»; one taken away, with «Отменить»', async () => {
    const cats = await db.expenseCategories.toArray();
    await addExpense({ date: '2026-11-20', categoryId: cats[0].id, amountFils: 30000, vatFils: 0, vendor: 'Gulf Radiators', method: 'cash', note: '' });
    await addPapers([photo('D'), photo('A')]);
    await readPapers();
    const view = await loadPapers();
    const d = view.papers.find((p) => p.vendor === 'Gulf Radiators')!;
    expect(d.expenseId).toBeTruthy();
    const a = view.papers.find((p) => p.invoiceNo === 'INV-0420')!;
    expect(a.expenseId).toBeUndefined();
    const before = await db.expenses.count();
    const r = (await paperToExpense(a.id))!;
    const e = (await db.expenses.get(r.expenseId))!;
    expect([e.amountFils, e.vatFils, e.date, e.note, e.lines?.length]).toEqual([24150, 1150, '2025-02-05', '#INV-0420', 2]);
    await r.undo();
    expect(await db.expenses.count()).toBe(before);
    // Taken away: its prices with it; «Отменить» — back.
    const prices = () => db.priceBook.where('id').startsWith(`paper:${a.id}:`).count();
    expect(await prices()).toBe(2);
    const undo = await removePaper(a.id);
    expect([await db.papers.get(a.id), await prices()]).toEqual([undefined, 0]);
    await undo();
    expect([(await db.papers.get(a.id))?.state, await prices()]).toEqual(['done', 2]);
    expect(await notePaperPrices(a.id)).toBe(2);
  });

  it('v1.05.1: the car in the line («SANTAFE AC EXPANSION VALVE QWE»): a Santa Fe job’s line says who sold it and for how much, that seller comes first with it', async () => {
    READS.E = {
      isReceipt: true,
      vendor: 'Desert Star Spare Parts LLC',
      vendorTrn: '100000000000005',
      kind: 'parts',
      invoiceNo: '97001',
      dateText: '10-Nov-2026',
      date: '2026-11-10',
      items: [{ name: 'SANTAFE AC EXPANSION VALVE QWE', part: 'AC EXPANSION VALVE', car: 'SANTAFE', brand: 'QWE', qty: 1, unitPrice: 85, total: 89.25 }],
      subtotal: 85,
      vat: 4.25,
      total: 89.25,
      confidence: 0.9,
    };
    // Another seller sold the same valve for another model.
    READS.F = { isReceipt: true, vendor: 'Blue Gulf Auto Parts', vendorTrn: '100000000000006', kind: 'parts', invoiceNo: '5501', dateText: '01-Nov-2026', date: '2026-11-01', items: [{ name: 'TUCSON AC EXPANSION VALVE', part: 'AC EXPANSION VALVE', car: 'TUCSON', qty: 1, unitPrice: 70, total: 73.5 }], subtotal: 70, vat: 3.5, total: 73.5, confidence: 0.9 };
    await addPapers([photo('E'), photo('F')]);
    await readPapers();
    const star = (await db.suppliers.toArray()).find((s) => /desert/i.test(s.name))!;
    const point = (await db.priceBook.where('id').startsWith('paper:').toArray()).find((p) => p.supplierId === star.id)!;
    expect([point.part, point.make, point.model, point.brand, point.costFils, point.name]).toEqual(['AC EXPANSION VALVE', 'Hyundai', 'Santa Fe', 'QWE', 8500, 'SANTAFE AC EXPANSION VALVE QWE']);
    const c = await createCustomer({ name: 'Omar', phone: '050 765 4321', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'K', number: '22222' }, make: 'Hyundai', model: 'Santa Fe', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
    const valve = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'AC expansion valve', unitPriceFils: 0 });
    const { boughtBeforeFor } = await import('./priceBook');
    expect((await boughtBeforeFor(o.id)).get(valve.id)).toMatchObject({ supplier: 'Desert Star Spare Parts LLC', fils: 8500 });
    const job = (await suppliersForJob(o.id, 'en'))!;
    const first = job.parts[0];
    expect(first.supplier.id).toBe(star.id);
    expect(first.why.find((w) => w.kind === 'sold')).toMatchObject({ model: 'Santa Fe', fils: 8500 });
    const other = job.parts.find((r) => /blue gulf/i.test(r.supplier.name))!;
    expect(other.why.find((w) => w.kind === 'sold')).not.toHaveProperty('model');
    delete READS.E;
    delete READS.F;
  });

  it('v1.06: a Hiace job’s parts priced from the history — up to three prices under each, «Цены из истории» takes this model’s newest, «Отменить» puts it back; the parts bought searched', async () => {
    await addPapers([photo('A'), photo('B')]);
    await readPapers();
    const noor = (await db.suppliers.toArray()).find((s) => /noor/i.test(s.name))!;
    const c = await createCustomer({ name: 'Omar', phone: '050 765 4321', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'K', number: '33333' }, make: 'Toyota', model: 'Hiace', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads front', unitPriceFils: 0 });
    const offers = await historyOffersFor(o.id);
    // the newest first (June's 175 before February's 180 — one per supplier and kind)
    expect(offers.get(pads.id)?.offers.map((x) => [x.supplier, x.fils, x.near, x.bought])).toEqual([['Al Noor Auto Spare Parts LLC', 17500, 2, true]]);
    const had = await priceFromHistory(o.id);
    expect(had.size).toBe(1);
    const priced = (await db.items.get(pads.id))!;
    const s = await getSettings();
    expect([priced.costPriceFils, priced.supplierId, priced.unitPriceFils, priced.costFrom?.fils]).toEqual([17500, noor.id, withMarkup(17500, s.defaultMarkupBp), 17500]);
    // a cost typed by hand is no longer the history's
    await updateItem(pads.id, { costPriceFils: 16000 });
    expect((await db.items.get(pads.id))!.costFrom).toBeUndefined();
    // «Отменить» touches only a line the history's price is still on
    await undoHistoryPrices(had);
    expect((await db.items.get(pads.id))!.costPriceFils).toBe(16000);
    await updateItem(pads.id, { costPriceFils: undefined });
    const again = await priceFromHistory(o.id);
    await undoHistoryPrices(again);
    // the customer's price was there before (the first one's) — it stays; the cost goes
    const back = (await db.items.get(pads.id))!;
    expect([back.costPriceFils, back.costFrom, back.unitPriceFils]).toEqual([undefined, undefined, withMarkup(17500, s.defaultMarkupBp)]);
    // «Поставщики» → the search: the part and the car typed
    const found = await searchBoughtParts('front brake pads toyota hiace');
    expect(found.car).toEqual({ make: 'Toyota', model: 'Hiace' });
    // one per supplier, part and car — its newest
    expect(found.hits.map((h) => [h.point.costFils, h.near])).toEqual([[17500, 2]]);
    expect(askAgainText(found.hits[0].point, found.car)).toContain('*FRONT BRAKE PADS* for Toyota Hiace');
  });

  it('v1.05.2: papers learnt by older rules tidied once — each line’s cars, part and kind again, the year by the supplier’s numbering (not a day set by hand), their prices again', async () => {
    const base = { hash: 'h', mediaId: 'm', state: 'done' as const, supplierId: 's1', createdAt: '', updatedAt: '' };
    const old = (id: string, invoiceNo: string, date: string, more = {}) => ({ ...base, id, hash: id, invoiceNo, date, dateSure: true, ...more });
    await db.papers.bulkAdd([
      old('p1', '5100', '2026-11-20', {
        lines: [
          { name: 'CONDENSER RIO/ACCENT D', part: 'CONDENSER RIO/ACCENT D', qty: 1, unitFils: 30000, kind: 'aftermarket' as const, unsure: true as const },
          { name: 'RD LANCER 2008-2016', qty: 1, unitFils: 45000, kind: 'aftermarket' as const, unsure: true as const, said: { kind: 'oem' as const } },
        ],
      }),
      // a faint 6 read as 4: among November's papers by its number
      old('p2', '5120', '2024-11-25', { lines: [{ name: 'FRT BRK PAID COROLLA G', qty: 1, unitFils: 12000, kind: 'aftermarket' as const, unsure: true as const }] }),
      old('p4', '5090', '2026-11-18'),
      old('p5', '5080', '2026-11-16'),
      // read as 2024 too, but the day a person set
      old('p3', '5060', '2024-11-10'),
    ]);
    await setPaperDate('p3', '2024-11-10');
    await db.papers.update('p3', { v: undefined });
    expect(await tidyPapers()).toBe(5);
    const [p1, p2, p3] = await Promise.all(['p1', 'p2', 'p3'].map((id) => db.papers.get(id)));
    expect(p1!.lines!.map((l) => [l.part, l.make, l.model, l.fits, l.kind, !!l.unsure])).toEqual([
      ['CONDENSER', 'Kia', 'Rio', [{ make: 'Hyundai', model: 'Accent' }], 'aftermarket', false],
      ['RADIATOR', 'Mitsubishi', 'Lancer', undefined, 'oem', false],
    ]);
    expect([p2!.lines![0].part, p2!.lines![0].model, p2!.lines![0].kind]).toEqual(['FRONT BRAKE PAD', 'Corolla', 'oem']);
    expect([p2!.date, p2!.dateSure, p2!.state]).toEqual(['2026-11-25', false, 'look']);
    // the day a person set stays
    expect(p3!.date).toBe('2024-11-10');
    expect((await db.papers.get('p1'))!.date).toBe('2026-11-20');
    const prices = await db.priceBook.where('id').startsWith('paper:p1:').toArray();
    expect(prices.map((x) => [x.part, x.model, x.fits])).toEqual([
      ['CONDENSER', 'Rio', ['Hyundai Accent']],
      ['RADIATOR', 'Lancer', undefined],
    ]);
    expect((await db.priceBook.get('paper:p2:0'))?.at.slice(0, 10)).toBe('2026-11-25');
    // once
    expect(await tidyPapers()).toBe(0);
  });

  it('not read (no server): kept, read again later; a picture that is no invoice is said so', async () => {
    down = true;
    await addPapers([photo('A'), photo('N')]);
    await readPapers();
    let view = await loadPapers();
    expect(view.counts.failed).toBe(2);
    down = false;
    expect(await rereadFailed()).toBe(2);
    await readPapers();
    view = await loadPapers();
    expect(view.counts).toMatchObject({ done: 1, failed: 1 });
    expect(view.papers.find((p) => p.state === 'failed')?.why).toBe('notPaper');
  });
});
