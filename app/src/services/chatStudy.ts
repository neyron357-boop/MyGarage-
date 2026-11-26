import { db } from '../db/db';
import { canonicalMake } from '../domain/carCatalog';
import { AI_ROLES_V, backedRole, chatSigns, mergeSigns, mergeTurns, signsKey, turnsOf, wordsForAi, type ChatSigns, type KnownMake } from '../domain/chatStudy';
import { knowOf, type SupplierKnow } from '../domain/supplierRank';
import { nowIso } from '../domain/dates';
import type { ChatFact, Supplier } from '../domain/types';
import { chatRole, orderChats, waDigits, whoOf, type ChatRoles, type WaChat, type WaEvent, type WaMessage, type Who } from '../domain/whatsapp';
import { aiChatRoles, aiOn } from './ai';
import { SyncError } from './sync/api';
import { askPhoneHistory, fetchChatHistory, fetchChatMessages, knownPeople, loadChatRoles, loadPeople, onWaEvent, subscribeWa, waCall, waReady, waStore } from './whatsapp';

/*
 * The garage's WhatsApp studied (v0.91, the owner: «ИИ должен быстро обрабатывать новые чаты или уже существующие,
 * определять их, присваивать им статусы… на какие марки авто она часто отвечает… в начале ИИ должен пройтись по всем
 * чатам и сделать то что сказал, потом дальше в таком духе при новых чатах»; «в реальном времени изучать переписки и учить
 * приложение и накапливать знание»):
 *  - every person's chat that is, or may be, a supplier (not a customer, a mechanic, a driver, a group) is read — its last
 *    80 messages, light (who, when, the kind, the words), and only when something new came since — and what the garage's
 *    requests in it came to is kept (`ChatFact.turns`, domain/chatStudy.ts): the app's own rules, no AI;
 *  - a chat the garage does not know, or a supplier whose makes nobody gave, is shown to the AI by its name and a few of its
 *    words — who it is and the makes it deals with (`aiRole`, `aiMakes`; a light model, a dozen at once, kept on the server);
 *  - all of it once when the app opens (again after six hours), then each chat a minute after its last message.
 * v0.91.1 (the owner: «много чатов, более ранние истории которых не загружаются — что сделать, чтобы ИИ посмотрел абсолютно
 * все истории»): a chat is read the first time as deep as WhatsApp Web has it (`/api/wa/history`, up to 3000 messages; then
 * only what is new); what stayed on the phone — `olderFromPhone`: the phone asked for each chat's older messages
 * (WhatsApp's own «get older messages from your phone»; it answers only with WhatsApp open on it, and only what the phone
 * gives this linked device — «All chat history» in its Linked devices), and the chat read deep again when they came.
 * The messages themselves are never kept — only what they came to. Any device with the garage's WhatsApp does it; a chat
 * read on one device in the last ten minutes is not read again on another. Nothing is sent.
 */

/** Read this many of a chat's last messages (what is new since it was read). */
const READ = 80;
/** The first read of a chat — as deep as WhatsApp Web has it. */
const DEEP = 3000;
/** A chat studied (here or on another device) this recently is not read again. */
const FRESH_MS = 10 * 60_000;
/** The whole list again after this long. */
const SWEEP_EVERY = 6 * 60 * 60_000;
// v0.91.1: a key of its own — the chats studied by v0.91 (80 messages each) are read deep at once, not in six hours.
const SWEPT_KEY = 'mygarage.chatStudy.v2';
const AI_BATCH = 12;

/* ---------- What is going on (the WhatsApp list shows it) ---------- */

export interface StudyProgress {
  running: boolean;
  done: number;
  total: number;
  /** What it is doing: going through the chats, or asking the phone for older messages. */
  kind?: 'study' | 'phone';
}
let progress: StudyProgress = { running: false, done: 0, total: 0 };
const subs = new Set<() => void>();
export const studyProgress = (): StudyProgress => progress;
export function onStudyProgress(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}
function tell(p: StudyProgress) {
  progress = p;
  subs.forEach((f) => f());
}

/* ---------- Which chats ---------- */

/** A person's chat that is, or may be, a supplier: worth reading for what its requests came to. */
export function worthStudy(chat: Pick<WaChat, 'id' | 'phone' | 'group' | 'self'>, people: Map<string, Who>, roles: ChatRoles): boolean {
  if (chat.group || chat.self) return false;
  const role = chatRole(chat, people, roles);
  return !role || role === 'supplier' || role === 'service';
}

