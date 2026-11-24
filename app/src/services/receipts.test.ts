import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { onAiNotice, setAiTransport, type AiNotice } from './ai';
import { addItem } from './estimate';
import { checkIn } from './orders';
import { removeEntry, updateEntry } from './entries';
import { expenseEntry } from '../domain/ledger';
import { scanReceipt } from './receipts';
import { ensureSeed } from './seed';
import { saveSupplier } from './parts';
import { addExpense } from './money';

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
/** A job as the expense's sheet offers it (a tap puts the expense on it). */
const option = async (orderId: string, car: string) => {
  const o = (await db.orders.get(orderId))!;
  return { orderId, vehicleId: o.vehicleId, customerId: o.customerId, number: o.number, car };
};
/** The job's lines as they are now (v0.81: a receipt never changes them by itself). */
const linesOf = (ids: string[]) => Promise.all(ids.map((id) => db.items.get(id)));

describe('a receipt scanned', () => {
  it('v0.81: records the expense in «Запчасти» with the photo, on no job — the job its parts are for is offered first, its lines left as they are; the seller known to the base is that supplier, in the garage’s words', async () => {
    await job('Toyota', 'Camry', ['FRONT BRAKE PADS']);
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER', 'AIR FILTER']);
    const before = await linesOf(lc.lines);
    const known = await saveSupplier({ name: 'Al Quoz Auto Parts', phone: '0501234567' });
    const r = await scanReceipt(PHOTO());
    expect(r.failed).toBeUndefined();
    expect(asked.map((a) => a.path)).toEqual(['receipt']);
    const img = (asked[0].body.image as { type: string; data: string }) ?? {};
    expect(img.type).toBe('image/jpeg');
    expect(img.data.length).toBeGreaterThan(100);
    const e = (await db.expenses.get(r.expense!.id))!;
    const cat = (await db.expenseCategories.get(e.categoryId))!;
    expect([e.amountFils, e.vatFils, e.vendor, e.method, cat.code, e.supplierId, e.scanned]).toEqual([12600, 600, 'Al Quoz Auto Parts', 'cash', 'parts', known.id, true]);
    // No job, no car, no customer: the manager picks the job in the sheet.
    expect([e.orderId, e.vehicleId, e.customerId]).toEqual([undefined, undefined, undefined]);
    expect(r.job).toBeUndefined();
    expect(r.others[0]).toEqual(await option(lc.id, 'Toyota Land Cruiser'));
    // The seller: the supplier already in the base (by its name), not a second one; its empty address filled off the paper.
    expect(r.supplier).toEqual({ id: known.id, name: 'Al Quoz Auto Parts', added: false });
    expect(await db.suppliers.count()).toBe(1);
    expect((await db.suppliers.get(known.id))!.address).toBe('Al Quoz Ind. 3');
    // v0.77: the note is the paper's number, the positions a list of their own; the book's row reads them after it, as before.
    expect(e.note).toBe('#A-1042');
    expect(e.lines).toEqual([
      { name: 'OIL FILTER 90915-YZZE1', qty: 1 },
      { name: 'AIR FILTER ELEMENT', qty: 1 },
    ]);
    expect(expenseEntry(e).note).toBe('Al Quoz Auto Parts · #A-1042 · OIL FILTER 90915-YZZE1 · AIR FILTER ELEMENT');
    expect([expenseEntry(e).expenseNote, expenseEntry(e).lines]).toEqual(['#A-1042', e.lines]);
    // The note edited in the sheet: the positions stay.
    await updateEntry({ source: 'expense', id: e.id }, { note: '#A-1042 paid by Ali', lines: expenseEntry(e).lines });
    expect((await db.expenses.get(e.id))!.lines).toEqual(e.lines);
    // The photo is the expense's receipt; the cash moved.
    const media = await db.media.where('ownerId').equals(e.id).toArray();
    expect(media.map((m) => m.slot)).toEqual(['receipt']);
    expect(await db.cashMovements.filter((m) => m.expenseId === e.id).count()).toBe(1);
    // The job's lines: no purchase price, VAT, number or supplier off the paper — as they were.
    expect(await linesOf(lc.lines)).toEqual(before);
    expect(r.costed).toBe(0);
    // Said once, with «Отменить»: the expense goes, its movement and photo with it.
    const n = notices.find((x) => x.kind === 'expense')!;
    expect(n).toMatchObject({ amountFils: 12600, vendor: 'Al Quoz Auto Parts', items: 2, close: false, supplier: { name: 'Al Quoz Auto Parts', added: false } });
    expect(n.kind === 'expense' && n.job).toBeUndefined();
    await n.undo();
    expect(await db.expenses.get(e.id)).toBeUndefined();
    expect(await db.cashMovements.filter((m) => m.expenseId === e.id).count()).toBe(0);
    // The known supplier stays; what the paper filled on it is emptied again; the lines are still as they were.
    expect((await db.suppliers.get(known.id))!.address).toBeUndefined();
    expect(await linesOf(lc.lines)).toEqual(before);
  });

  it('a seller not in the base is added off the paper — the phone as the app keeps numbers, the make of the likeliest job’s car, what it sold, the TRN — the job’s lines not touched (v0.81); «Отменить» takes it away with the expense', async () => {
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER']);
    answer = { ...base(), vendor: 'NEW PARTS LLC', vendorPhone: '050 442 1190', vendorTrn: '100999999900003', items: [{ name: 'Oil filter', total: 40 }], subtotal: undefined, vat: undefined, total: 40 };
    const r = await scanReceipt(PHOTO());
    expect(r.supplier).toMatchObject({ name: 'NEW PARTS LLC', added: true });
    const s = (await db.suppliers.get(r.supplier!.id))!;
    expect([s.name, s.phone, s.address, s.makes, s.parts, s.notes, s.service]).toEqual(['NEW PARTS LLC', '+971504421190', 'Al Quoz Ind. 3', ['Toyota'], 'OIL FILTER', 'TRN 100999999900003', undefined]);
    expect((await db.items.get(lc.lines[0]))!.supplierId).toBeUndefined();
    expect([r.expense!.vendor, r.expense!.supplierId, r.expense!.orderId, r.expense!.scanned]).toEqual(['NEW PARTS LLC', s.id, undefined, true]);
    expect(r.others.map((o) => o.orderId)).toEqual([lc.id]);
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

  // v0.73 (the user: «независимо в каком статусе находится заказ… даже если в архиве»): the paper of a job closed weeks
  // ago, taken off the board, found and put on it; a cancelled one too; a job opened over a year before is not looked at.
  it('a job in any state is looked through — closed weeks before the paper and in the archive, cancelled — and offered, nothing written on it (v0.81)', async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER', 'AIR FILTER']);
    await db.orders.update(lc.id, { stage: 'closed', createdAt: day(40), closedAt: day(30), stageChangedAt: day(30), archivedAt: day(29) });
    const before = await linesOf(lc.lines);
    await job('Nissan', 'Patrol', ['FRONT BRAKE PADS']);
    const r = await scanReceipt(PHOTO());
    expect([r.expense!.orderId, r.expense!.scanned, r.job]).toEqual([undefined, true, undefined]);
    expect(r.others[0]).toEqual(await option(lc.id, 'Toyota Land Cruiser'));
    expect(await linesOf(lc.lines)).toEqual(before);
    // Cancelled: found as well.
    await removeEntry({ source: 'expense', id: r.expense!.id });
    await db.orders.update(lc.id, { stage: 'cancelled' });
    const cancelled = await scanReceipt(PHOTO());
    expect([cancelled.expense!.orderId, cancelled.others[0]?.orderId]).toEqual([undefined, lc.id]);
    // Opened over a year before the paper: not looked at.
    await db.orders.update(lc.id, { stage: 'closed', createdAt: day(400), closedAt: day(390) });
    const old = await scanReceipt(PHOTO());
    expect(old.expense!.orderId).toBeUndefined();
    expect(old.others.map((o) => o.orderId)).not.toContain(lc.id);
  });

  it('a job of a closed month is offered like any other, nothing written on it (v0.81)', async () => {
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER', 'AIR FILTER']);
    const order = (await db.orders.get(lc.id))!;
    const month = dubaiDate(order.createdAt).slice(0, 7);
    await db.orders.update(lc.id, { stage: 'closed', closedAt: order.createdAt });
    await db.customers.update(order.customerId, { lockedMonths: [month] });
    const before = await linesOf(lc.lines);
    const r = await scanReceipt(PHOTO());
    expect([r.expense!.orderId, r.expense!.scanned]).toEqual([undefined, true]);
    expect(r.others[0]?.orderId).toBe(lc.id);
    expect(r.costed).toBe(0);
    expect(await linesOf(lc.lines)).toEqual(before);
  });

  it('a contractor’s bill: in «Подрядчики», the contractor added as one; its job offered, the outsourced line not paid by it by itself (v0.81)', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'R', number: '70707' }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const line = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'FRONT BUMPER PAINT', qty: 1, unitPriceFils: 80000, outsource: { state: 'out' } });
    const before = (await db.items.get(line.id))!;
    answer = { ...base(), kind: 'service', vendor: 'SPEED PAINT SHOP', vendorPhone: '04 338 7712', vendorAddress: '', vendorTrn: '', items: [{ name: 'Bumper paint', total: 500 }], subtotal: undefined, vat: undefined, total: 500, carText: 'Patrol' };
    const r = await scanReceipt(PHOTO());
    const e = (await db.expenses.get(r.expense!.id))!;
    const cat = (await db.expenseCategories.get(e.categoryId))!;
    expect([cat.code, e.orderId, e.amountFils, e.vendor, e.scanned]).toEqual(['subcontract', undefined, 50000, 'SPEED PAINT SHOP', true]);
    const s = (await db.suppliers.get(r.supplier!.id))!;
    expect([s.service, s.phone, s.makes]).toEqual([true, '+97143387712', ['Nissan']]);
    expect(r.others[0]).toEqual(await option(o.id, 'Nissan Patrol'));
    // The outsourced line: no price, contractor or expense off the paper — as it was.
    const it = (await db.items.get(line.id))!;
    expect(it).toEqual(before);
    expect([it.outsource?.supplierId, it.outsource?.expenseId]).toEqual([undefined, undefined]);
    await notices.find((x) => x.kind === 'expense')!.undo();
    expect(await db.items.get(line.id)).toEqual(before);
    expect(await db.suppliers.get(s.id)).toBeUndefined();
    expect(await db.expenses.get(e.id)).toBeUndefined();
  });

  it('two jobs alike: both offered, the fresher one first — neither written on (v0.81); the day as read, said', async () => {
    const older = await job('Toyota', 'Corolla', ['OIL FILTER']);
    await new Promise((r) => setTimeout(r, 5));
    const fresher = await job('Toyota', 'Corolla', ['OIL FILTER']);
    const before = await linesOf([...older.lines, ...fresher.lines]);
    // A year under a stamp: today's day and month, read two years back — put right to today, said unsure. (Built from
    // today: a fixed «19-Nov-2024» became yesterday on 20/11/2026, before both jobs — and no job fitted.)
    const [y, m, d] = dubaiDate().split('-');
    const misread = `${Number(y) - 2}-${m}-${d}`;
    answer = { ...base(), carText: '', dateText: `${d}/${m}/${Number(y) - 2}`, date: misread, dateSure: false, items: [{ name: 'Oil filter', total: 35 }], subtotal: undefined, vat: undefined, total: 35 };
    const r = await scanReceipt(PHOTO());
    expect([r.job, r.expense!.orderId, r.expense!.scanned]).toEqual([undefined, undefined, true]);
    expect(r.others).toEqual([await option(fresher.id, 'Toyota Corolla'), await option(older.id, 'Toyota Corolla')]);
    expect(await linesOf([...older.lines, ...fresher.lines])).toEqual(before);
    const n = notices.find((x) => x.kind === 'expense')!;
    expect(n).toMatchObject({ close: false, dateSure: false });
    expect(n.kind === 'expense' && n.date).toBe(r.expense!.date);
    expect(r.expense!.date).toBe(dubaiDate());
  });

  it('a price already typed on a line stays; a receipt naming no job’s parts offers no job (v0.81: neither is on a job)', async () => {
    const lc = await job('Toyota', 'Land Cruiser', ['OIL FILTER']);
    await db.items.update(lc.lines[0], { costPriceFils: 3000 });
    answer = { isReceipt: true, vendor: 'X', items: [{ name: 'Oil filter', total: 40 }], total: 40, confidence: 0.9 };
    const one = await scanReceipt(PHOTO());
    expect([one.expense!.orderId, one.others[0]?.orderId]).toEqual([undefined, lc.id]);
    // A seller's name of a letter or two is not a supplier.
    expect(one.supplier).toBeUndefined();
    expect(await db.suppliers.count()).toBe(0);
    expect((await db.items.get(lc.lines[0]))!.costPriceFils).toBe(3000);
    answer = { isReceipt: true, vendor: 'Y', items: [{ name: 'Wiper blades', total: 40 }], total: 40, confidence: 0.9 };
    const two = await scanReceipt(PHOTO());
    expect([two.expense!.orderId, two.job, two.others]).toEqual([undefined, undefined, []]);
    expect(notices.filter((n) => n.kind === 'expense').map((n) => n.kind === 'expense' && !!n.job)).toEqual([false, false]);
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

  it('an expense recorded before v0.77 (its positions in its note): read as a list; its note edited — kept apart from then on', async () => {
    const cat = (await db.expenseCategories.filter((c) => c.code === 'parts').first())!;
    const old = await addExpense({ date: dubaiDate(), categoryId: cat.id, amountFils: 8400, vatFils: 400, vendor: 'Al Maroof', method: 'credit', note: '#98352 · SWITCH ON OFF 3PIN D ×2 · RELAY 12V', receipt: PHOTO(), overLimitComment: 'receipt' });
    const line = expenseEntry(old);
    expect([line.expenseNote, line.lines, line.note]).toEqual(['#98352', [{ name: 'SWITCH ON OFF 3PIN D', qty: 2 }, { name: 'RELAY 12V', qty: 1 }], 'Al Maroof · #98352 · SWITCH ON OFF 3PIN D ×2 · RELAY 12V']);
    await updateEntry({ source: 'expense', id: old.id }, { note: 'paid by Ali', lines: line.lines });
    const now = (await db.expenses.get(old.id))!;
    expect([now.note, now.lines]).toEqual(['paid by Ali', line.lines]);
    expect(expenseEntry(now).note).toBe('Al Maroof · paid by Ali · SWITCH ON OFF 3PIN D ×2 · RELAY 12V');
  });
});