import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { byPosition } from '../domain/items';
import { createCustomer } from './customers';
import { addItem, addTemplate, sendVersion } from './estimate';
import { acceptCustomerAnswer, customerAnswerOf, dismissCustomerAnswer } from './customerReply';
import { refreshWa, setWaTransport, type WaCallInit } from './whatsapp';
import { orderFromSupplier } from './supplierOrder';
import { saveWaAuto, sendAsked } from './waAuto';
import { waAsks } from './waConfirm';
import type { OutItem } from './waOutbox';
import { dayFacts, sendDailySummary } from './dailySummary';
import { checkIn } from './orders';
import { ensureSeed } from './seed';
import { setAiTransport } from './ai';
import { quickInvoice } from './money';
import { acceptPaymentShot, dismissPaymentShot, paymentShotOf } from './paymentShot';
import { proofsOf } from './proofs';
import { markCustomerDone, writeAllToday } from './todayBatch';
import { loadPast, tasksFor } from './today';
import { setMulkiyaExpiry } from './mulkiya';
import { dubaiDate, shiftDay } from '../domain/dates';

/* The audit of 27/11/2026 (docs: «Аудит MyGarage»): what was ready in the code but not on the job, now on it. */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

const job = async () => {
  const c = await createCustomer({ name: 'Ahmed', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
  const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'K', number: '12345' }, make: 'Toyota', model: 'Camry', name: c.name, phone: c.phone, docLanguage: 'en', complaint: 'Service', arrivedNow: true });
  return { c, o };
};

describe('job templates on the job', () => {
  it('a template adds its lines; a price from the history wins over the template’s figure; no second labour charge', async () => {
    const { o } = await job();
    const tpl = (await db.jobTemplates.toArray()).find((t) => t.code === 'oil_service')!;
    const lines = await addTemplate(o.id, tpl.id, 'A', [{ unitPriceFils: 9500 }, { unitPriceFils: 0 }]);
    expect(lines).toHaveLength(tpl.items.length);
    const items = (await db.items.where('orderId').equals(o.id).toArray()).sort(byPosition);
    // The template's own work carries the labour: the app adds none of its own.
    expect(items.filter((i) => i.autoLabour)).toHaveLength(0);
    expect(items).toHaveLength(tpl.items.length);
    const work = items.find((i) => i.kind === 'labor')!;
    expect(work.unitPriceFils).toBe(9500);
    // No price from the history: the template's own.
    const oil = items.find((i) => i.titleEn?.includes('ENGINE OIL'))!;
    expect(oil.unitPriceFils).toBe(tpl.items[1].unitPriceFils);
    expect(items.every((i) => i.templateId === tpl.id)).toBe(true);
  });
});

describe('the customer’s answer in WhatsApp → a proposal on the job', () => {
  it('«only pads» after the quote: pads agreed, discs refused — by the manager’s tap, the words kept; × — not again', async () => {
    const { o } = await job();
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 20000 });
    const discs = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE DISCS', qty: 1, unitPriceFils: 36000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    let words = 'only pads please';
    setWaTransport(async (path: string) => {
      if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 0 };
      if (path === 'chats') return { chats: [{ id: '971501234567@c.us', name: 'Ahmed', group: false, phone: '971501234567', unread: 1, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 1 };
      if (path === 'messages') return { messages: [{ id: 'm-' + words.length, chat: '971501234567@c.us', t: Date.now() + 1000, me: false, type: 'chat', text: words, ack: 0 }], more: false };
      if (path === 'number') return { ok: true, chat: '971501234567@c.us' };
      throw new Error('not played: ' + path);
    });
    await refreshWa();
    const p = await customerAnswerOf(o.id);
    expect(p).toMatchObject({ answer: { kind: 'some' }, agree: [pads.id], refuse: [discs.id] });
    await acceptCustomerAnswer(p!);
    expect((await db.items.get(pads.id))!.approvalState).toBe('approved');
    expect((await db.items.get(discs.id))!.approvalState).toBe('declined');
    const notes = (await db.decisions.where('orderId').equals(o.id).toArray()).map((d) => d.note);
    expect(notes.every((n) => n?.includes('«only pads please»'))).toBe(true);
    // Answered: nothing more to propose.
    expect(await customerAnswerOf(o.id)).toBeUndefined();
    // A question proposes nothing; × keeps a message from coming back.
    const more = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'WIPER BLADES', qty: 1, unitPriceFils: 5000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    words = 'how much for wipers?';
    expect(await customerAnswerOf(o.id)).toBeUndefined();
    words = 'ok';
    const yes = await customerAnswerOf(o.id);
    expect(yes).toMatchObject({ answer: { kind: 'all' }, agree: [more.id] });
    await dismissCustomerAnswer(o.id, yes!.msgId);
    expect(await customerAnswerOf(o.id)).toBeUndefined();
    setWaTransport(undefined);
  });
});

