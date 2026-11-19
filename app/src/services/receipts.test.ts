import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { onAiNotice, setAiTransport, type AiNotice } from './ai';
import { addItem } from './estimate';
import { checkIn } from './orders';
import { removeEntry } from './entries';
import { scanReceipt } from './receipts';
import { ensureSeed } from './seed';
import { saveSupplier } from './parts';

const PHOTO = () => new File([new Uint8Array(12000).fill(1)], 'receipt.jpg', { type: 'image/jpeg' });
let asked: { path: string; body: Record<string, unknown> }[] = [];
let answer: unknown;
/** What the server reads off the test's paper: a parts shop's tax invoice. */
const base = (): Record<string, unknown> => ({
  isReceipt: true,
  kind: 'parts',
  vendor: 'AL QUOZ AUTO PARTS',
  vendorTrn: '100234567800003',
  vendorPhone: '',
  vendorAddress: 'Al Quoz Ind. 3',
  invoiceNo: 'A-1042',
  date: '',
  items: [
    { name: 'Oil filter 90915-YZZE1', partNumber: '90915-YZZE1', qty: 1, unitPrice: 35, total: 35 },
    { name: 'Air filter element', qty: 1, unitPrice: 85, total: 85 },
  ],
  subtotal: 120,
  vat: 6,
  total: 126,
  paymentMethod: 'cash',
  carText: 'Land Cruiser',
  confidence: 0.9,
});
const notices: AiNotice[] = [];
let stop: () => void;

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
  asked = [];
  notices.length = 0;
  answer = base();
  setAiTransport(async (path, body) => {
    asked.push({ path, body: body as Record<string, unknown> });
    if (answer instanceof Error) throw answer;
    return answer;
  });
  stop = onAiNotice((n) => notices.push(n));
});
afterEach(() => {
  setAiTransport(undefined);
  stop();
});