/**
 * Worth asking the AI about: a chat nobody said who it is (asked by the question before v0.91.2 — asked again: those answers
 * gave unrelated chats a status), one it said «other» whose words have since shown a car or parts, or a supplier whose makes
 * nobody gave (by hand, on its card). Never a chat said «Не относится к гаражу» by hand.
 */
function aiWanted(chat: WaChat, fact: ChatFact | undefined, people: Map<string, Who>, roles: ChatRoles, suppliers: Map<string, Supplier>): 'supplier' | 'unknown' | undefined {
  if (chat.group || chat.self || fact?.noRole) return undefined;
  const asked = (fact?.aiV ?? 0) >= AI_ROLES_V;
  const who = whoOf(chat, people);
  if (who) return who.kind === 'supplier' && !asked && !suppliers.get(who.id)?.makes?.length && !fact?.makes?.length ? 'supplier' : undefined;
  const tag = roles.tags[chat.id];
  if (tag) return (tag === 'supplier' || tag === 'service') && !asked && !fact?.makes?.length ? 'supplier' : undefined;
  if (roles.groups.has(chat.id)) return undefined;
  if (!asked) return 'unknown';
  return fact?.aiRole === 'other' && signsKey(fact.signs).length > (fact.aiSigns ?? '').length ? 'unknown' : undefined;
}

/* ---------- One chat ---------- */

/** Its kept record, changed by `patch` (read and written at once — another device's makes by hand are not lost). */
async function keep(id: string, patch: Partial<ChatFact>): Promise<ChatFact> {
  return db.transaction('rw', db.chatFacts, async () => {
    const was = await db.chatFacts.get(id);
    const next: ChatFact = { ...(was ?? { id, phone: '' }), ...patch, id, updatedAt: nowIso() };
    await db.chatFacts.put(next);
    return next;
  });
}

/**
 * A chat read and what its requests came to kept. Not read when nothing came since it was (`force` — read anyway), or when
 * it was read a moment ago here or on another device. Returns the record and a few of its words (for the AI), or nothing.
 */