describe('«Заказать» — an order to a supplier', () => {
  it('one message with the parts as offered; the lines «заказано» at that price only once it went', async () => {
    const { o } = await job();
    const supId = (await db.suppliers.add({ id: uid(), name: 'Noor Parts', phone: '+971507776655' } as never)) as string;
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 30000 });
    await db.items.update(pads.id, { offers: [{ id: 'of1', kind: 'oem', costFils: 18000, supplierId: supId }] });
    const sent: OutItem[] = [];
    setWaTransport(async (path: string, init: WaCallInit) => {
      if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 0, unread: 0 };
      if (path === 'chats') return { chats: [], total: 0, unread: 0 };
      if (path === 'outbox') {
        const items = (init.body as { items: OutItem[] }).items;
        sent.push(...items);
        return { items: items.map((x) => ({ key: x.key, state: 'queued' })) };
      }
      throw new Error('not played: ' + path);
    });
    await refreshWa();
    await orderFromSupplier(o.id, supId, [{ itemId: pads.id, offerId: 'of1' }], { by: 'pickup', at: 'today at 17:00', expectedAt: '2026-11-27T13:00:00.000Z' });
    // Waiting for «Отправить»: nothing ordered yet, nothing handed to the server.
    expect((await db.items.get(pads.id))!.procurementStatus ?? 'needed').toBe('needed');
    expect(sent).toHaveLength(0);
    const asks = waAsks();
    expect(asks[0].item.parts[0].text).toContain('1. FRONT BRAKE PADS (original) — 180.00 AED');
    await sendAsked(asks);
    expect(sent).toHaveLength(1);
    expect((sent[0] as { buy?: unknown }).buy).toBeUndefined();
    const after = (await db.items.get(pads.id))!;
    expect([after.procurementStatus, after.supplierId, after.costPriceFils, after.expectedAt]).toEqual(['ordered', supId, 18000, '2026-11-27T13:00:00.000Z']);
    setWaTransport(undefined);
  });
});

describe('the owner’s summary of the day', () => {
  it('made of the day’s own numbers; to the boss’s chat through «Проверить и отправить»; not without a boss chat', async () => {
    const { o } = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'OIL CHANGE', qty: 1, unitPriceFils: 10000 });
    const f = await dayFacts();
    expect(f.carsIn).toBe(1);
    expect(f.onBoard).toBe(1);
    expect(await sendDailySummary()).toBe(false);
    await saveWaAuto('boss', { to: { chat: '971500000099@c.us', name: 'Boss' } });
    setWaTransport(async (path: string) => {
      if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 0, unread: 0 };
      if (path === 'chats') return { chats: [], total: 0, unread: 0 };
      throw new Error('not played: ' + path);
    });
    await refreshWa();
    expect(await sendDailySummary()).toBe(true);
    const asks = waAsks();
    expect(asks.at(-1)!.item.key).toMatch(/^boss:daily:\d{4}-\d{2}-\d{2}$/);
    expect(asks.at(-1)!.item.parts[0].text).toContain('🚗');
    setWaTransport(undefined);
  });
});

