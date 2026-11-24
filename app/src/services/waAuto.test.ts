import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { muteLocalWrites } from '../db/syncHooks';
import type { Order } from '../domain/types';
import { createCustomer } from './customers';
import { addItem } from './estimate';
import { approveAll } from './flow';
import { addMedia } from './media';
import { addExpense, addPayment, quickInvoice } from './money';
import { checkIn } from './orders';
import { ensureSeed } from './seed';
import { askSuppliers, readReplies, recordLinkAsk } from './waAsk';
import { saveWaAuto, sendClientReport, sendExpenseToBoss, sendWorkReport, setCustomerGroup, setWaAutoDelays, startWaAuto } from './waAuto';
import { updateExpense } from './ledger';
import type { OutItem } from './waOutbox';
import { loadChats, refreshWa, setWaTransport, type WaCallInit } from './whatsapp';
import type { WaMessage } from '../domain/whatsapp';

/*
 * What the garage's WhatsApp says by itself (v0.79), with the server's part played here: what is handed over to its
 * outbox — to whom, under which key, with which words and files. Nothing reaches WhatsApp.
 */

const WORK = { chat: '120363000000000001@g.us', name: 'Garage team' };
const BOSS = { chat: '971500000009@c.us', name: 'Boss' };
const WASH = { chat: '120363000000000002@g.us', name: 'Wash' };
const COMPANY = { chat: '120363000000000003@g.us', name: 'ABC Transport — cars' };

let out: OutItem[] = [];
let chatMsgs: Record<string, WaMessage[]> = {};
const wait = async (until: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!until() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};
const keyed = (prefix: string) => out.filter((x) => x.key.startsWith(prefix));

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  out = [];
  chatMsgs = {};
  setWaTransport(async (path: string, init: WaCallInit) => {
    if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 0 };
    if (path === 'chats') return { chats: [{ id: '55512345678901@lid', name: 'Noor Parts', group: false, phone: '971507776655', unread: 0, t: 1, archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 0 };
    if (path === 'outbox') {
      const items = (init.body as { items: OutItem[] }).items;
      const res = items.map((x) => ({ key: x.key, state: out.some((o) => o.key === x.key) ? 'queued' : 'queued' }));
      for (const x of items) if (!out.some((o) => o.key === x.key)) out.push(x);
      return { items: res };
    }
    if (path === 'messages') return { messages: chatMsgs[init.query!.chat] ?? [], more: false };
    if (path === 'number') return { ok: true, chat: '55512345678901@lid' };
    throw new Error(`not played: ${path}`);
  });
  await refreshWa();
  setWaAutoDelays({ agree: 30, checkin: 30, cover: 30, ready: 30, wash: 30 });
  startWaAuto();
});

const job = async (opts: { company?: boolean } = {}) => {
  const c = await createCustomer({ name: 'Ahmed', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'en', type: opts.company ? 'company' : 'individual', companyName: opts.company ? 'ABC Transport' : undefined });
  const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'K', number: '12345' }, make: 'Toyota', model: 'Hiace', name: c.name, phone: c.phone, docLanguage: 'en', complaint: 'Noise', arrivedNow: true });
  return { c, o };
};
const photo = (vehicleId: string) => addMedia({ ownerType: 'vehicle', ownerId: vehicleId, slot: 'cover', file: new Blob([new Uint8Array(4000)], { type: 'image/jpeg' }), compress: false });