export async function studyChat(chat: Pick<WaChat, 'id' | 'phone' | 'name' | 't'>, opts: { force?: boolean; deep?: boolean } = {}): Promise<{ fact: ChatFact; words: string[] } | undefined> {
  const was = await db.chatFacts.get(chat.id);
  if (!opts.force && was?.studiedAt && Date.now() - Date.parse(was.studiedAt) < FRESH_MS) return undefined;
  // Read deep once (v0.91.1); after that only when something came since.
  const deep = opts.deep || !was?.deepAt;
  if (!opts.force && !deep && was?.through && chat.t && was.through >= chat.t) return undefined;
  let messages: Pick<WaMessage, 't' | 'me' | 'type' | 'text'>[];
  let end = was?.end;
  let deepAt = was?.deepAt;
  if (deep) {
    try {
      const h = await fetchChatHistory(chat.id, DEEP);
      messages = h.messages;
      end = h.end;
      deepAt = nowIso();
    } catch (e) {
      // A server from before v0.91.1: the last messages, as before.
      if (!(e instanceof SyncError) || e.status !== 404) throw e;
      messages = await fetchChatMessages(chat.id, READ, { lite: true });
    }
  } else messages = await fetchChatMessages(chat.id, READ, { lite: true });
  const times = messages.map((m) => m.t).filter((t) => t > 0);
  const turns = times.length ? mergeTurns(was?.turns, turnsOf(messages), Math.min(...times)) : was?.turns;
  const signs = mergeSigns(was?.signs, chatSigns(messages, turns));
  const fact = await keep(chat.id, {
    phone: chat.phone || was?.phone || '',
    name: chat.name || was?.name,
    turns: turns?.length ? turns : undefined,
    through: Math.max(was?.through ?? 0, ...times, chat.t || 0),
    studiedAt: nowIso(),
    ...(deepAt ? { deepAt } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(signsKey(signs) ? { signs } : {}),
  });
  return { fact, words: wordsForAi(messages.map((m, k) => ({ ...m, t: m.t || k }))) };
}

/**
 * The words the AI is shown of a chat not read just now (nothing new came): its last messages, light — and what they show
 * kept with the chat.
 */
async function wordsOf(chat: Pick<WaChat, 'id'>): Promise<{ words: string[]; signs?: ChatSigns }> {
  try {
    const messages = await fetchChatMessages(chat.id, 60, { lite: true });
    const was = await db.chatFacts.get(chat.id);
    const signs = mergeSigns(was?.signs, chatSigns(messages, was?.turns));
    if (signsKey(signs) !== signsKey(was?.signs)) await keep(chat.id, { signs });
    return { words: wordsForAi(messages), signs };
  } catch {
    return { words: [] };
  }
}

/** How sure the AI must be of «customer» or «supplier» (v0.91.2: was 0.6). */
const SURE = 0.8;

/**
 * The AI's word on a few chats, kept with each: who it is — only as sure as `SURE` and only as far as the chat's own words
 * back it (`backedRole`: no car talked about — no customer; no parts priced or asked and answered — no supplier, unless
 * its name says so); a supplier's makes (none said — none).
 */
async function askAiAbout(list: { chat: WaChat; words: string[]; known?: 'supplier'; signs?: ChatSigns }[]): Promise<number> {
  if (!list.length || !aiOn()) return 0;
  const said = await aiChatRoles(list.map(({ chat, words, known }) => ({ id: chat.id, name: chat.name, texts: words.length ? words : chat.last?.text ? [`${chat.last.me ? 'G' : 'T'}: ${chat.last.text}`] : [], ...(known ? { known } : {}) })));
  let suppliers = 0;
  for (const r of said) {
    const one = list.find((x) => x.chat.id === r.id);
    if (!one) continue;
    const signs = one.signs ?? (await db.chatFacts.get(r.id))?.signs;
    const role = r.confidence >= SURE ? backedRole(r.role, signs, one.chat.name) : 'other';
    // A server from before v0.91 says no makes: the role is kept, the chat is asked again once it says them.
    const makes = (r.makes ?? []).map((m) => canonicalMake(m)).filter(Boolean);
    await keep(r.id, {
      // (a chat whose number WhatsApp hides — none to put over the kept one)
      ...(one.chat.phone ? { phone: one.chat.phone } : {}),
      ...(one.chat.name ? { name: one.chat.name } : {}),
      ...(one.known ? {} : { aiRole: role }),
      ...(r.makes && (role === 'supplier' || one.known) ? { aiMakes: makes.length ? makes : undefined } : {}),
      ...(r.makes ? { aiAt: nowIso(), aiV: AI_ROLES_V, aiSigns: signsKey(signs) } : {}),
    });
    if (!one.known && role === 'supplier') suppliers++;
  }
  return suppliers;
}

/* ---------- All of them ---------- */

let sweeping: Promise<{ studied: number; suppliers: number }> | undefined;

/**
 * Every chat worth it, one after another (a short pause between): read when something new came, the AI asked about those
 * nobody knows (a dozen at once). The list as the app has it, else read from the server. Stops when WhatsApp goes away.
 */
export function studyChats(opts: { chats?: WaChat[] } = {}): Promise<{ studied: number; suppliers: number }> {
  sweeping ??= (async () => {
    let studied = 0;
    let suppliers = 0;
    try {
      const chats = opts.chats?.length ? opts.chats : waStore().chats.length ? waStore().chats : ((await waCall<{ chats: WaChat[] }>('chats', { query: { limit: '1000' }, timeout: 60_000 })).chats ?? []);
      const [people, roles, facts, sups] = await Promise.all([loadPeople(), loadChatRoles(), db.chatFacts.toArray(), db.suppliers.toArray()]);
      const factOf = new Map(facts.map((f) => [f.id, f]));
      const supplierOf = new Map(sups.map((s) => [s.id, s]));
      const list = orderChats(chats).filter((c) => worthStudy(c, people, roles));
      tell({ running: true, done: 0, total: list.length, kind: 'study' });
      const queue: { chat: WaChat; words: string[]; known?: 'supplier'; signs?: ChatSigns }[] = [];
      for (const [k, chat] of list.entries()) {
        if (!waReady()) break;
        let words: string[] = [];
        try {
          const r = await studyChat(chat);
          if (r) {
            studied++;
            words = r.words;
            factOf.set(chat.id, r.fact);
          }
        } catch {
          // this one another time
        }
        const want = aiWanted(chat, factOf.get(chat.id), people, roles, supplierOf);
        if (want && !asked.has(chat.id)) {
          asked.add(chat.id);
          // Not read just now (nothing new): its last words read for the AI.
          const seen = words.length ? { words, signs: factOf.get(chat.id)?.signs } : await wordsOf(chat);
          queue.push({ chat, words: seen.words, signs: seen.signs, ...(want === 'supplier' ? { known: 'supplier' as const } : {}) });
        }
        if (queue.length >= AI_BATCH) suppliers += await askAiAbout(queue.splice(0)).catch(() => 0);
        tell({ running: true, done: k + 1, total: list.length, kind: 'study' });
        await new Promise((r) => setTimeout(r, PAUSE));
      }
      suppliers += await askAiAbout(queue).catch(() => 0);
      try {
        localStorage.setItem(SWEPT_KEY, String(Date.now()));
      } catch {
        // not kept
      }
    } finally {
      tell({ running: false, done: 0, total: 0 });
      sweeping = undefined;
    }
    return { studied, suppliers };
  })();
  return sweeping;
}

/* ---------- What stayed on the phone ---------- */

export interface PhoneHistoryResult {
  /** Chats with older messages on the phone, as WhatsApp says. */
  chats: number;
  /** Asks sent; the phone answered with messages; it said no; it did not answer. */
  asked: number;
  ok: number;
  failed: number;
  none: number;
  /** Requests read in the history that came. */
  turns: number;
  /** Stopped: the phone did not answer three times running (WhatsApp is not open on it), or WhatsApp paused the asks. */
  stopped?: 'silent' | 'paused';
}

/** The chats, worth studying, whose older messages WhatsApp says are on the phone (0 — there; 2 — not given to this device). */
export async function phoneHistoryChats(): Promise<number> {
  return (await db.chatFacts.toArray()).filter((f) => f.end === 0 || f.end === 2).length;
}

let asking: Promise<PhoneHistoryResult> | undefined;
/** Asks of one chat in a row while the phone keeps sending older messages. */
const ASKS_A_CHAT = 6;

/**
 * The phone asked for the older messages of every chat worth studying that has them there (v0.91.1), one chat at a time:
 * the phone answers — the chat is read deep again, and asked again while more is left (a few times); three chats running
 * without an answer — WhatsApp is not open on the phone: stop and say so. Nothing is sent to anyone: the ask goes to the
 * garage's own phone.
 */
export function olderFromPhone(): Promise<PhoneHistoryResult> {
  asking ??= (async () => {
    const out: PhoneHistoryResult = { chats: 0, asked: 0, ok: 0, failed: 0, none: 0, turns: 0 };
    try {
      const chats = waStore().chats.length ? waStore().chats : ((await waCall<{ chats: WaChat[] }>('chats', { query: { limit: '1000' }, timeout: 60_000 })).chats ?? []);
      const [people, roles, facts] = await Promise.all([loadPeople(), loadChatRoles(), db.chatFacts.toArray()]);
      const factOf = new Map(facts.map((f) => [f.id, f]));
      const list = orderChats(chats).filter((c) => worthStudy(c, people, roles) && (factOf.get(c.id)?.end === 0 || factOf.get(c.id)?.end === 2));
      out.chats = list.length;
      tell({ running: true, done: 0, total: list.length, kind: 'phone' });
      let silent = 0;
      for (const [k, chat] of list.entries()) {
        if (!waReady()) break;
        const before = factOf.get(chat.id)?.turns?.length ?? 0;
        for (let round = 0; round < ASKS_A_CHAT; round++) {
          const r = await askPhoneHistory(chat.id);
          if (r.paused) {
            out.stopped = 'paused';
            break;
          }
          if (!r.asked) break;
          out.asked++;
          await keep(chat.id, { phoneAt: nowIso(), phoneAsk: r.result ?? 'unknown', end: r.endNow ?? r.end });
          if (r.result !== 'ok') {
            if (r.result === 'failed') out.failed++;
            else out.none++;
            silent = r.result === 'failed' ? 0 : silent + 1;
            break;
          }
          out.ok++;
          silent = 0;
          const had = (await db.chatFacts.get(chat.id))?.turns?.length ?? 0;
          const read = await studyChat(chat, { force: true, deep: true });
          // More left on the phone and more came — again; nothing new, or nothing left — enough for this chat.
          if (!read || (read.fact.end !== 0 && read.fact.end !== 2) || (read.fact.turns?.length ?? 0) <= had) break;
        }
        out.turns += Math.max(0, ((await db.chatFacts.get(chat.id))?.turns?.length ?? 0) - before);
        tell({ running: true, done: k + 1, total: list.length, kind: 'phone' });
        if (out.stopped) break;
        if (silent >= 3) {
          out.stopped = 'silent';
          break;
        }
      }
    } finally {
      tell({ running: false, done: 0, total: 0 });
      asking = undefined;
    }
    return out;
  })();
  return asking;
}

/** Asked of the AI while the app is open (a chat it could not say is not asked again until the app opens again). */
const asked = new Set<string>();
let PAUSE = 250;
/** The tests: no pause between chats, nobody asked yet. */
export function resetChatStudy(pause = 0) {
  PAUSE = pause;
  asked.clear();
}

/* ---------- As messages come ---------- */

const waiting = new Map<string, ReturnType<typeof setTimeout>>();
/** A chat a minute after its last message (a conversation is read once it rests). */
const QUIET_MS = 60_000;

async function studyNow(chat: WaChat, deep = false) {
  // The garage's people as read once (a busy account speaks often: the whole base is not read for each message).
  const [people, roles] = await Promise.all([knownPeople(), loadChatRoles()]);
  if (!worthStudy(chat, people, roles)) return;
  const r = await studyChat(chat, { force: true, deep });
  const who = whoOf(chat, people);
  const [fact, sup] = await Promise.all([db.chatFacts.get(chat.id), who?.kind === 'supplier' ? db.suppliers.get(who.id) : undefined]);
  const want = aiWanted(chat, fact, people, roles, new Map(sup ? [[sup.id, sup]] : []));
  if (!want || asked.has(chat.id)) return;
  asked.add(chat.id);
  await askAiAbout([{ chat, words: r?.words ?? [], signs: fact?.signs, ...(want === 'supplier' ? { known: 'supplier' as const } : {}) }]);
}

let started = false;
/** Once, at the app's start: the whole list when WhatsApp is ready (not studied for six hours), then each chat as it speaks. */
export function startChatStudy() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onWaEvent((ev) => {
    const e = ev as WaEvent;
    // The server brought a chat's older messages from the phone (v0.91.3): read it as deep again, a moment later.
    if (e.t === 'history') {
      const id = e.chat;
      clearTimeout(waiting.get(`h:${id}`));
      waiting.set(
        `h:${id}`,
        setTimeout(() => {
          waiting.delete(`h:${id}`);
          void (async () => {
            const fact = await db.chatFacts.get(id);
            const known = waStore().chats.find((c) => c.id === id);
            const chat: WaChat = known ?? { id, name: fact?.name ?? '', phone: fact?.phone ?? '', group: false, unread: 0, t: 0, archived: false, pinned: false, muted: false, self: false, last: null };
            await studyNow(chat, true);
          })().catch(() => undefined);
        }, 8000),
      );
      return;
    }
    if (e.t !== 'msg' || !e.chat || e.chat.group || e.chat.self) return;
    const chat = e.chat;
    clearTimeout(waiting.get(chat.id));
    waiting.set(
      chat.id,
      setTimeout(() => {
        waiting.delete(chat.id);
        void studyNow(chat).catch(() => undefined);
      }, QUIET_MS),
    );
  });
  let planned = false;
  // When the list was last gone through (kept on this device); read once — the store speaks at every event.
  let sweptAt = -1;
  const maybeSweep = () => {
    if (planned || !waReady()) return;
    if (sweptAt < 0) {
      try {
        sweptAt = Number(localStorage.getItem(SWEPT_KEY)) || 0;
      } catch {
        sweptAt = 0;
      }
    }
    if (Date.now() - sweptAt < SWEEP_EVERY) return;
    sweptAt = Date.now();
    planned = true;
    // A little after the app came up (its own reads first).
    setTimeout(() => {
      planned = false;
      void studyChats().catch(() => undefined);
    }, 20_000);
  };
  subscribeWa(maybeSweep);
  maybeSweep();
  setInterval(maybeSweep, 30 * 60_000);
}

