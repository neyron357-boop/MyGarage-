import { useSyncExternalStore } from 'react';
import { db, uid } from '../db/db';
import {
  applyEvent,
  chatIdOf,
  MAX_FILE_BYTES,
  mergeMessages,
  msgKey,
  peopleIndex,
  sendKind,
  unreadTotal,
  type Person,
  type WaChat,
  type WaEvent,
  type WaMessage,
  type WaStatus,
  type Who,
} from '../domain/whatsapp';
import { AppError } from './errors';
import { callJson, SyncError } from './sync/api';
import { syncConfig } from './sync/config';
import { filesBase, onServerSaid } from './sync/engine';

/*
 * The garage's WhatsApp on this device (v0.78): asked of the garage's server (server/src/whatsapp.mjs — the server is
 * a linked device of the account; this device never talks to WhatsApp). What is read — the state, the chats, a chat's
 * messages — is kept here in memory while the app is open and kept right by what the server says on the open stream
 * (a message, its ticks, a chat's unread). Nothing of WhatsApp goes into the app's data: not synced, not backed up.
 *
 * What stands in the way is a state, not an error: no server connected, a server not updated yet, the bridge not
 * installed there, not linked. Sending says what went wrong in a line (`wa.err.*`).
 */

export interface WaCallInit {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** A file's bytes (`file`): what to call it and its caption go in `query`. */
  file?: Blob;
  query?: Record<string, string>;
  timeout?: number;
}
type Transport = (path: string, init: WaCallInit) => Promise<unknown>;
let transport: Transport | undefined;
let transportSrc: ((kind: 'media' | 'avatar', id: string) => string) | undefined;
/** The server's part played by a test (and by the browser scenario): its answers, and where a file's picture is. */
export function setWaTransport(t: Transport | undefined, src?: (kind: 'media' | 'avatar', id: string) => string) {
  transport = t;
  transportSrc = src;
  store = { ...EMPTY };
  people = undefined;
  chatsWanted = false;
  emit();
}

/** A device paired with the garage's server may have WhatsApp there. */
export const waCan = (): boolean => !!transport || !!syncConfig();

/* ---------- What is kept while the app is open ---------- */

export interface ChatMeta {
  /** There may be older messages than those read. */
  more: boolean;
  limit: number;
  loading: boolean;
  at: number;
  failed?: boolean;
}

export interface WaStore {
  status?: WaStatus;
  /** The server answers, but knows nothing of WhatsApp: it is older than v0.78. */
  old: boolean;
  /** The server could not be reached when last asked. */
  away: boolean;
  statusAt: number;
  chats: WaChat[];
  chatsAt: number;
  chatsLoading: boolean;
  messages: Record<string, WaMessage[]>;
  meta: Record<string, ChatMeta>;
  /** Linking, unlinking, starting again — one at a time. */
  busy: boolean;
  /** What the server's outbox said of the items this device looks at (v0.79), by key. */
  outbox: Record<string, OutboxFace>;
}