describe('the boss', () => {
  beforeEach(() => saveWaAuto('boss', { to: BOSS, pdf: false }));

  it('an invoice, a payment, an expense — each once, under its own key', async () => {
    const { o } = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads', unitPriceFils: 40000 });
    await approveAll(o.id);
    const inv = await quickInvoice(o.id);
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 20000 });
    const cat = (await db.expenseCategories.toArray()).find((x) => x.code === 'parts')!;
    await addExpense({ date: '2026-11-24', categoryId: cat.id, amountFils: 12000, vatFils: 0, vendor: 'Al Noor Auto', method: 'cash', orderId: o.id });
    await wait(() => keyed('boss:').length >= 4);
    const boss = keyed('boss:');
    expect(boss.map((x) => x.key.split(':')[1]).sort()).toEqual(['estimate', 'expense', 'invoice', 'payment']);
    expect(boss.every((x) => x.chat === BOSS.chat)).toBe(true);
    const invoice = boss.find((x) => x.key === `boss:invoice:${inv.id}`)!;
    expect(invoice.parts[0].text).toContain(`Invoice ${inv.number}* · 420.00 AED`);
    const pay = boss.find((x) => x.key.startsWith('boss:payment:'))!;
    expect(pay.parts[0].text).toContain('Payment received* · 200.00 AED · Cash');
    expect(pay.parts[0].text).toContain('Still due: 220.00 AED');
    expect(boss.find((x) => x.key.startsWith('boss:expense:'))!.parts[0].text).toContain('120.00 AED · Cash');
  });

  it('v0.81: a scanned receipt goes to the boss by hand only, once its job is picked — the expense, its positions and photo, that job', async () => {
    const { o } = await job();
    const cat = (await db.expenseCategories.toArray()).find((x) => x.code === 'parts')!;
    const receipt = new Blob([new Uint8Array(3000)], { type: 'image/jpeg' });
    const e = await addExpense({ date: '2026-11-24', categoryId: cat.id, amountFils: 36750, vatFils: 1750, vendor: 'Gulf Star Auto Parts', method: 'cash', lines: [{ name: 'BRAKE PADS REAR', qty: 2 }, { name: 'WHEEL BEARING', qty: 1 }], receipt, scanned: true, overLimitComment: 'receipt' });
    await new Promise((r) => setTimeout(r, 300));
    // Scanned: not heard by itself — and not sent before a job is picked.
    expect(keyed('boss:expense:')).toEqual([]);
    await expect(sendExpenseToBoss(e.id)).rejects.toThrow();
    // The job picked by hand: one tap sends it — even with the boss's own reports off.
    await saveWaAuto('boss', { on: false });
    await updateExpense(e.id, { orderId: o.id, vehicleId: o.vehicleId, customerId: o.customerId });
    await sendExpenseToBoss(e.id);
    const sent = keyed('boss:expense:');
    expect(sent.map((x) => [x.key, x.chat])).toEqual([[`boss:expense:${e.id}:${o.id}`, BOSS.chat]]);
    const text = sent[0].parts[0].text!;
    expect(text).toContain('367.50 AED · Cash');
    expect(text).toContain(`Job #${o.number}`);
    expect(text).toContain('Customer: Ahmed');
    expect(text).toContain('1. BRAKE PADS REAR × 2');
    expect(text).toContain('2. WHEEL BEARING');
    expect(sent[0].parts.some((p) => !!p.media)).toBe(true);
    expect((await db.expenses.get(e.id))!.toBoss?.orderId).toBe(o.id);
  });

  it('said off: not that one; no boss — nothing', async () => {
    await saveWaAuto('boss', { payment: false });
    const { o } = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil', unitPriceFils: 10000 });
    await approveAll(o.id);
    await quickInvoice(o.id);
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 10500 });
    await wait(() => keyed('boss:invoice').length > 0);
    await new Promise((r) => setTimeout(r, 150));
    expect(keyed('boss:payment')).toEqual([]);
    await saveWaAuto('boss', { to: undefined });
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 100 });
    await new Promise((r) => setTimeout(r, 150));
    expect(keyed('boss:payment')).toEqual([]);
  });

  it('the demo, a backup, an import — nothing of them is news', async () => {
    await muteLocalWrites(async () => {
      const { o } = await job();
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil', unitPriceFils: 10000 });
      await approveAll(o.id);
      await quickInvoice(o.id);
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(out).toEqual([]);
  });
});

