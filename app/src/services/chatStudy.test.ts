import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { chatRole } from '../domain/whatsapp';
import type { WaChat, WaMessage } from '../domain/whatsapp';
import { setAiTransport } from './ai';
import { chatsMakes, loadChatMakes, resetChatStudy, setChatMakes, studyChats } from './chatStudy';
import { createCustomer } from './customers';
import { addItem } from './estimate';
import { checkIn } from './orders';
import { saveSupplier } from './parts';
import { ensureSeed } from './seed';
import { suppliersForJob } from './supplierRank';
import { askSuppliers } from './waAsk';
import { loadChatRoles, loadChats, loadPeople, refreshWa, setWaTransport, type WaCallInit } from './whatsapp';

/*
 * The garage's WhatsApp studied (v0.91), with the server and the AI played here — made-up chats and words only: what the
 * requests came to, who the chats are, their makes by hand, and the suppliers of a job in that light.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.now();
const T0 = NOW - 20 * DAY;

const chat = (id: string, name: string, phone: string): WaChat => ({ id, name, group: false, phone, unread: 0, t: NOW - DAY, archived: false, pinned: false, muted: false, self: false, last: null });
const FAST = chat('971501110001@c.us', 'Fast Toyota Parts', '971501110001');
const SILENT = chat('971501110002@c.us', 'Silent Spares', '971501110002');
const NEW_ONE = chat('971501110003@c.us', 'Desert Auto Spare Parts', '971501110003');
const CUSTOMER = chat('971501110004@c.us', 'Ahmed', '971501110004');
const GROUP: WaChat = { ...chat('120363000000000009@g.us', 'Team', ''), group: true };

const msg = (c: WaChat, min: number, me: boolean, text: string): WaMessage => ({ id: `${me}_${c.id}_${min}`, chat: c.id, t: T0 + min * MIN, me, type: 'chat', text, ack: 3 });
/** Four requests for Toyotas, each answered in ten minutes with a price. */
const fastTalk = [0, 1, 2, 3].flatMap((d) => [msg(FAST, d * 1440, true, '*Toyota Camry 2018*\n1. FRONT BUMPER'), msg(FAST, d * 1440 + 10, false, 'org 950 dup 400')]);
/** Four requests for Nissans: one «NA» a day later, three not answered at all. */
const silentTalk = [0, 1, 2, 3].flatMap((d) => [msg(SILENT, d * 1440, true, 'Nissan Patrol 2016 gearbox mounting price?'), ...(d === 0 ? [msg(SILENT, 600, false, 'not available')] : [])]);
const newTalk = [msg(NEW_ONE, 0, true, 'Lexus LX570 brake pads available?'), msg(NEW_ONE, 20, false, '280')];

let read: string[] = [];
let asked: { id: string; known?: string; texts: string[] }[] = [];

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  resetChatStudy(0);
  read = [];
  asked = [];
  setWaTransport(async (path: string, init: WaCallInit) => {
    if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 5, unread: 0 };
    if (path === 'chats') return { chats: [FAST, SILENT, NEW_ONE, CUSTOMER, GROUP], total: 5, unread: 0 };
    if (path === 'messages') {
      const id = init.query!.chat;
      expect(init.query!.lite).toBe('1');
      read.push(id);
      return { messages: id === FAST.id ? fastTalk : id === SILENT.id ? silentTalk : id === NEW_ONE.id ? newTalk : [], more: false };
    }
    if (path === 'outbox') return { items: ((init.body as { items: { key: string }[] }).items ?? []).map((x) => ({ key: x.key, state: 'queued' })) };
    throw new Error(`not played: ${path}`);
  });
  setAiTransport(async (p, body) => {
    if (p !== 'roles') throw new Error('not played');
    const chats = (body as { chats: { id: string; known?: string; texts: string[] }[] }).chats;
    asked.push(...chats);
    return { chats: chats.map((c) => ({ id: c.id, role: 'supplier', makes: c.id === NEW_ONE.id ? ['Lexus', 'Toyota'] : c.id === FAST.id ? ['Toyota'] : [], confidence: 0.9 })) };
  });
  await refreshWa();
  await loadChats(true);
  // The garage's own: a customer by his number, and two suppliers of the base (no makes on their cards).
  await createCustomer({ name: 'Ahmed', phone: '+971501110004', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
  await saveSupplier({ name: 'Fast Toyota Parts', phone: '+971501110001' });
  await saveSupplier({ name: 'Silent Spares', phone: '+971501110002' });
});