const EMPTY: WaStore = { old: false, away: false, statusAt: 0, chats: [], chatsAt: 0, chatsLoading: false, messages: {}, meta: {}, busy: false, outbox: {} };
/** The outbox's faces as read (v0.79). */
export function keepOutbox(items: OutboxFace[]) {
  if (!items.length) return;
  const next = { ...store.outbox };
  for (const it of items) next[it.key] = it;
  set({ outbox: next });
}
let store: WaStore = { ...EMPTY };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function set(patch: Partial<WaStore>) {
  store = { ...store, ...patch };
  emit();
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const waStore = (): WaStore => store;
/** Told of every change of the store (`ui/waSel.ts` — a screen's own part of it). */
export const subscribeWa = (f: () => void) => subscribe(f);

/** The store, for the screens. */
export function useWa(): WaStore {
  return useSyncExternalStore(subscribe, waStore, waStore);
}

/** Linked and working: chats can be read and messages sent. */
export const waReady = (s: WaStore = store): boolean => s.status?.phase === 'ready';

/* ---------- Asking the server ---------- */

function failure(e: unknown): Error {
  if (e instanceof AppError) return e;
  const status = e instanceof SyncError ? e.status : -1;
  if (status === 0) return new AppError('wa.err.offline');
  if (status === 409 || status === 503) return new AppError('wa.err.notReady');
  if (status === 429) return new AppError('wa.err.tooMany');
  if (status === 413) return new AppError('wa.err.tooBig');
  if (status === 401) return new AppError('wa.err.revoked');
  return new AppError('wa.err.failed');
}

/** A call to the server's WhatsApp (v0.79: the outbox's services call it too). */
export const waCall = <T,>(path: string, init: WaCallInit = {}): Promise<T> => call<T>(path, init);

/** A chat's last messages, read and handed over — not kept in the lists (a supplier's answers read, v0.79). */
export async function fetchChatMessages(chat: string, limit = 60): Promise<WaMessage[]> {
  const r = await call<{ messages: WaMessage[] }>('messages', { query: { chat, limit: String(limit) }, timeout: 100_000 });
  return r.messages ?? [];
}

async function call<T>(path: string, init: WaCallInit = {}): Promise<T> {
  if (transport) return (await transport(path, init)) as T;
  const cfg = syncConfig();
  if (!cfg) throw new SyncError(0, 'no server');
  const q = init.query ? `?${new URLSearchParams(init.query).toString()}` : '';
  if (init.file) {
    // A file goes as it is (not as JSON) — on the computer the server runs on, straight to it.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), init.timeout ?? 300_000);
    let res: Response;
    try {
      res = await fetch(`${filesBase(cfg)}/api/wa/${path}${q}`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': init.file.type || 'application/octet-stream' }, body: init.file, signal: ctl.signal, cache: 'no-store' });
    } catch {
      throw new SyncError(0, 'offline');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new SyncError(res.status, res.statusText);
    return (await res.json()) as T;
  }
  return callJson<T>(cfg, `/api/wa/${path}${q}`, { method: init.method, body: init.body, timeout: init.timeout });
}

let asking: Promise<WaStore> | undefined;
/** Where it stands: asked of the server (at most once at a time). */
export function refreshWa(): Promise<WaStore> {
  if (!waCan()) {
    if (store.status || store.old) set({ ...EMPTY });
    return Promise.resolve(store);
  }
  asking ??= (async () => {
    try {
      const status = await call<WaStatus>('status', { timeout: 15_000 });
      const was = store.status?.phase;
      set({ status, old: false, away: false, statusAt: Date.now() });
      // Ready just now (linked, or back): the chats are read again — where a screen has asked for them.
      if (status.phase === 'ready' && was !== 'ready' && chatsWanted) void loadChats(true);
      if (status.phase !== 'ready' && store.chats.length) set({ chats: [], chatsAt: 0, messages: {}, meta: {} });
    } catch (e) {
      const status = e instanceof SyncError ? e.status : -1;
      // The server is there and has no such address: an older one.
      if (status === 404 || status === 405) set({ old: true, away: false, status: undefined, statusAt: Date.now() });
      else set({ away: true, statusAt: Date.now() });
    } finally {
      asking = undefined;
    }
    return store;
  })();
  return asking;
}

async function act(path: 'link' | 'logout' | 'restart' | 'code', body?: unknown): Promise<void> {
  if (store.busy) return;
  set({ busy: true });
  try {
    const status = await call<WaStatus>(path, { method: 'POST', body, timeout: 80_000 });
    set({ status, old: false, away: false, statusAt: Date.now(), ...(path === 'logout' ? { chats: [], chatsAt: 0, messages: {}, meta: {} } : {}) });
  } catch (e) {
    throw failure(e);
  } finally {
    set({ busy: false });
  }
}
/** The server becomes a linked device: a QR (and, asked for, a code) appears in the state. */
export const linkWa = () => act('link');
/** The code to type on the phone, for the account of this number. */
export const linkWaCode = (phone: string) => act('code', { phone });
export const unlinkWa = () => act('logout');
export const restartWa = () => act('restart');

/* ---------- Chats and messages ---------- */

let chatsAsking: Promise<void> | undefined;
/** A screen has shown the chats: from then on they are kept right (the app's start asks only how many wait). */
let chatsWanted = false;
/**
 * The chats once (v0.80.2): read if they never were — from then on the server's stream keeps them right. A job's screen
 * asks this, not `loadChats`: opening jobs one after another read the whole list each time.
 */
export const ensureChats = (): Promise<void> => (store.chatsAt ? Promise.resolve() : loadChats());

/** The chats, read from the server (`force` — again, though read a moment ago). */
export function loadChats(force = false): Promise<void> {
  chatsWanted = true;
  if (!waReady()) return Promise.resolve();
  if (!force && store.chatsAt && Date.now() - store.chatsAt < 20_000) return Promise.resolve();
  chatsAsking ??= (async () => {
    set({ chatsLoading: true });
    try {
      const r = await call<{ chats: WaChat[]; total: number; unread: number }>('chats', { query: { limit: '1000' }, timeout: 60_000 });
      set({ chats: r.chats ?? [], chatsAt: Date.now(), chatsLoading: false });
    } catch {
      set({ chatsLoading: false });
    } finally {
      chatsAsking = undefined;
    }
  })();
  return chatsAsking;
}

const PAGE = 40;
const metaOf = (chat: string): ChatMeta => store.meta[chat] ?? { more: true, limit: PAGE, loading: false, at: 0 };

/** A chat's last messages (`limit` — how many; more are asked for as the chat is scrolled up). */
export async function loadMessages(chat: string, limit = metaOf(chat).limit): Promise<void> {
  if (!waReady() || !chat || metaOf(chat).loading) return;
  set({ meta: { ...store.meta, [chat]: { ...metaOf(chat), loading: true, failed: false } } });
  try {
    const r = await call<{ messages: WaMessage[]; more: boolean }>('messages', { query: { chat, limit: String(limit) }, timeout: 100_000 });
    // What is being sent from here and not on WhatsApp yet stays in the list.
    const waiting = (store.messages[chat] ?? []).filter((m) => m.pending);
    set({
      messages: { ...store.messages, [chat]: mergeMessages(r.messages ?? [], waiting) },
      meta: { ...store.meta, [chat]: { more: !!r.more && (r.messages?.length ?? 0) >= limit, limit, loading: false, at: Date.now() } },
    });
  } catch {
    set({ meta: { ...store.meta, [chat]: { ...metaOf(chat), loading: false, failed: true } } });
  }
}
/** Older messages of the chat. */
export const moreMessages = (chat: string) => loadMessages(chat, Math.min(400, metaOf(chat).limit + PAGE * 2));

/** The chat is read (its unread number goes on every device, and on the phone). */
export async function seenWa(chat: string): Promise<void> {
  const row = store.chats.find((c) => c.id === chat);
  if (!waReady() || !row?.unread) return;
  set({ chats: store.chats.map((c) => (c.id === chat ? { ...c, unread: 0 } : c)) });
  try {
    await call('seen', { method: 'POST', body: { chat }, timeout: 40_000 });
  } catch {
    // said again when the chat is opened next
  }
}

function putPending(chat: string, m: WaMessage) {
  set({ messages: { ...store.messages, [chat]: mergeMessages(store.messages[chat] ?? [], [m]) } });
}
/**
 * Ticks heard before their message is here (v0.80, «в приложении в ожидании, а в WhatsApp уже отправилось»): WhatsApp's
 * tick comes on the open stream, the send's own answer through the server a moment later — the tick waits for it (two
 * minutes) and is put on it when it comes.
 */
const earlyAcks = new Map<string, { ack: number; at: number }>();
const EARLY_MS = 120_000;
function keepEarlyAck(id: string, ack: number) {
  const now = Date.now();
  for (const [k, v] of earlyAcks) if (now - v.at > EARLY_MS) earlyAcks.delete(k);
  const had = earlyAcks.get(msgKey(id));
  if (!had || ack > had.ack) earlyAcks.set(msgKey(id), { ack, at: now });
}
function withEarlyAck(m: WaMessage): WaMessage {
  const early = earlyAcks.get(msgKey(m.id));
  return early && Date.now() - early.at <= EARLY_MS && early.ack > m.ack ? { ...m, ack: early.ack } : m;
}

function settle(chat: string, pendingId: string, sent: WaMessage | undefined, local?: string) {
  const list = (store.messages[chat] ?? []).filter((m) => m.id !== pendingId);
  if (sent) {
    const msg = withEarlyAck(local ? { ...sent, local } : sent);
    const next = applyEvent({ chats: store.chats, messages: { ...store.messages, [chat]: list } }, { t: 'msg', msg, chat: null });
    set({ chats: next.chats, messages: next.messages });
  } else set({ messages: { ...store.messages, [chat]: (store.messages[chat] ?? []).map((m) => (m.id === pendingId ? { ...m, failed: true } : m)) } });
}

/** A text to the chat: shown at once as on its way, then as WhatsApp has it — or as not sent (thrown too). */
export async function sendWaText(chat: string, text: string, quote?: WaMessage): Promise<WaMessage> {
  const words = text.trim();
  if (!words) throw new AppError('wa.err.empty');
  if (!waReady()) throw new AppError('wa.err.notReady');
  const id = `p:${uid()}`;
  putPending(chat, { id, chat, t: Date.now(), me: true, type: 'chat', text: words, ack: 0, pending: true, quote: quote ? { id: quote.id, type: quote.type, text: quote.text, me: quote.me, thumb: quote.file?.thumb } : undefined });
  try {
    const r = await call<{ msg: WaMessage }>('send', { method: 'POST', body: { chat, text: words, quote: quote?.id }, timeout: 80_000 });
    settle(chat, id, r.msg);
    return r.msg;
  } catch (e) {
    settle(chat, id, undefined);
    throw failure(e);
  }
}

/** A message that did not go: taken out of the chat (to be written again). */
export function dropFailed(chat: string, id: string) {
  const list = store.messages[chat];
  if (list?.some((m) => m.id === id && m.failed)) set({ messages: { ...store.messages, [chat]: list.filter((m) => m.id !== id) } });
}

/** A file to the chat (a photo, a video, a PDF…), with its caption. `doc`: as a document even if it is a picture. */
export async function sendWaFile(chat: string, file: Blob, opts: { name: string; caption?: string; doc?: boolean; quote?: WaMessage } = { name: 'file' }): Promise<WaMessage> {
  if (!waReady()) throw new AppError('wa.err.notReady');
  if (file.size > MAX_FILE_BYTES) throw new AppError('wa.err.tooBig');
  const kind = opts.doc ? 'doc' : sendKind({ type: file.type, name: opts.name });
  const type = kind === 'photo' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'document';
  const id = `p:${uid()}`;
  const local = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && (kind === 'photo' || kind === 'video') ? URL.createObjectURL(file) : undefined;
  putPending(chat, { id, chat, t: Date.now(), me: true, type, text: opts.caption?.trim() ?? '', ack: 0, pending: true, local, file: { mime: file.type, name: opts.name, size: file.size, here: true } });
  try {
    const query: Record<string, string> = { chat, name: opts.name };
    if (opts.caption?.trim()) query.caption = opts.caption.trim();
    if (kind === 'doc') query.doc = '1';
    if (opts.quote) query.quote = opts.quote.id;
    const r = await call<{ msg: WaMessage }>('file', { method: 'POST', file, query, timeout: 300_000 });
    settle(chat, id, r.msg, local);
    return r.msg;
  } catch (e) {
    settle(chat, id, undefined);
    throw failure(e);
  }
}

/** Is this number on WhatsApp — and its chat (the one already in the list, if there is one). */
export async function numberOnWa(phone: string): Promise<{ ok: boolean; chat: string }> {
  const chat = chatIdOf(phone);
  if (!chat) return { ok: false, chat: '' };
  const digits = chat.split('@')[0];
  const known = store.chats.find((c) => !c.group && c.phone === digits);
  if (known) return { ok: true, chat: known.id };
  try {
    const r = await call<{ ok: boolean; chat: string }>('number', { query: { phone: digits }, timeout: 40_000 });
    return { ok: !!r.ok, chat: r.chat || chat };
  } catch (e) {
    throw failure(e);
  }
}

/** The chat of a number among those read (no question to the server): a customer's chat from a job, at once. */
export function chatOfPhone(phone: string | undefined, s: WaStore = store): WaChat | undefined {
  const digits = chatIdOf(phone).split('@')[0];
  return digits ? s.chats.find((c) => !c.group && c.phone === digits) : undefined;
}

/** Numbers already asked about (v0.80): their chat, or null — not on WhatsApp; asked once while the app is open. */
const numberChats = new Map<string, string | null>();
/**
 * A number's chat (a job's customer, a card of the board): among the chats read, else asked of the server once — the
 * next time it is there at once. Null: the number has no WhatsApp. A server away throws (nothing is remembered then).
 */
export async function chatOfNumber(phone: string | undefined): Promise<string | null> {
  const listed = chatOfPhone(phone);
  if (listed) return listed.id;
  const digits = chatIdOf(phone).split('@')[0];
  if (!digits) return null;
  const kept = numberChats.get(digits);
  if (kept !== undefined) return kept;
  const r = await numberOnWa(digits);
  numberChats.set(digits, r.ok ? r.chat : null);
  return r.ok ? r.chat : null;
}

/* ---------- Files ---------- */

function fileAddress(kind: 'media' | 'avatar', id: string): string | undefined {
  if (transportSrc) return transportSrc(kind, id);
  const cfg = syncConfig();
  if (!cfg?.mediaKey) return undefined;
  return `${filesBase(cfg)}/api/wa/${kind}?id=${encodeURIComponent(id)}&d=${encodeURIComponent(cfg.deviceId)}&k=${encodeURIComponent(cfg.mediaKey)}`;
}
/** A message's file, as an address a picture, a video or a sound element loads by itself (in parts: a video plays as it comes). */
export const waFileSrc = (messageId: string): string | undefined => (messageId.startsWith('p:') ? undefined : fileAddress('media', messageId));
/** A chat's picture — none said until the server is asked (the element falls back to initials). */
export const waAvatarSrc = (chatId: string): string | undefined => fileAddress('avatar', chatId);

/** A message's file itself (to share, to save). */
export async function waFileBlob(m: WaMessage): Promise<File | undefined> {
  const src = m.local ?? waFileSrc(m.id);
  if (!src) return undefined;
  const res = await fetch(src);
  if (!res.ok) return undefined;
  const blob = await res.blob();
  const ext = (blob.type.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').split(';')[0];
  return new File([blob], m.file?.name || `whatsapp-${new Date(m.t).toISOString().slice(0, 10)}.${ext}`, { type: blob.type || m.file?.mime || 'application/octet-stream' });
}

/* ---------- The garage's people ---------- */

let people: Promise<Map<string, Who>> | undefined;
/** The garage's customers, suppliers, mechanics and drivers by their numbers — whose chat a chat is. */
export async function loadPeople(): Promise<Map<string, Who>> {
  const [customers, suppliers, employees, drivers] = await Promise.all([db.customers.toArray(), db.suppliers.toArray(), db.employees.toArray(), db.drivers.toArray()]);
  const list: Person[] = [
    ...customers.filter((c) => !c.archivedAt).map((c): Person => ({ kind: 'customer', id: c.id, name: ((c.type === 'company' && c.companyName) || c.name || '').trim(), phones: [c.whatsapp, c.phone] })),
    ...suppliers.map((s): Person => ({ kind: 'supplier', id: s.id, name: s.name, phones: [s.phone] })),
    ...employees.filter((e) => e.active).map((e): Person => ({ kind: 'employee', id: e.id, name: e.name, phones: [e.phone] })),
    ...drivers.filter((d) => !d.archivedAt).map((d): Person => ({ kind: 'driver', id: d.id, name: d.name, phones: [d.phone] })),
  ];
  return peopleIndex(list);
}
/** The same, read once and kept (a lookup from a place that only needs a name now and then). */
export function knownPeople(): Promise<Map<string, Who>> {
  people ??= loadPeople();
  return people;
}

/* ---------- On this device ---------- */

export interface WaPrefs {
  /** A document's message goes from the app itself (the server sends it), not by opening WhatsApp. */
  direct: boolean;
  /** A chat opened here is read on WhatsApp too (the blue ticks go to who wrote). */
  seen: boolean;
}
const PREFS_KEY = 'mygarage.wa';
const DEFAULT_PREFS: WaPrefs = { direct: true, seen: true };
let prefsCache: WaPrefs | undefined;
export function waPrefs(): WaPrefs {
  if (!prefsCache) {
    try {
      prefsCache = { ...DEFAULT_PREFS, ...(JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? '{}') as Partial<WaPrefs>) };
    } catch {
      prefsCache = { ...DEFAULT_PREFS };
    }
  }
  return prefsCache;
}
export function setWaPrefs(patch: Partial<WaPrefs>) {
  prefsCache = { ...waPrefs(), ...patch };
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefsCache));
  } catch {
    // kept for this visit
  }
  emit();
}
export function useWaPrefs(): WaPrefs {
  useSyncExternalStore(subscribe, waStore, waStore);
  return waPrefs();
}