describe('the work group and the wash', () => {
  it('agreed: the lines to do, with the car’s photo, no prices; agreed again later: only the new ones', async () => {
    await saveWaAuto('work', { to: WORK });
    const { o } = await job();
    const v = await db.vehicles.get(o.vehicleId);
    const pic = await photo(v!.id);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads', unitPriceFils: 40000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Oil filter', qty: 2, unitPriceFils: 5000 });
    await approveAll(o.id);
    await wait(() => keyed('work:agreed').length > 0);
    const first = keyed('work:agreed')[0];
    expect(first.chat).toBe(WORK.chat);
    expect(first.parts[0].media).toBe(pic.id);
    expect(first.parts[0].caption).toContain('Agreed — to do');
    expect(first.parts[0].caption).toContain('1. BRAKE PADS\n2. OIL FILTER × 2');
    expect(first.parts[0].caption).not.toMatch(/AED|400|50\.00/);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wheel alignment', unitPriceFils: 15000 });
    await approveAll(o.id);
    await wait(() => keyed('work:added').length > 0);
    const added = keyed('work:added')[0].parts[0].caption!;
    expect(added).toContain('Added:\n1. WHEEL ALIGNMENT');
    expect(added).not.toContain('BRAKE PADS');
    expect((await db.orders.get(o.id))!.waSent?.map((x) => x.trigger)).toEqual(['agreed', 'added']);
  });

  it('a line «CAR WASH»: the car’s photo with the word — once; a washer is a part', async () => {
    await saveWaAuto('wash', { to: WASH });
    const { o } = await job();
    const pic = await photo(o.vehicleId);
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Windshield washer pump', unitPriceFils: 5000 });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Car wash', unitPriceFils: 3000 });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Car wash interior', unitPriceFils: 3000 });
    await wait(() => keyed('wash:').length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(keyed('wash:')).toEqual([{ key: `wash:${o.id}`, chat: WASH.chat, parts: [{ media: pic.id, caption: 'CAR WASH', fallback: 'CAR WASH\nToyota Hiace' }], title: expect.stringContaining('Wash') }]);
  });

  it('by hand: the job to the work group, each tap a message', async () => {
    await saveWaAuto('work', { to: WORK });
    const { o } = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Diagnostics', unitPriceFils: 10000 });
    await sendWorkReport(o.id);
    await sendWorkReport(o.id);
    expect(keyed('work:hand').length).toBe(2);
    expect(keyed('work:hand')[0].parts).toEqual([{ text: expect.stringContaining('Job #') }]);
  });
});

describe("a company's group", () => {
  it('the visit with its photo, its driver, its mileage — no prices; without a group — said so', async () => {
    const { c, o } = await job({ company: true });
    await expect(sendClientReport(o.id)).rejects.toMatchObject({ code: 'wa.err.noGroup' });
    await setCustomerGroup(c.id, COMPANY);
    await db.orders.update(o.id, { driver: { id: 'd1', name: 'Imran', phone: '' }, mileageKm: 120500 } as Partial<Order>);
    const pic = await photo(o.vehicleId);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil service', unitPriceFils: 20000 });
    await sendClientReport(o.id);
    const r = keyed('client:hand')[0];
    expect(r.chat).toBe(COMPANY.chat);
    expect(r.parts[0].media).toBe(pic.id);
    expect(r.parts[0].caption).toContain('Driver: Imran');
    expect(r.parts[0].caption).toContain('Mileage: 120,500 km');
    expect(r.parts[0].caption).toContain('• OIL SERVICE');
    expect(r.parts[0].caption).not.toMatch(/AED|200/);
  });
});