describe('a payment from the customer’s screenshot', () => {
  it('a transfer screenshot after the invoice → a proposal; the tap records it with the picture as proof; × — not again', async () => {
    const { o } = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'BRAKE SERVICE', qty: 1, unitPriceFils: 125_000 });
    await quickInvoice(o.id);
    const shots = [{ id: 'S1', type: 'image', amount: 1312.5, isPayment: true }];
    const asked: string[] = [];
    setAiTransport(async (path, body) => {
      if (path !== 'payment') throw new Error('not played: ' + path);
      const id = (body as { id: string }).id;
      asked.push(id);
      const s = shots.find((x) => x.id === id)!;
      return { isPayment: s.isPayment, amount: s.amount, currency: 'AED', date: '', reference: 'FT77', bank: 'ENBD', confidence: 0.9 };
    });
    setWaTransport(
      async (path: string) => {
        if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 0 };
        if (path === 'chats') return { chats: [{ id: '971501234567@c.us', name: 'Ahmed', group: false, phone: '971501234567', unread: 1, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 1 };
        if (path === 'messages') return { messages: shots.map((x, k) => ({ id: x.id, chat: '971501234567@c.us', t: Date.now() + 1000 + k, me: false, type: x.type, text: '', ack: 0, file: { mime: 'image/jpeg' } })), more: false };
        if (path === 'number') return { ok: true, chat: '971501234567@c.us' };
        throw new Error('not played: ' + path);
      },
      () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
    );
    await refreshWa();
    const p = await paymentShotOf(o.id);
    expect(p).toMatchObject({ amountFils: 131_250, method: 'transfer', reference: 'ENBD · FT77', dueFils: 131_250 });
    // Asked once: read again — from memory.
    await paymentShotOf(o.id);
    expect(asked).toEqual(['S1']);
    const r = await acceptPaymentShot(p!);
    expect(r).toEqual({ amountFils: 131_250, paidFull: true });
    const pays = await db.payments.where('orderId').equals(o.id).toArray();
    expect(pays.map((x) => [x.method, x.amountFils, x.reference])).toEqual([['transfer', 131_250, 'ENBD · FT77']]);
    expect(await proofsOf(pays[0].id)).toHaveLength(1);
    // Paid: nothing more to propose.
    expect(await paymentShotOf(o.id)).toBeUndefined();
    setAiTransport(undefined);
    setWaTransport(undefined);
  });

  it('a picture that is not a payment proposes nothing (and is not asked about again); × keeps a payment from coming back', async () => {
    const { o } = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'AC SERVICE', qty: 1, unitPriceFils: 30_000 });
    await quickInvoice(o.id);
    let shot = { id: 'N1', isPayment: false, amount: 0 };
    const asked: string[] = [];
    setAiTransport(async (_path, body) => {
      asked.push((body as { id: string }).id);
      return { isPayment: shot.isPayment, amount: shot.amount, currency: 'AED', confidence: 0.9 };
    });
    setWaTransport(async (path: string) => {
      if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 0 };
      if (path === 'chats') return { chats: [{ id: '971501234567@c.us', name: 'Ahmed', group: false, phone: '971501234567', unread: 1, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 1 };
      if (path === 'messages') return { messages: [{ id: shot.id, chat: '971501234567@c.us', t: Date.now() + 1000, me: false, type: 'image', text: '', ack: 0 }], more: false };
      if (path === 'number') return { ok: true, chat: '971501234567@c.us' };
      throw new Error('not played: ' + path);
    });
    await refreshWa();
    expect(await paymentShotOf(o.id)).toBeUndefined();
    expect(await paymentShotOf(o.id)).toBeUndefined();
    expect(asked).toEqual(['N1']);
    shot = { id: 'N2', isPayment: true, amount: 300 };
    const p = await paymentShotOf(o.id);
    expect(p?.amountFils).toBe(30_000); // 315.00 due: the screenshot’s 300 — a part
    await dismissPaymentShot(o.id, p!.msgId);
    expect(await paymentShotOf(o.id)).toBeUndefined();
    expect(await db.payments.where('orderId').equals(o.id).count()).toBe(0);
    setAiTransport(undefined);
    setWaTransport(undefined);
  });
});