/** Messages waiting to be read, for the app's badges: from the chats when they are read, else as the server last said. */
export const waUnread = (s: WaStore = store): number => (!waReady(s) ? 0 : s.chatsAt ? unreadTotal(s.chats) : (s.status?.unread ?? 0));

/* ---------- What the server says ---------- */

/**
 * Whoever wants to hear what WhatsApp says as it says it (v0.79: a supplier's answer read at once, the outbox's
 * progress shown): every event of the stream, after the lists took it.
 */
type WaListener = (ev: WaEvent | OutboxEvent) => void;
const waListeners = new Set<WaListener>();
export function onWaEvent(fn: WaListener): () => void {
  waListeners.add(fn);
  return () => void waListeners.delete(fn);
}

/** What the server's outbox says of an item: queued, sent, failed (v0.79, server/src/waOutbox.mjs). */
export interface OutboxFace {
  key: string;
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'dropped' | 'none';
  at?: number;
  title?: string;
  chat?: string;
  error?: string;
  tries?: number;
  parts?: number;
  done?: number;
}
export type OutboxEvent = { t: 'outbox'; item: OutboxFace };

/** An event of the stream (`{"wa": …}`): the state, a message, its ticks, a chat's line. */
export function waSaid(value: unknown) {
  waHeard(value);
  const ev = value as WaEvent | OutboxEvent | undefined;
  if (ev && typeof ev === 'object' && 't' in ev)
    for (const fn of waListeners) {
      try {
        fn(ev);
      } catch {
        // a listener's own trouble
      }
    }
}
function waHeard(value: unknown) {
  const ev = value as WaEvent | OutboxEvent | undefined;
  if (!ev || typeof ev !== 'object' || !('t' in ev)) return;
  if (ev.t === 'outbox') {
    const item = ev.item;
    if (item?.key) set({ outbox: { ...store.outbox, [item.key]: item } });
    return;
  }
  if (ev.t === 'state') {
    const was = store.status?.phase;
    set({ status: ev.state, old: false, away: false, statusAt: Date.now() });
    if (ev.state.phase === 'ready' && was !== 'ready' && chatsWanted) void loadChats(true);
    if (ev.state.phase !== 'ready' && store.chats.length) set({ chats: [], chatsAt: 0, messages: {}, meta: {} });
    return;
  }
  if (ev.t === 'chats') {
    // The server read its list anew (every ten minutes, and after a new chat): this one follows, if it is in use.
    if (store.chatsAt) void loadChats(true);
    else if (store.status) set({ status: { ...store.status, unread: ev.unread, chats: ev.n } });
    return;
  }
  if (!store.chatsAt && ev.t === 'chat' && store.status && typeof ev.unread === 'number') set({ status: { ...store.status, unread: ev.unread } });
  const said: WaEvent = ev.t === 'msg' ? { ...ev, msg: withEarlyAck(ev.msg) } : ev;
  const next = applyEvent({ chats: store.chats, messages: store.messages }, said);
  if (next.chats !== store.chats || next.messages !== store.messages) set({ chats: next.chats, messages: next.messages });
  // A tick for a message not here yet (its send not answered yet): kept for it.
  else if (ev.t === 'ack' && ev.ack > 0) keepEarlyAck(ev.id, ev.ack);
}
onServerSaid('wa', waSaid);
