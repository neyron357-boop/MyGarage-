import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { byPosition } from '../domain/items';
import { optionItems } from '../domain/quoteOptions';
import { requestPlan } from '../domain/waRequest';
import { ensureSeed } from './seed';
import { considerChat, makeRequestJob } from './waRequest';
import { setAiTransport } from './ai';
import { setClaimTransport } from './claim';
import { mulkiyaOf } from './cover';
import { saveSettings } from './settings';
import { refreshWa, setWaTransport, type WaCallInit } from './whatsapp';
import type { WaMessage } from '../domain/whatsapp';

/* v0.90, #69: a customer's request in WhatsApp — a job of «Заявки» with its lines, the labour charge and two options. */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

const plan = (number = '12345') =>
  requestPlan({
    isRequest: true,
    car: { make: 'Nissan', model: 'Altima', year: 2015, plate: { emirate: 'DXB', code: 'V', number } },
    items: [{ name: 'Engine mount', kind: 'part', both: true }],
    owner: 'Sam Lee',
    confidence: 0.9,
  })!;
const chat = { id: '971500000001@c.us', name: 'Someone', phone: '971500000001' };

describe('a job made of a WhatsApp request', () => {
  it('in «Заявки», the car booked, original and copy as two lines and two options, the labour charge in both', async () => {
    const made = (await makeRequestJob(plan(), chat, true, 'I want to change the engine mount', 'false_x_AAA'))!;
    const order = (await db.orders.get(made.orderId))!;
    expect([order.stage, order.boardTab, order.fromChat?.msg, order.complaint]).toEqual(['booked', 'request', 'false_x_AAA', 'I want to change the engine mount']);
    const vehicle = (await db.vehicles.get(order.vehicleId))!;
    expect([vehicle.make, vehicle.model, vehicle.year, vehicle.plate.number]).toEqual(['Nissan', 'Altima', 2015, '12345']);
    // Forwarded: the car's owner is whom the messages name — not the one who passed them on.
    const customer = (await db.customers.get(order.customerId))!;
    expect([customer.name, customer.phone]).toEqual(['Sam Lee', '']);
    const items = (await db.items.where('orderId').equals(order.id).toArray()).sort(byPosition);
    expect(items.map((i) => i.titleEn)).toEqual(['ENGINE MOUNT ORIGINAL', 'ENGINE MOUNT AFTERMARKET', 'LABOUR CHARGES: ENGINE MOUNT']);
    const [a, b] = order.quoteOptions!;
    expect([a.name, b.name]).toEqual(['Original', 'Aftermarket']);
    expect(optionItems(items, a).map((i) => i.titleEn)).toEqual(['ENGINE MOUNT ORIGINAL', items[2].titleEn]);
    expect(optionItems(items, b).map((i) => i.titleEn)).toEqual(['ENGINE MOUNT AFTERMARKET', items[2].titleEn]);
    // The same messages looked at again — not a second job.
    expect(await makeRequestJob(plan(), chat, true, '', 'false_x_AAA')).toBeUndefined();
  });

  it('the chat’s own request: its person is the customer (by number); no plate — no job', async () => {
    const made = (await makeRequestJob(plan('54321'), chat, false, 'brakes', 'false_x_BBB'))!;
    const customer = (await db.customers.get((await db.orders.get(made.orderId))!.customerId))!;
    expect([customer.name, customer.phone]).toEqual(['Someone', '+971500000001']);
    expect(await makeRequestJob({ ...plan(), plate: undefined }, chat, false, '', 'false_x_CCC')).toBeUndefined();
  });

  it('v0.98: the same car again — its open job takes the new lines (not a second job); the words a note; the registration card its Mulkiya', async () => {
    const card = new Blob([new Uint8Array(3000)], { type: 'image/jpeg' });
    const made = (await makeRequestJob(plan(), chat, true, 'Engine mount noise', 'false_x_D1', card))!;
    expect((await mulkiyaOf((await db.orders.get(made.orderId))!.vehicleId)).mulkiya).toBeTruthy();
    const more = requestPlan({ isRequest: true, car: { make: 'Nissan', model: 'Altima', plate: { emirate: 'DXB', code: 'V', number: '12345' } }, items: [{ name: 'Front brake pads', kind: 'part' }, { name: 'Engine mount original', kind: 'part' }], confidence: 0.9 })!;
    const again = (await makeRequestJob(more, chat, true, 'Also the brakes', 'false_x_D2'))!;
    expect([again.orderId, again.merged, again.added]).toEqual([made.orderId, true, 1]);
    const titles = (await db.items.where('orderId').equals(made.orderId).toArray()).map((i) => i.titleEn);
    expect(titles.filter((x) => x === 'FRONT BRAKE PADS')).toHaveLength(1);
    expect(titles.filter((x) => x === 'ENGINE MOUNT ORIGINAL')).toHaveLength(1);
    const notes = await db.notes.where('orderId').equals(made.orderId).toArray();
    expect(notes.map((n) => n.text)).toEqual(['WhatsApp: Also the brakes']);
    expect(await db.orders.where('vehicleId').equals((await db.orders.get(made.orderId))!.vehicleId).count()).toBe(1);
  });

  it('v0.98: the boss’s chat — a forward and a voice note make a job on whichever device claims it first; claimed by another — nothing', async () => {
    const BOSS = '971500000009@c.us';
    let msgs: WaMessage[] = [];
    setWaTransport(async (path: string, init: WaCallInit) => {
      if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 0 };
      if (path === 'chats') return { chats: [{ id: BOSS, name: 'Boss', group: false, phone: '971500000009', unread: 2, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 2 };
      if (path === 'messages') return { messages: init.query?.chat === BOSS ? msgs : [], more: false };
      throw new Error('not played: ' + path);
    });
    await saveSettings({ waChatTags: { [BOSS]: 'work' } } as never);
    await refreshWa();
    const { loadChats } = await import('./whatsapp');
    await loadChats(true);
    const asked: string[] = [];
    setAiTransport(async (path, body) => {
      asked.push(path);
      if (path === 'voice') return { text: 'Он просит поменять передние колодки', english: 'He asks to change the front brake pads', from: 'ru' };
      if (path === 'request') {
        const texts = (body as { texts: string[] }).texts;
        expect(texts.some((x) => x.startsWith('[fwd] '))).toBe(true);
        expect(texts.some((x) => x.startsWith('[voice] He asks'))).toBe(true);
        return { isRequest: true, car: { make: 'Toyota', model: 'Camry', year: 2019, plate: { emirate: 'DXB', code: 'K', number: '55555' } }, items: [{ name: 'Front brake pads', kind: 'part' }], owner: 'Omar', picture: '', confidence: 0.9 };
      }
      throw new Error('not played: ' + path);
    });
    let claims = true;
    setClaimTransport(async () => claims);
    const now = Date.now();
    msgs = [
      { id: 'false_b_1', chat: BOSS, t: now - 120_000, me: false, type: 'chat', text: 'My Toyota Camry DXB K 55555 makes noise when braking', ack: 0, fwd: true } as WaMessage,
      { id: 'false_b_2', chat: BOSS, t: now - 60_000, me: false, type: 'ptt', text: '', ack: 0, file: { sec: 12 } } as WaMessage,
    ];
    await considerChat(BOSS);
    const made = (await db.orders.toArray()).find((o) => o.fromChat?.chat === BOSS)!;
    expect(made).toBeTruthy();
    expect(made.boardTab).toBe('request');
    expect((await db.customers.get(made.customerId))!.name).toBe('Omar');
    expect((await db.items.where('orderId').equals(made.id).toArray()).map((i) => i.titleEn)).toContain('FRONT BRAKE PADS');
    expect(made.complaint).toContain('🎤 He asks to change the front brake pads');
    // Another device claimed the next burst: this one asks nobody and makes nothing.
    claims = false;
    asked.length = 0;
    msgs = [...msgs, { id: 'false_b_3', chat: BOSS, t: now, me: false, type: 'chat', text: 'Nissan Patrol DXB A 77777 needs AC service', ack: 0, fwd: true } as WaMessage];
    await considerChat(BOSS);
    expect(asked).toEqual([]);
    expect((await db.orders.toArray()).filter((o) => o.fromChat?.chat === BOSS)).toHaveLength(1);
    setAiTransport(undefined);
    setClaimTransport(undefined);
    setWaTransport(undefined);
  });

  it('v1.03: the next piece of the conversation («also the oil filter», no car) goes onto the job just made — looked at with the messages before it', async () => {
    // The device's storage (what was looked at is kept there).
    const kept = new Map<string, string>();
    const was = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    try {
      const BOSS = '971500000009@c.us';
      let msgs: WaMessage[] = [];
      setWaTransport(async (path: string, init: WaCallInit) => {
        if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 0 };
        if (path === 'chats') return { chats: [{ id: BOSS, name: 'Boss', group: false, phone: '971500000009', unread: 2, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 2 };
        if (path === 'messages') return { messages: init.query?.chat === BOSS ? msgs : [], more: false };
        throw new Error('not played: ' + path);
      });
      await saveSettings({ waChatTags: { [BOSS]: 'work' } } as never);
      await refreshWa();
      const { loadChats } = await import('./whatsapp');
      await loadChats(true);
      const asked: { path: string; texts?: string[] }[] = [];
      setAiTransport(async (path, body) => {
        asked.push({ path, texts: (body as { texts?: string[] }).texts });
        if (path === 'voice') return { text: 'Колодки передние', english: 'Front brake pads', from: 'ru' };
        if (path === 'request') {
          const texts = (body as { texts: string[] }).texts;
          const more = texts.some((x) => /oil filter/i.test(x));
          return { isRequest: true, car: { make: 'Toyota', model: 'Camry', plate: { emirate: 'DXB', code: 'K', number: '55555' } }, items: [{ name: 'Front brake pads', kind: 'part' }, ...(more ? [{ name: 'Oil filter', kind: 'part' as const }] : [])], owner: 'Omar', picture: '', confidence: 0.9 };
        }
        throw new Error('not played: ' + path);
      });
      setClaimTransport(async () => true);
      const now = Date.now();
      msgs = [
        { id: 'false_c_1', chat: BOSS, t: now - 60_000, me: false, type: 'chat', text: 'My Toyota Camry DXB K 55555 makes noise when braking', ack: 0, fwd: true } as WaMessage,
        { id: 'false_c_2', chat: BOSS, t: now - 50_000, me: false, type: 'ptt', text: '', ack: 0, file: { sec: 8 } } as WaMessage,
      ];
      await considerChat(BOSS);
      const made = (await db.orders.toArray()).find((o) => o.fromChat?.chat === BOSS)!;
      expect(made).toBeTruthy();
      // Thirty seconds later: more work, no car named.
      asked.length = 0;
      msgs = [...msgs, { id: 'false_c_3', chat: BOSS, t: now - 20_000, me: false, type: 'chat', text: 'Also change the oil filter', ack: 0 } as WaMessage];
      await considerChat(BOSS);
      // Asked once more, with the messages before (the voice note not heard again).
      expect(asked.map((a) => a.path)).toEqual(['request']);
      expect(asked[0].texts?.[0]).toMatch(/^\[fwd\] My Toyota Camry/);
      expect(asked[0].texts?.at(-1)).toBe('Also change the oil filter');
      const titles = (await db.items.where('orderId').equals(made.id).toArray()).map((i) => i.titleEn);
      expect(titles.filter((x) => x === 'OIL FILTER')).toHaveLength(1);
      expect(titles.filter((x) => x === 'FRONT BRAKE PADS')).toHaveLength(1);
      expect((await db.orders.toArray()).filter((o) => o.fromChat?.chat === BOSS)).toHaveLength(1);
      expect((await db.notes.where('orderId').equals(made.id).toArray()).map((n) => n.text)).toEqual(['WhatsApp: Also change the oil filter']);
      // «Thanks» after it — nothing asked.
      asked.length = 0;
      msgs = [...msgs, { id: 'false_c_4', chat: BOSS, t: now, me: false, type: 'chat', text: 'thanks', ack: 0 } as WaMessage];
      await considerChat(BOSS);
      expect(asked).toEqual([]);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = was;
      setAiTransport(undefined);
      setClaimTransport(undefined);
      setWaTransport(undefined);
    }
  });
});