describe('the morning’s customer messages in one go', () => {
  it('all to «Проверить и отправить»; what went leaves «Сегодня» and is in the customer’s messages; what was taken off stays', async () => {
    const a = await job();
    const b = a;
    const sent: OutItem[] = [];
    setWaTransport(async (path: string, init: WaCallInit) => {
      if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 0, unread: 0 };
      if (path === 'chats') return { chats: [], total: 0, unread: 0 };
      if (path === 'outbox') {
        const items = (init.body as { items: OutItem[] }).items;
        sent.push(...items);
        return { items: items.map((x) => ({ key: x.key, state: 'queued' })) };
      }
      throw new Error('not played: ' + path);
    });
    await refreshWa();
    const task = (o: typeof a.o, kind: 'followUp' | 'declined') => ({ kind, key: kind + ':' + o.id, orderId: o.id, vehicleId: o.vehicleId, customerId: o.customerId, at: o.createdAt, late: false });
    const n = await writeAllToday(
      [
        { task: task(a.o, 'followUp'), phone: '050 123 4567', text: 'Hello Ahmed! How is your Toyota Camry?', template: 'followUp', lang: 'en', title: 'Ahmed · Toyota Camry' },
        { task: task(b.o, 'declined'), phone: '050 123 4567', text: 'Last time: brake discs.', template: 'declinedOffer', lang: 'en', title: 'Ahmed · Toyota Camry' },
        { task: task(b.o, 'followUp'), phone: '', text: 'No number — not in it', template: 'followUp', lang: 'en', title: '' },
      ],
      '2026-11-27',
    );
    expect(n).toBe(2);
    expect(sent).toHaveLength(0);
    const asks = waAsks().filter((x) => x.item.key.startsWith('today:'));
    expect(asks.map((x) => x.item.key)).toEqual([`today:followUp:${a.o.id}:2026-11-27`, `today:declined:${b.o.id}:2026-11-27`]);
    // The second taken off in the review: only the first goes.
    await sendAsked(asks.slice(0, 1));
    expect(sent).toHaveLength(1);
    expect((sent[0] as { today?: unknown }).today).toBeUndefined();
    expect(sent[0].phone).toBe('971501234567');
    expect((await db.orders.get(a.o.id))!.followedUpAt).toBeTruthy();
    expect((await db.orders.get(b.o.id))!.declinedOfferedAt).toBeUndefined();
    const msgs = await db.messages.where('customerId').equals(a.o.customerId).toArray();
    expect(msgs.map((m) => [m.template, m.text, m.channel])).toEqual([['followUp', 'Hello Ahmed! How is your Toyota Camry?', 'whatsapp']]);
    setWaTransport(undefined);
  });
});

describe('the oil service by the mileage; the Mulkiya’s expiry — through «Сегодня»', () => {
  it('a car that runs fast is called for its service before half a year; its Mulkiya two weeks before it runs out', async () => {
    const { c, o } = await job();
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    await db.orders.update(o.id, { stage: 'closed', outcome: 'completed', arrivedAt: ago(160), createdAt: ago(160), closedAt: ago(160), mileageKm: 100_000 });
    const second = await checkIn({ vehicleId: o.vehicleId, customerId: c.id, plate: { emirate: 'DXB', code: 'K', number: '12345' }, make: 'Toyota', model: 'Camry', name: c.name, phone: c.phone, docLanguage: 'en', complaint: 'Service', arrivedNow: true });
    const oil = await addItem(second.id, { kind: 'part', block: 'A', titleEn: 'ENGINE OIL 5W30', qty: 1, unitPriceFils: 15000 });
    await db.items.update(oil.id, { approvalState: 'approved' });
    await db.orders.update(second.id, { stage: 'closed', outcome: 'completed', arrivedAt: ago(50), createdAt: ago(50), closedAt: ago(50), mileageKm: 125_000 });
    const service = tasksFor([], await loadPast()).find((x) => x.kind === 'service');
    // 25 000 km in 110 days — ~227 a day: its 10 000 km came up after ~44 days, long before half a year.
    expect(service).toMatchObject({ vehicleId: o.vehicleId, kmAt: 125_000 });
    expect(service!.kmNow).toBeGreaterThan(135_000);
    // The Mulkiya set by hand to run out in ten days: told; once told, not again for that day.
    await setMulkiyaExpiry(o.vehicleId, shiftDay(dubaiDate(), 10));
    const mulkiya = tasksFor([], await loadPast()).find((x) => x.kind === 'mulkiya');
    expect(mulkiya).toMatchObject({ vehicleId: o.vehicleId, expires: shiftDay(dubaiDate(), 10) });
    await markCustomerDone(mulkiya!);
    expect(tasksFor([], await loadPast()).some((x) => x.kind === 'mulkiya')).toBe(false);
    expect((await db.vehicles.get(o.vehicleId))!.regFrom).toBe('hand');
  });
});