const job = async (make: string, model: string, parts: string[]) => {
  const o = await checkIn({ plate: { emirate: 'DXB', code: 'R', number: String(10000 + Math.floor(Math.random() * 89999)) }, make, model, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
  const ids = [];
  for (const p of parts) ids.push((await addItem(o.id, { kind: 'part', block: 'A', titleEn: p, qty: 1, unitPriceFils: 0 })).id);
  return { id: o.id, lines: ids };
};

describe('a receipt scanned', () => {
  it('records the expense in «Запчасти» with the photo, ties it to the job its parts are for, and prices the job’s lines off it; the seller known to the base is that supplier, in the garage’s words', async () => {
    await job('Toyota', 'Camry', ['FRONT BRAKE PADS']);
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER', 'AIR FILTER']);
    const known = await saveSupplier({ name: 'Al Quoz Auto Parts', phone: '0501234567' });
    const r = await scanReceipt(PHOTO());
    expect(r.failed).toBeUndefined();
    expect(asked.map((a) => a.path)).toEqual(['receipt']);
    const img = (asked[0].body.image as { type: string; data: string }) ?? {};
    expect(img.type).toBe('image/jpeg');
    expect(img.data.length).toBeGreaterThan(100);
    const e = (await db.expenses.get(r.expense!.id))!;
    const cat = (await db.expenseCategories.get(e.categoryId))!;
    expect([e.amountFils, e.vatFils, e.vendor, e.method, cat.code, e.orderId]).toEqual([12600, 600, 'Al Quoz Auto Parts', 'cash', 'parts', lc.id]);
    // The seller: the supplier already in the base (by its name), not a second one; its empty address filled off the paper.
    expect(r.supplier).toEqual({ id: known.id, name: 'Al Quoz Auto Parts', added: false });
    expect(await db.suppliers.count()).toBe(1);
    expect((await db.suppliers.get(known.id))!.address).toBe('Al Quoz Ind. 3');
    expect(e.note).toBe('#A-1042 · OIL FILTER 90915-YZZE1 · AIR FILTER ELEMENT');
    // The photo is the expense's receipt; the cash moved.
    const media = await db.media.where('ownerId').equals(e.id).toArray();
    expect(media.map((m) => m.slot)).toEqual(['receipt']);
    expect(await db.cashMovements.filter((m) => m.expenseId === e.id).count()).toBe(1);
    // The job's lines: the purchase price and the seller's VAT off the paper, the number and the supplier on the one that had none.
    const [oil, air] = await Promise.all(lc.lines.map((id) => db.items.get(id)));
    expect([oil!.costPriceFils, oil!.purchaseVatFils, oil!.partNumber, oil!.supplierId]).toEqual([3500, 175, '90915-YZZE1', known.id]);
    expect([air!.costPriceFils, air!.purchaseVatFils]).toEqual([8500, 425]);
    expect(r.costed).toBe(2);
    expect(r.job).toMatchObject({ orderId: lc.id, car: 'Toyota Land Cruiser' });
    // Said once, with «Отменить»: the expense goes, its movement and photo with it; the lines keep their prices.
    const n = notices.find((x) => x.kind === 'expense')!;
    expect(n).toMatchObject({ amountFils: 12600, vendor: 'Al Quoz Auto Parts', items: 2, close: false, supplier: { name: 'Al Quoz Auto Parts', added: false } });
    expect(n.kind === 'expense' && n.job?.car).toBe('Toyota Land Cruiser');
    await n.undo();
    expect(await db.expenses.get(e.id)).toBeUndefined();
    expect(await db.cashMovements.filter((m) => m.expenseId === e.id).count()).toBe(0);
    expect((await db.items.get(lc.lines[0]))!.costPriceFils).toBe(3500);
    // The known supplier stays (the line keeps it too); what the paper filled on it is emptied again.
    expect((await db.suppliers.get(known.id))!.address).toBeUndefined();
    expect((await db.items.get(lc.lines[0]))!.supplierId).toBe(known.id);
  });

  it('a seller not in the base is added off the paper — the phone as the app keeps numbers, the car’s make, what it sold, the TRN — and put on the job’s lines; «Отменить» takes it away with the expense', async () => {
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER']);
    answer = { ...base(), vendor: 'NEW PARTS LLC', vendorPhone: '050 442 1190', vendorTrn: '100999999900003', items: [{ name: 'Oil filter', total: 40 }], subtotal: undefined, vat: undefined, total: 40 };
    const r = await scanReceipt(PHOTO());
    expect(r.supplier).toMatchObject({ name: 'NEW PARTS LLC', added: true });
    const s = (await db.suppliers.get(r.supplier!.id))!;
    expect([s.name, s.phone, s.address, s.makes, s.parts, s.notes, s.service]).toEqual(['NEW PARTS LLC', '+971504421190', 'Al Quoz Ind. 3', ['Toyota'], 'OIL FILTER', 'TRN 100999999900003', undefined]);
    expect((await db.items.get(lc.lines[0]))!.supplierId).toBe(s.id);
    expect(r.expense!.vendor).toBe('NEW PARTS LLC');
    const n = notices.find((x) => x.kind === 'expense')!;
    expect(n.kind === 'expense' && n.supplier).toEqual({ name: 'NEW PARTS LLC', added: true });
    // The same seller on the next paper (its number typed as it is said) — the same supplier, not another.
    answer = { ...base(), vendor: 'New Parts L.L.C.', vendorPhone: '0504421190', items: [{ name: 'Oil filter', total: 40 }], subtotal: undefined, vat: undefined, total: 40 };
    const again = await scanReceipt(PHOTO());
    expect(again.supplier).toEqual({ id: s.id, name: 'NEW PARTS LLC', added: false });
    expect(await db.suppliers.count()).toBe(1);
    await removeEntry({ source: 'expense', id: again.expense!.id });
    await n.undo();
    expect(await db.suppliers.get(s.id)).toBeUndefined();
    expect((await db.items.get(lc.lines[0]))!.supplierId).toBeUndefined();
    expect(await db.expenses.get(r.expense!.id)).toBeUndefined();
  });

  it('a contractor’s bill: in «Подрядчики», the contractor added as one, the outsourced line paid by it', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'R', number: '70707' }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const line = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'FRONT BUMPER PAINT', qty: 1, unitPriceFils: 80000, outsource: { state: 'out' } });
    answer = { ...base(), kind: 'service', vendor: 'SPEED PAINT SHOP', vendorPhone: '04 338 7712', vendorAddress: '', vendorTrn: '', items: [{ name: 'Bumper paint', total: 500 }], subtotal: undefined, vat: undefined, total: 500, carText: 'Patrol' };
    const r = await scanReceipt(PHOTO());
    const e = (await db.expenses.get(r.expense!.id))!;
    const cat = (await db.expenseCategories.get(e.categoryId))!;
    expect([cat.code, e.orderId, e.amountFils, e.vendor]).toEqual(['subcontract', o.id, 50000, 'SPEED PAINT SHOP']);
    const s = (await db.suppliers.get(r.supplier!.id))!;
    expect([s.service, s.phone, s.makes]).toEqual([true, '+97143387712', ['Nissan']]);
    const it = (await db.items.get(line.id))!;
    expect([it.costPriceFils, it.outsource?.supplierId, it.outsource?.expenseId]).toEqual([50000, s.id, e.id]);
    await notices.find((x) => x.kind === 'expense')!.undo();
    const back = (await db.items.get(line.id))!;
    expect([back.outsource?.expenseId, back.outsource?.supplierId, back.costPriceFils]).toEqual([undefined, undefined, 50000]);
    expect(await db.suppliers.get(s.id)).toBeUndefined();
  });

  it('a price already typed on a line stays; a receipt naming no job’s parts is recorded without a job', async () => {
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER']);
    await db.items.update(lc.lines[0], { costPriceFils: 3000 });
    answer = { isReceipt: true, vendor: 'X', items: [{ name: 'Oil filter', total: 40 }], total: 40, confidence: 0.9 };
    const one = await scanReceipt(PHOTO());
    expect(one.expense!.orderId).toBe(lc.id);
    // A seller's name of a letter or two is not a supplier.
    expect(one.supplier).toBeUndefined();
    expect(await db.suppliers.count()).toBe(0);
    expect((await db.items.get(lc.lines[0]))!.costPriceFils).toBe(3000);
    answer = { isReceipt: true, vendor: 'Y', items: [{ name: 'Wiper blades', total: 40 }], total: 40, confidence: 0.9 };
    const two = await scanReceipt(PHOTO());
    expect(two.expense!.orderId).toBeUndefined();
    expect(two.job).toBeUndefined();
    expect(notices.filter((n) => n.kind === 'expense').map((n) => n.kind === 'expense' && !!n.job)).toEqual([true, false]);
  });

  it('nothing recorded when the server did not read it, the paper has no sum, or it is fuel or food — that one waits in the sheet, filled in, for the manager’s category', async () => {
    answer = new Error('ai off');
    expect(await scanReceipt(PHOTO())).toMatchObject({ failed: 'ai', costed: 0 });
    answer = { ...base(), kind: 'fuel', vendor: 'ENOC', items: [{ name: 'Special 95', total: 120 }], subtotal: undefined, vat: undefined, total: 120 };
    const fuel = await scanReceipt(PHOTO());
    expect([fuel.failed, fuel.fields?.amountFils, fuel.fields?.vendor, fuel.fields?.kind]).toEqual(['kind', 12000, 'ENOC', 'fuel']);
    expect(await db.suppliers.count()).toBe(0);
    answer = { isReceipt: true, items: [{ name: 'Oil filter' }], confidence: 0.9 };
    const r = await scanReceipt(PHOTO());
    expect(r.failed).toBe('amount');
    expect(r.fields?.items[0].name).toBe('OIL FILTER');
    expect(await db.expenses.count()).toBe(0);
    expect(notices).toHaveLength(0);
  });
});