/* ---------- Makes by hand ---------- */

/**
 * Chats picked in the WhatsApp list given makes (v0.91, the owner: «выбрать несколько чатов, например поставщики Тойота, и
 * присвоить им марку Тойота, чтобы при поиске деталей первыми отображались»): `makes` — what the person left on; `common` —
 * what all the picked ones had when the sheet opened (one taken off there is taken off each); a make one of them had alone
 * stays. A supplier of the base keeps them on its card, any other chat on its record. Returns how many chats.
 */
export async function setChatMakes(chats: Pick<WaChat, 'id' | 'phone' | 'name' | 'group'>[], makes: string[], common: string[]): Promise<number> {
  const people = await loadPeople();
  const on = [...new Set(makes.map(canonicalMake).filter(Boolean))];
  const off = new Set(common.map(canonicalMake).filter((m) => !on.includes(m)).map((m) => m.toLowerCase()));
  const next = (had: string[] | undefined) => {
    const left = (had ?? []).map(canonicalMake).filter((m) => !off.has(m.toLowerCase()));
    for (const m of on) if (!left.some((x) => x.toLowerCase() === m.toLowerCase())) left.push(m);
    return left;
  };
  let n = 0;
  await db.transaction('rw', db.suppliers, db.chatFacts, async () => {
    for (const chat of chats) {
      if (chat.group) continue;
      const who = whoOf(chat, people);
      if (who?.kind === 'supplier') {
        const s = await db.suppliers.get(who.id);
        if (!s) continue;
        const makes = next(s.makes);
        // Given by hand now: no longer the app's guess (v0.60).
        await db.suppliers.update(s.id, { makes: makes.length ? makes : undefined, guessed: s.guessed?.filter((g) => g !== 'makes').length ? s.guessed.filter((g) => g !== 'makes') : undefined });
      } else {
        const was = await db.chatFacts.get(chat.id);
        const makes = next(was?.makes);
        await db.chatFacts.put({ ...(was ?? { id: chat.id, phone: chat.phone }), phone: chat.phone || was?.phone || '', name: chat.name || was?.name, makes: makes.length ? makes : undefined, updatedAt: nowIso() });
      }
      n++;
    }
  });
  return n;
}

