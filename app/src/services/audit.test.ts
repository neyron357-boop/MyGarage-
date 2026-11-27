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