describe('suppliers', () => {
  it('asked: each picked supplier its request, by number, a pause between; kept on the job', async () => {
    const { o } = await job();
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads front', unitPriceFils: 0 });
    const filter = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Oil filter', qty: 2, unitPriceFils: 0 });
    const a = (await db.suppliers.toArray())[0] ?? (await db.suppliers.get((await db.suppliers.add({ id: uid(), name: 'Noor Parts', phone: '+971507776655' } as never)) as string))!;
    await db.suppliers.update(a.id, { phone: '+971507776655' });
    const b = await db.suppliers.add({ id: uid(), name: 'No Phone Parts' } as never);
    const sheet = new File([new Uint8Array(300)], 'diagrams-1.jpg', { type: 'image/jpeg' });
    const r = await askSuppliers(o.id, [{ supplierId: a.id }, { supplierId: b as string }], { items: [pads, filter], sheets: [sheet], usedFiles: [] });
    expect(r).toEqual({ asked: 1, noNumber: ['No Phone Parts'] });
    const ask = keyed('ask:')[0];
    expect(ask.phone).toBe('971507776655');
    expect(ask.gap).toBe(8);
    expect(ask.parts[0].text).toContain('1. BRAKE PADS FRONT\n2. OIL FILTER × 2');
    expect(ask.parts[1]).toMatchObject({ name: 'diagrams-1.jpg', mime: 'image/jpeg' });
    expect((await db.orders.get(o.id))!.asks).toMatchObject([{ supplierId: a.id, phone: '971507776655', items: [pads.id, filter.id], via: 'server' }]);
  });

  it('the answer read: its prices are the lines’ offers; as set, the cost and the customer’s price', async () => {
    await saveWaAuto('ask', { prices: 'price', prefer: 'oem' });
    const { o } = await job();
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads front', unitPriceFils: 0 });
    const filter = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Oil filter', qty: 2, unitPriceFils: 0 });
    const supId = (await db.suppliers.add({ id: uid(), name: 'Noor Parts', phone: '+971507776655' } as never)) as string;
    await recordLinkAsk(o.id, supId, [pads, filter], '*Toyota Hiace*\n\n1. BRAKE PADS FRONT\n2. OIL FILTER × 2');
    const at = Date.now() + 5000;
    chatMsgs['55512345678901@lid'] = [
      { id: 'false_55512345678901@lid_R1', chat: '55512345678901@lid', t: at, me: false, type: 'chat', text: '1. BRAKE PADS FRONT  org 180/dupl 95\n2. OIL FILTER  25x2\n+VAT', ack: 0 },
      { id: 'false_55512345678901@lid_R2', chat: '55512345678901@lid', t: at + 1000, me: false, type: 'chat', text: 'original', ack: 0 },
    ];
    await loadChats(true);
    expect(await readReplies()).toBe(2);
    const p = (await db.items.get(pads.id))!;
    expect(p.offers?.map((x) => [x.kind, x.costFils, x.supplierId === supId, !!x.unsure])).toEqual([
      ['oem', 18000, true, false],
      ['aftermarket', 9500, true, false],
    ]);
    // the original put on the line, and its price to the customer by the markup (30 %)
    expect(p.costPriceFils).toBe(18000);
    expect(p.unitPriceFils).toBe(23400);
    const f = (await db.items.get(filter.id))!;
    expect(f.offers?.map((x) => [x.kind, x.costFils, !!x.unsure])).toEqual([['oem', 2500, false]]);
    expect(f.costPriceFils).toBe(2500);
    // read once: the same messages read again change nothing
    expect(await readReplies()).toBe(0);
    expect((await db.orders.get(o.id))!.asks![0].replies?.map((x) => x.lines)).toEqual([2, 0]);
  });

  it('offers only (as by default): the line’s cost is left to the manager', async () => {
    const { o } = await job();
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads', unitPriceFils: 0 });
    const supId = (await db.suppliers.add({ id: uid(), name: 'Noor Parts', phone: '+971507776655' } as never)) as string;
    await recordLinkAsk(o.id, supId, [pads], 'BRAKE PADS');
    chatMsgs['55512345678901@lid'] = [{ id: 'false_x_R1', chat: '55512345678901@lid', t: Date.now() + 5000, me: false, type: 'chat', text: '150', ack: 0 }];
    await loadChats(true);
    expect(await readReplies()).toBe(1);
    const p = (await db.items.get(pads.id))!;
    expect(p.offers?.[0]).toMatchObject({ costFils: 15000, unsure: true, supplierId: supId });
    expect(p.costPriceFils).toBeUndefined();
  });
});
