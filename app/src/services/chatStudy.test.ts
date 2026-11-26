import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { chatRole, filterChats } from '../domain/whatsapp';
import type { WaChat, WaMessage } from '../domain/whatsapp';
import { setAiTransport } from './ai';
import { chatsMakes, loadChatMakes, olderFromPhone, phoneHistoryChats, resetChatStudy, setChatMakes, setChatPin, studyChats } from './chatStudy';
import { SyncError } from './sync/api';
import { createCustomer } from './customers';
import { addItem } from './estimate';
import { checkIn } from './orders';
import { saveSupplier } from './parts';
import { ensureSeed } from './seed';
import { loadTop, suppliersForJob, suppliersRanked } from './supplierRank';
import { askSuppliers } from './waAsk';
import { loadChatRoles, loadChats, loadPeople, refreshWa, setWaTransport, tagChats, type WaCallInit } from './whatsapp';

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
/** Read deep (v0.91.1): the chats asked of `/history`. */
let deepRead: string[] = [];
let asked: { id: string; known?: string; texts: string[] }[] = [];
/** WhatsApp's word on each chat's older messages (0 — more on the phone, 2 — not given to this device, 1 — none). */
let ends: Record<string, number> = {};
/** What the phone sends when asked (older requests of a chat); its answer per chat. */
let onPhone: Record<string, WaMessage[]> = {};
let phoneSays: Record<string, 'ok' | 'none' | 'failed'> = {};
let phoneAsked: string[] = [];
/** A server from before v0.91.1: no `/history`. */
let oldServer = false;
/** More chats of a test of its own, their talk, and what the AI says of a chat (else «supplier», 0.9). */
let extra: WaChat[] = [];
let extraTalk: Record<string, WaMessage[]> = {};
let aiSays: Record<string, { role: string; confidence: number }> = {};
const talkOf = (id: string) => (id === FAST.id ? fastTalk : id === SILENT.id ? silentTalk : id === NEW_ONE.id ? newTalk : (extraTalk[id] ?? []));

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  resetChatStudy(0);
  read = [];
  deepRead = [];
  asked = [];
  ends = { [FAST.id]: 0, [SILENT.id]: 2, [NEW_ONE.id]: 1 };
  onPhone = {};
  phoneSays = {};
  phoneAsked = [];
  oldServer = false;
  extra = [];
  extraTalk = {};
  aiSays = {};
  setWaTransport(async (path: string, init: WaCallInit) => {
    if (path === 'status') return { available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 5, unread: 0 };
    if (path === 'chats') return { chats: [FAST, SILENT, NEW_ONE, CUSTOMER, GROUP, ...extra], total: 5 + extra.length, unread: 0 };
    if (path === 'messages') {
      const id = init.query!.chat;
      expect(init.query!.lite).toBe('1');
      read.push(id);
      return { messages: talkOf(id), more: false };
    }
    if (path === 'history') {
      if (oldServer) throw new SyncError(404, 'not found');
      const id = init.query!.chat;
      deepRead.push(id);
      return { messages: [...(onPhone[id] ?? []), ...talkOf(id)].map(({ id: mid, t, me, type, text }) => ({ id: mid, t, me, type, text })), more: false, end: ends[id] ?? null };
    }
    if (path === 'history-sync') {
      const id = (init.body as { chat: string }).chat;
      phoneAsked.push(id);
      const end = ends[id];
      if (end !== 0 && end !== 2) return { asked: false, end };
      const result = phoneSays[id] ?? 'none';
      if (result === 'ok') ends[id] = 1;
      return { asked: true, end, result, endNow: ends[id] };
    }
    if (path === 'outbox') return { items: ((init.body as { items: { key: string }[] }).items ?? []).map((x) => ({ key: x.key, state: 'queued' })) };
    throw new Error(`not played: ${path}`);
  });
  setAiTransport(async (p, body) => {
    if (p !== 'roles') throw new Error('not played');
    const chats = (body as { chats: { id: string; known?: string; texts: string[] }[] }).chats;
    asked.push(...chats);
    return { chats: chats.map((c) => ({ id: c.id, role: aiSays[c.id]?.role ?? 'supplier', makes: c.id === NEW_ONE.id ? ['Lexus', 'Toyota'] : c.id === FAST.id ? ['Toyota'] : [], confidence: aiSays[c.id]?.confidence ?? 0.9 })) };
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
    // The customer's chat and the group are not read; the first time — as deep as WhatsApp Web has it (v0.91.1).
    expect(deepRead.sort()).toEqual([FAST.id, SILENT.id, NEW_ONE.id].sort());
    expect(read).toEqual([]);
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
    deepRead = [];
    const asks = asked.length;
    await studyChats();
    expect(read).toEqual([]);
    expect(deepRead).toEqual([]);
    expect(asked.length).toBe(asks);
    // WhatsApp's word on what stayed on the phone is kept.
    expect((await db.chatFacts.get(FAST.id))?.end).toBe(0);
    expect(await phoneHistoryChats()).toBe(2);
  });

  it('v0.91.2: a friend the AI calls «customer» — no car talked about, no status; an earlier answer counts for nothing; «Без статуса» sticks', async () => {
    const FRIEND = chat('971501110005@c.us', 'Hamad', '971501110005');
    extra = [FRIEND];
    extraTalk[FRIEND.id] = [msg(FRIEND, 0, false, 'how are you bro'), msg(FRIEND, 1, true, 'fine, you?')];
    aiSays[FRIEND.id] = { role: 'customer', confidence: 0.95 };
    // What the AI said before v0.91.2 counts for nothing.
    await db.chatFacts.put({ id: FRIEND.id, phone: FRIEND.phone, aiRole: 'customer', aiAt: '2026-11-26T08:00:00.000Z', updatedAt: '2026-11-26T08:00:00.000Z' });
    const people = await loadPeople();
    expect(chatRole(FRIEND, people, await loadChatRoles())).toBeUndefined();
    await loadChats(true);
    await studyChats();
    // Shown who wrote what; said «customer» — but nothing of a car: «other».
    expect(asked.find((a) => a.id === FRIEND.id)?.texts).toEqual(['T: how are you bro', 'G: fine, you?']);
    const f = await db.chatFacts.get(FRIEND.id);
    expect(f).toMatchObject({ aiRole: 'other', aiV: 3 });
    let roles = await loadChatRoles();
    expect(chatRole(FRIEND, people, roles)).toBeUndefined();
    // The supplier only in WhatsApp — the owner says «Без статуса»: gone, never asked again.
    expect(chatRole(NEW_ONE, people, roles)).toBe('supplier');
    await tagChats([NEW_ONE.id], null);
    roles = await loadChatRoles();
    expect(chatRole(NEW_ONE, people, roles)).toBeUndefined();
    resetChatStudy(0);
    asked = [];
    await db.chatFacts.update(NEW_ONE.id, { studiedAt: undefined, through: 0 });
    await studyChats();
    expect(asked.some((a) => a.id === NEW_ONE.id)).toBe(false);
    // A status by hand again — the mark goes.
    await tagChats([NEW_ONE.id], 'supplier');
    expect((await db.chatFacts.get(NEW_ONE.id))?.noRole).toBeUndefined();
  });

  it('v0.91.1: a server without /history — the last messages, as before', async () => {
    oldServer = true;
    const r = await studyChats();
    expect(r.studied).toBe(3);
    expect(read.sort()).toEqual([FAST.id, SILENT.id, NEW_ONE.id].sort());
    expect((await db.chatFacts.get(FAST.id))?.deepAt).toBeUndefined();
  });

  it('v0.91.1: the phone asked for older messages — what it sends is read and counted; a chat it did not answer is kept as such', async () => {
    await studyChats();
    expect((await db.chatFacts.get(FAST.id))?.turns).toHaveLength(4);
    // Three more Toyota requests, a month older, waiting on the phone; the phone answers for that chat only.
    onPhone[FAST.id] = [-40, -39, -38].flatMap((d) => [msg(FAST, d * 1440, true, '*Toyota Prado 2016*\n1. HEADLIGHT'), msg(FAST, d * 1440 + 15, false, '650')]);
    phoneSays[FAST.id] = 'ok';
    const r = await olderFromPhone();
    expect(phoneAsked.sort()).toEqual([FAST.id, SILENT.id].sort());
    expect(r).toMatchObject({ chats: 2, ok: 1, none: 1, turns: 3 });
    const fast = await db.chatFacts.get(FAST.id);
    expect(fast?.turns).toHaveLength(7);
    expect(fast?.end).toBe(1);
    expect((await db.chatFacts.get(SILENT.id))?.phoneAsk).toBe('none');
    expect(await phoneHistoryChats()).toBe(1);
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

  it('v0.91.6: a chat studied before — read once more, whole: its older requests know their parts and what was offered', async () => {
    await studyChats();
    // As v0.91.5 kept it: the requests without kinds and offers, no `studyV`.
    const was = (await db.chatFacts.get(FAST.id))!;
    expect(was.studyV).toBe(2);
    expect(was.turns?.[0].k).toEqual(['body']);
    await db.chatFacts.put({ ...was, turns: was.turns!.map(({ k: _k, o: _o, ...x }) => x), studyV: undefined, studiedAt: new Date(NOW - DAY).toISOString() });
    resetChatStudy(0);
    deepRead = [];
    await studyChats();
    expect(deepRead).toContain(FAST.id);
    const now = (await db.chatFacts.get(FAST.id))!;
    expect(now.studyV).toBe(2);
    expect(now.turns).toHaveLength(4);
    expect(now.turns?.every((x) => x.k?.[0] === 'body' && x.o === 'oa')).toBe(true);
    // Once: nothing new — nothing read again (read long ago, not a moment ago).
    await db.chatFacts.update(FAST.id, { studiedAt: new Date(NOW - DAY).toISOString() });
    resetChatStudy(0);
    deepRead = [];
    read = [];
    await studyChats();
    expect(deepRead).toEqual([]);
    expect(read).toEqual([]);
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
  it('v0.91.6: the main suppliers — by their work, pinned and taken off by hand; on top of WhatsApp, first in the lists', async () => {
    await studyChats();
    // The fast one by its work (four requests answered with prices); the silent one and the new one (one answer) — not by themselves.
    let top = await loadTop();
    expect([...top.chats.keys()]).toEqual([FAST.id]);
    // Pinned by hand: first, whatever its counts.
    await setChatPin([NEW_ONE], 'on');
    top = await loadTop();
    expect([...top.chats.keys()]).toEqual([NEW_ONE.id, FAST.id]);
    const [people, roles] = await Promise.all([loadPeople(), loadChatRoles()]);
    const rows = filterChats([CUSTOMER, SILENT, FAST, NEW_ONE, GROUP], { tab: 'all', people, roles, top: top.chats });
    expect(rows.slice(0, 2).map((c) => c.id)).toEqual([NEW_ONE.id, FAST.id]);
    const ranked = await suppliersRanked();
    expect(ranked.list[0].name).toBe('Fast Toyota Parts');
    // Taken off by hand: no longer main.
    await setChatPin([FAST], 'off');
    expect((await loadTop()).chats.has(FAST.id)).toBe(false);
  });
});