/** The makes the picked chats have now — by hand (the card's for a supplier of the base): all of them, and those they share. */
export async function chatsMakes(chats: Pick<WaChat, 'id' | 'phone' | 'group'>[]): Promise<{ all: string[]; common: string[] }> {
  const people = await loadPeople();
  const lists: string[][] = [];
  for (const chat of chats) {
    if (chat.group) continue;
    const who = whoOf(chat, people);
    const had = who?.kind === 'supplier' ? (await db.suppliers.get(who.id))?.makes : (await db.chatFacts.get(chat.id))?.makes;
    lists.push((had ?? []).map(canonicalMake));
  }
  const all = [...new Set(lists.flat())];
  const common = all.filter((m) => lists.length > 0 && lists.every((l) => l.includes(m)));
  return { all, common };
}

/** The makes the chats are known for, by the chat and by the number (a supplier of the base: its card's first). */
export async function loadChatMakes(): Promise<{ byChat: Map<string, KnownMake[]>; byPhone: Map<string, KnownMake[]> }> {
  const [facts, sups] = await Promise.all([db.chatFacts.toArray(), db.suppliers.toArray()]);
  const now = nowIso();
  const byChat = new Map<string, KnownMake[]>();
  const byPhone = new Map<string, KnownMake[]>();
  const factOf = new Map(facts.filter((f) => f.phone).map((f) => [f.phone, f]));
  for (const f of facts) {
    const k = knowOf(f, now);
    if (k?.makes.length) byChat.set(f.id, k.makes);
  }
  for (const s of sups) {
    const d = waDigits(s.phone);
    if (!d) continue;
    const k = knowOf(factOf.get(d), now, s.makes);
    if (k?.makes.length) byPhone.set(d, k.makes);
  }
  return { byChat, byPhone };
}

/** What a chat taught the garage (its card): a supplier of the base — with the makes on its card. */
export async function chatKnow(chatId: string, phone: string): Promise<SupplierKnow | undefined> {
  const [fact, people] = await Promise.all([db.chatFacts.get(chatId), loadPeople()]);
  const who = phone ? people.get(phone) : undefined;
  const hand = who?.kind === 'supplier' ? (await db.suppliers.get(who.id))?.makes : undefined;
  return knowOf(fact, nowIso(), hand);
}