describe('studying the chats (v0.91)', () => {
  it('reads every chat that is or may be a supplier, keeps what its requests came to, asks the AI what nobody knows — once', async () => {
    const r = await studyChats();
    // The customer's chat and the group are not read.
    expect(read.sort()).toEqual([FAST.id, SILENT.id, NEW_ONE.id].sort());
    expect(r.studied).toBe(3);
    const fast = await db.chatFacts.get(FAST.id);
    expect(fast?.turns).toHaveLength(4);
    expect(fast?.turns?.every((x) => x.r === 600 && x.p === 1)).toBe(true);
    const silent = await db.chatFacts.get(SILENT.id);
    expect(silent?.turns?.filter((x) => x.r !== undefined)).toHaveLength(1);
    // The AI: the unknown chat (who and makes), the suppliers of the base without makes (makes only), with their words.
    expect(asked.map((a) => a.id).sort()).toEqual([FAST.id, SILENT.id, NEW_ONE.id].sort());
    expect(asked.find((a) => a.id === FAST.id)?.known).toBe('supplier');
    expect(asked.find((a) => a.id === NEW_ONE.id)?.known).toBeUndefined();
    expect(asked.find((a) => a.id === NEW_ONE.id)?.texts.join(' ')).toContain('280');
    const neu = await db.chatFacts.get(NEW_ONE.id);
    expect(neu?.aiRole).toBe('supplier');
    expect(neu?.aiMakes).toEqual(['Lexus', 'Toyota']);
    expect(fast?.aiRole ?? (await db.chatFacts.get(FAST.id))?.aiRole).toBeUndefined();
    const [people, roles] = await Promise.all([loadPeople(), loadChatRoles()]);
    expect(chatRole(NEW_ONE, people, roles)).toBe('supplier');
    // Again: nothing new in the chats — nothing read, nobody asked.
    read = [];
    const asks = asked.length;
    await studyChats();
    expect(read).toEqual([]);
    expect(asked.length).toBe(asks);
  });

  it('the suppliers of a job: the fast one first, the silent one after; one only in WhatsApp listed and asked', async () => {
    await studyChats();
    const c = await createCustomer({ name: 'Omar', phone: '+971509998877', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'A', number: '11111' }, make: 'Toyota', model: 'Camry', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
    const part = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BUMPER', qty: 1 });
    const data = (await suppliersForJob(o.id, 'en'))!;
    const names = data.parts.map((r) => r.supplier.name);
    expect(names.indexOf('Fast Toyota Parts')).toBeLessThan(names.indexOf('Silent Spares'));
    const fast = data.parts.find((r) => r.supplier.name === 'Fast Toyota Parts')!;
    expect(fast.why.some((w) => w.kind === 'answers' && w.make === 'Toyota')).toBe(true);
    expect(fast.know?.rating?.score).toBeGreaterThan(0);
    expect(data.parts.find((r) => r.supplier.name === 'Silent Spares')!.know?.rating?.score).toBeLessThan(0);
    // Only in WhatsApp: listed (the AI said «supplier»), under the chat's name.
    const only = data.parts.find((r) => r.chat === NEW_ONE.id)!;
    expect(only.supplier.id).toBe(`wa:${NEW_ONE.id}`);
    expect(only.supplier.name).toBe('Desert Auto Spare Parts');
    // Asked: of the base now, the request kept under it.
    const res = await askSuppliers(o.id, [{ supplierId: only.supplier.id }], { items: [part], sheets: [], usedFiles: [] });
    expect(res.asked).toBe(1);
    const made = (await db.suppliers.toArray()).find((s) => s.phone === '+971501110003')!;
    expect(made.name).toBe('Desert Auto Spare Parts');
    expect((await db.orders.get(o.id))!.asks?.[0].supplierId).toBe(made.id);
    // Once of the base, it is no longer listed twice.
    const again = (await suppliersForJob(o.id, 'en'))!;
    expect(again.parts.filter((r) => r.supplier.name === 'Desert Auto Spare Parts')).toHaveLength(1);
  });

  it('makes by hand to several chats: a supplier of the base on its card, another chat on its record; one taken off', async () => {
    await studyChats();
    expect(await setChatMakes([FAST, NEW_ONE], ['Toyota', 'Lexus'], [])).toBe(2);
    const fast = (await db.suppliers.toArray()).find((s) => s.phone === '+971501110001')!;
    expect(fast.makes).toEqual(['Toyota', 'Lexus']);
    expect((await db.chatFacts.get(NEW_ONE.id))?.makes).toEqual(['Toyota', 'Lexus']);
    expect(await chatsMakes([FAST, NEW_ONE])).toEqual({ all: ['Toyota', 'Lexus'], common: ['Toyota', 'Lexus'] });
    // Lexus taken off both; Toyota stays.
    await setChatMakes([FAST, NEW_ONE], ['Toyota'], ['Toyota', 'Lexus']);
    expect((await db.suppliers.get(fast.id))!.makes).toEqual(['Toyota']);
    const makes = await loadChatMakes();
    expect(makes.byPhone.get('971501110001')).toEqual([{ make: 'Toyota', by: 'hand' }]);
    expect(makes.byChat.get(NEW_ONE.id)).toEqual([{ make: 'Toyota', by: 'hand' }]);
    // Silent Spares: what it was asked for and answered once («NA» counts as an answer) — Nissan.
    expect(makes.byPhone.get('971501110002')?.[0]).toMatchObject({ make: 'Nissan', by: 'seen' });
  });
});
