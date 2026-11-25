import { useSyncExternalStore } from 'react';
import { db, uid } from '../db/db';
import {
  applyEvent,
  chatIdOf,
  MAX_FILE_BYTES,
  mergeMessages,
  msgKey,
  peopleIndex,
  sameMessages,
  sendKind,
  unreadTotal,
  type ChatRoles,
  type Person,
  type WaChat,
  type WaEvent,
  type WaMessage,
  type WaStatus,
  type WaTag,
  type Who,
} from '../domain/whatsapp';
import { waAutoOf } from '../domain/waAuto';
import { AppError } from './errors';
import { getSettings, saveSettings } from './settings';
import { callJson, SyncError } from './sync/api';
import { syncConfig } from './sync/config';
import { filesBase, onServerSaid, onStreamBack } from './sync/engine';

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
  forgetSends();
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
  /** The chats could not be read when last asked (v0.84: «Не удалось загрузить чаты» — what was read stays). */
  chatsFailed?: boolean;
  /** Recordings stopped before they were sent, by chat (v0.84). */
  voices: Record<string, VoiceDraft>;
}

const EMPTY: WaStore = { old: false, away: false, statusAt: 0, chats: [], chatsAt: 0, chatsLoading: false, messages: {}, meta: {}, busy: false, outbox: {}, voices: {} };
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
      // What waited for the network goes now (v0.84).
      if (status.phase === 'ready' && was !== 'ready') later(300);
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
      set({ chats: r.chats ?? [], chatsAt: Date.now(), chatsLoading: false, chatsFailed: false });
    } catch {
      set({ chatsLoading: false, chatsFailed: true });
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

/* ---------- Live (v0.87) ---------- */

/** The chats whose messages are on a screen now, by how many screens show each. */
const onScreen = new Map<string, number>();
/** A chat's messages are on a screen (`ChatThread`): read again after a gap, as long as they are. */
export function showingChat(chat: string): () => void {
  onScreen.set(chat, (onScreen.get(chat) ?? 0) + 1);
  return () => {
    const n = (onScreen.get(chat) ?? 1) - 1;
    if (n > 0) onScreen.set(chat, n);
    else onScreen.delete(chat);
  };
}

/**
 * A chat's messages read again quietly: what came is put in, what is shown stays (older messages, a file's local copy);
 * nothing changed — nothing is drawn again. A chat never read is not (it is read when opened).
 */
async function freshen(chat: string): Promise<void> {
  const meta = store.meta[chat];
  if (!waReady() || !meta || meta.loading || !store.messages[chat]) return;
  try {
    const r = await call<{ messages: WaMessage[]; more: boolean }>('messages', { query: { chat, limit: String(meta.limit) }, timeout: 100_000 });
    const had = store.messages[chat];
    if (!had) return;
    const next = mergeMessages(had, (r.messages ?? []).map(withEarlyAck));
    if (!sameMessages(had, next)) set({ messages: { ...store.messages, [chat]: next } });
  } catch {
    // the stream is the way; the chat is read again when it is opened
  }
}

let catching: ReturnType<typeof setTimeout> | undefined;
/**
 * What WhatsApp said while this device did not hear it (v0.87, the owner: «ватсап не живой… придётся каждый раз обновлять
 * приложение»): the device's stream to the server was closed (the app in the background, the network, the server
 * restarting) or the server's to WhatsApp was — the chats' list (where a screen uses it) and the chats on a screen are
 * read again. The rest are read when they are opened.
 */
export function catchUpWa(ms = 300) {
  clearTimeout(catching);
  catching = setTimeout(() => {
    catching = undefined;
    if (!waReady()) return;
    if (chatsWanted && store.chatsAt) void loadChats(true);
    for (const chat of onScreen.keys()) void freshen(chat);
  }, ms);
}
onStreamBack(() => catchUpWa());

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

function settle(chat: string, pendingId: string, sent: WaMessage, local?: string) {
  const list = (store.messages[chat] ?? []).filter((m) => m.id !== pendingId);
  const msg = withEarlyAck(local ? { ...sent, local } : sent);
  const next = applyEvent({ chats: store.chats, messages: { ...store.messages, [chat]: list } }, { t: 'msg', msg, chat: null });
  set({ chats: next.chats, messages: next.messages });
}

/** One message of a chat changed in place (its state while it goes). */
function patchMsg(chat: string, id: string, patch: Partial<WaMessage>) {
  const list = store.messages[chat];
  if (!list?.some((m) => m.id === id)) return;
  set({ messages: { ...store.messages, [chat]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)) } });
}

/* ---------- Sending (v0.84): one message for one tap ---------- */

/**
 * What is being sent from here, by its place in the chat (v0.84, the brief: «различай черновик, ожидание отправки, отправку,
 * подтверждённые статусы и ошибку… повторный тап, потеря сети, перезапуск… повтор не должен создавать дубли»). Its place's
 * id is also its key on the garage's server (server/whatsapp/once.mjs): asked again under it — after the network dropped
 * the answer, after «Повторить» — the server gives the same message, it never sends a second one.
 *
 * The chat's own sends (`queue`) wait for the network: no answer, the server restarting, WhatsApp not ready, too many a
 * minute — «В очереди», and they go by themselves, in order, when the server answers again. The rest (a document from a
 * sheet) are said not sent at once, as before. A text waiting is kept on this device (`QUEUE_KEY`), so it goes after the
 * app is opened again too; a file waits while the app is open.
 */
interface Outgoing {
  id: string;
  chat: string;
  t: number;
  kind: 'text' | 'file' | 'voice';
  text: string;
  quote?: string;
  blob?: Blob;
  name?: string;
  doc?: boolean;
  seconds?: number;
  local?: string;
  queue: boolean;
  /** The last try ended with no answer: it may have gone — the next one is asked by the key first. */
  unsure?: boolean;
  queued?: boolean;
  running?: boolean;
  /** It cannot go by itself (said why): not kept for the next start. */
  failed?: boolean;
  tries: number;
  settle?: { resolve: (m: WaMessage) => void; reject: (e: unknown) => void };
}
const outgoing = new Map<string, Outgoing>();
/** A file going up: its way to stop it («×» on its progress). */
const uploads = new Map<string, () => void>();
const QUEUE_KEY = 'mygarage.wa.queue';

/** No answer, or an answer that says «not now»: tried again by itself. */
const transient = (e: unknown): boolean => e instanceof SyncError && (e.status === 0 || e.status === 409 || e.status === 429 || e.status === 503 || e.status === 502 || e.status === 504);
/** No answer at all: whether it went is not known. */
const unknownEnd = (e: unknown): boolean => e instanceof SyncError && (e.status === 0 || e.status === 502 || e.status === 504);

/** The texts waiting for the network, kept on this device (only the words one typed, nothing of WhatsApp's). */
function keepQueue() {
  const texts = [...outgoing.values()].filter((o) => o.kind === 'text' && o.queue && !o.failed).map((o) => ({ id: o.id, chat: o.chat, t: o.t, text: o.text, quote: o.quote }));
  try {
    if (texts.length) globalThis.localStorage?.setItem(QUEUE_KEY, JSON.stringify(texts.slice(-60)));
    else globalThis.localStorage?.removeItem(QUEUE_KEY);
  } catch {
    // kept while the app is open
  }
}

function pendingOf(o: Outgoing, quote?: WaMessage): WaMessage {
  const type = o.kind === 'text' ? 'chat' : o.kind === 'voice' ? 'ptt' : (() => {
    const kind = o.doc ? 'doc' : sendKind({ type: o.blob?.type ?? '', name: o.name ?? '' });
    return kind === 'photo' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'document';
  })();
  return {
    id: o.id,
    chat: o.chat,
    t: o.t,
    me: true,
    type,
    text: o.kind === 'voice' ? '' : o.text,
    ack: 0,
    pending: true,
    local: o.local,
    ...(o.blob ? { file: { mime: o.blob.type, name: o.name, size: o.blob.size, here: true, ...(o.seconds ? { sec: Math.max(1, Math.round(o.seconds)) } : {}) } } : {}),
    ...(quote ? { quote: { id: quote.id, type: quote.type, text: quote.text, me: quote.me, thumb: quote.file?.thumb } } : {}),
  };
}

/** A file up to the server — with how much of it went (the bubble's ring), stoppable. */
function upload(o: Outgoing, query: Record<string, string>): Promise<{ msg: WaMessage }> {
  const blob = o.blob!;
  if (transport) return transport('file', { method: 'POST', file: blob, query, timeout: 300_000 }) as Promise<{ msg: WaMessage }>;
  const cfg = syncConfig();
  if (!cfg) return Promise.reject(new SyncError(0, 'no server'));
  return new Promise<{ msg: WaMessage }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${filesBase(cfg)}/api/wa/file?${new URLSearchParams(query).toString()}`);
    x.setRequestHeader('Authorization', `Bearer ${cfg.token}`);
    x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    x.timeout = 300_000;
    let shown = 0;
    x.upload.onprogress = (e) => {
      if (!e.lengthComputable || !e.total) return;
      const p = e.loaded / e.total;
      // A step at a time (not every packet): the chat draws one bubble again, not on every few kilobytes.
      if (p - shown >= 0.04 || (p >= 1 && shown < 1)) {
        shown = p;
        patchMsg(o.chat, o.id, { progress: Math.min(1, p) });
      }
    };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        try {
          resolve(JSON.parse(x.responseText) as { msg: WaMessage });
        } catch {
          reject(new SyncError(502, 'bad answer'));
        }
      } else reject(new SyncError(x.status, x.statusText));
    };
    x.onerror = () => reject(new SyncError(0, 'offline'));
    x.ontimeout = () => reject(new SyncError(0, 'timeout'));
    x.onabort = () => reject(new AppError('wa.err.stopped'));
    uploads.set(o.id, () => x.abort());
    x.send(blob);
  }).finally(() => uploads.delete(o.id));
}

async function attemptOf(o: Outgoing): Promise<WaMessage> {
  if (o.kind === 'text') {
    const r = await call<{ msg: WaMessage }>('send', { method: 'POST', body: { chat: o.chat, text: o.text, quote: o.quote, key: o.id }, timeout: 80_000 });
    return r.msg;
  }
  const query: Record<string, string> = { chat: o.chat, name: o.name || 'file', key: o.id };
  if (o.kind === 'voice') query.voice = '1';
  else {
    if (o.text) query.caption = o.text;
    if (o.doc || sendKind({ type: o.blob?.type ?? '', name: o.name ?? '' }) === 'doc') query.doc = '1';
  }
  if (o.quote) query.quote = o.quote;
  const r = await upload(o, query);
  return o.kind === 'voice' && r.msg.file && o.seconds ? { ...r.msg, file: { ...r.msg.file, sec: r.msg.file.sec || Math.max(1, Math.round(o.seconds)) } } : r.msg;
}

/** One try of a send; its end decides: sent, waiting for the network, or not sent (with why). */
async function run(id: string): Promise<void> {
  const o = outgoing.get(id);
  if (!o || o.running) return;
  o.running = true;
  o.queued = false;
  o.failed = false;
  o.tries++;
  patchMsg(o.chat, id, { pending: true, failed: false, queued: false, checking: !!o.unsure, err: undefined, progress: o.kind === 'text' ? undefined : 0 });
  keepQueue();
  try {
    if (!waReady()) throw new SyncError(409, 'not ready');
    const msg = await attemptOf(o);
    if (outgoing.get(id) !== o) return;
    outgoing.delete(id);
    keepQueue();
    settle(o.chat, id, msg, o.local);
    o.settle?.resolve(msg);
  } catch (e) {
    o.running = false;
    // Taken out of the chat meanwhile («Удалить»): nothing more to say.
    if (outgoing.get(id) !== o) return;
    if (o.queue && transient(e)) {
      o.queued = true;
      o.unsure = o.unsure || unknownEnd(e);
      patchMsg(o.chat, id, { pending: true, queued: true, checking: false, progress: undefined });
      keepQueue();
      later(o.tries < 3 ? 3000 : 10_000);
      return;
    }
    const err = failure(e);
    o.failed = true;
    shownInChat.add(err);
    o.unsure = o.unsure || unknownEnd(e);
    patchMsg(o.chat, id, { pending: true, failed: true, queued: false, checking: false, progress: undefined, err: err instanceof AppError ? err.code : 'wa.err.failed' });
    keepQueue();
    o.settle?.reject(err);
    o.settle = undefined;
  }
}

/** Failures said by their message in the chat (the screen does not say them again). */
const shownInChat = new WeakSet<object>();
export const inChat = (e: unknown): boolean => typeof e === 'object' && !!e && shownInChat.has(e);

let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** Nothing being sent (a played server begins afresh). */
function forgetSends() {
  for (const stop of uploads.values()) stop();
  outgoing.clear();
  uploads.clear();
  clearTimeout(flushTimer);
  flushTimer = undefined;
}
function later(ms: number) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushWa();
  }, ms);
}
let flushing = false;
/**
 * What waits for the network, sent — in the order it was written, each chat's own after one another (v0.84). Asked when
 * the network or the app comes back, when WhatsApp is ready again, and every few seconds while something waits.
 */
export async function flushWa(): Promise<void> {
  if (flushing) return;
  const waiting = [...outgoing.values()].filter((o) => o.queued && !o.running).sort((a, b) => a.t - b.t);
  if (!waiting.length) return;
  flushing = true;
  try {
    if (!waReady()) await refreshWa();
    if (!waReady()) return later(10_000);
    for (const o of waiting) {
      if (!outgoing.has(o.id)) continue;
      await run(o.id);
      // Still no network: the rest wait with it (a later one does not overtake).
      if (outgoing.get(o.id)?.queued) break;
    }
  } finally {
    flushing = false;
  }
  if ([...outgoing.values()].some((o) => o.queued)) later(10_000);
}

/** A send begun: in the chat at once, then as WhatsApp has it. */
function begin(o: Omit<Outgoing, 'tries' | 't' | 'id'> & { id?: string; t?: number }, quote?: WaMessage, after?: Promise<unknown>): Promise<WaMessage> {
  const out: Outgoing = { ...o, id: o.id ?? `p:${uid()}`, t: o.t ?? Date.now(), tries: 0, quote: quote?.id ?? o.quote };
  outgoing.set(out.id, out);
  putPending(out.chat, pendingOf(out, quote));
  const done = new Promise<WaMessage>((resolve, reject) => (out.settle = { resolve, reject }));
  if (after) void after.catch(() => undefined).then(() => run(out.id));
  else void run(out.id);
  return done;
}

/**
 * A text to the chat: shown at once as on its way, then as WhatsApp has it — or as not sent (thrown too). `queue` (the
 * chat's own field): no network — it waits and goes by itself; thrown only when it cannot go at all.
 */
export async function sendWaText(chat: string, text: string, quote?: WaMessage, opts: { queue?: boolean } = {}): Promise<WaMessage> {
  const words = text.trim();
  if (!words) throw new AppError('wa.err.empty');
  if (!opts.queue && !waReady()) throw new AppError('wa.err.notReady');
  return begin({ chat, kind: 'text', text: words, queue: !!opts.queue }, quote);
}

/** A message that did not go, sent again — the same one, under the same key: if it went after all, it is not sent twice. */
export function retryWa(chat: string, id: string): Promise<WaMessage> | undefined {
  const o = outgoing.get(id);
  if (!o || o.chat !== chat || o.running) return undefined;
  o.queued = false;
  const done = new Promise<WaMessage>((resolve, reject) => (o.settle = { resolve, reject }));
  void run(id);
  return done;
}
/** Can it be sent again from here (its words or its file are still here)? */
export const canRetryWa = (id: string): boolean => outgoing.has(id);

/** A file going up stopped: it stays in the chat, not sent — «Повторить» or «Удалить». */
export function stopWaUpload(id: string) {
  uploads.get(id)?.();
}

/**
 * A message that did not go (or waits): taken out of the chat. One still going up is stopped; one whose answer never came
 * may have gone — WhatsApp has it then, and the chat shows it when read again.
 */
export function dropFailed(chat: string, id: string) {
  outgoing.delete(id);
  uploads.get(id)?.();
  keepQueue();
  const list = store.messages[chat];
  if (list?.some((m) => m.id === id && (m.failed || m.pending))) set({ messages: { ...store.messages, [chat]: list.filter((m) => m.id !== id) } });
}

/**
 * A message forwarded to another chat (v0.80.3, the owner: «пересылка в каждом сообщении; если это клиент — короткое
 * примечание, от какого клиента»): WhatsApp's own forwarding (the file goes with it); `note` — a line sent just before it.
 */
export async function forwardWa(message: Pick<WaMessage, 'id'>, to: string, note?: string): Promise<void> {
  if (!waReady()) throw new AppError('wa.err.notReady');
  if (note?.trim()) await sendWaText(to, note);
  try {
    await call('forward', { method: 'POST', body: { id: message.id, to }, timeout: 90_000 });
  } catch (e) {
    throw failure(e);
  }
}

/**
 * A message of ours taken back for everyone (v0.83, the owner: «удалять у всех сообщения»): WhatsApp's «Удалить у всех»,
 * through the garage's server; in the chat it becomes «Сообщение удалено» at once (the server's stream says the same a
 * moment later). Too late for WhatsApp — said so, nothing deleted.
 */
export async function deleteWaForAll(message: Pick<WaMessage, 'id' | 'chat'>): Promise<void> {
  if (!waReady()) throw new AppError('wa.err.notReady');
  let r: { msg?: WaMessage | null };
  try {
    r = await call<{ msg?: WaMessage | null }>('delete', { method: 'POST', body: { id: message.id }, timeout: 60_000 });
  } catch (e) {
    if (e instanceof SyncError && e.status === 409) throw new AppError('wa.delAll.late');
    throw failure(e);
  }
  if (r.msg) waSaid({ t: 'msg', msg: r.msg, chat: null, was: true });
}

/**
 * A voice message (v0.81, the user's brief: «удержание микрофона начинает запись, отпускание отправляет голосовое в текущий
 * чат… сразу показывать голосовое в переписке со статусом отправки; при сбое — ошибка и повтор»): in the chat at once as
 * on its way (playable from here), sent as WhatsApp's own voice message — the bridge makes it Opus in Ogg, as WhatsApp
 * records them (server/whatsapp/voice.mjs). v0.84: no network — it waits and goes by itself; not sent — «Повторить» sends
 * the same recording under the same key.
 */
export async function sendWaVoice(chat: string, blob: Blob, seconds: number, quote?: WaMessage): Promise<WaMessage> {
  if (blob.size > MAX_FILE_BYTES) throw new AppError('wa.err.tooBig');
  const ext = /mp4|aac|m4a/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
  const local = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : undefined;
  return begin({ chat, kind: 'voice', text: '', blob, name: `voice.${ext}`, seconds, local, queue: true }, quote);
}

/**
 * A file to the chat (a photo, a video, a PDF…), with its caption. `doc`: as a document even if it is a picture. `queue`
 * (the chat's own «＋» and camera, v0.84): no network — it waits; a ring shows how much of it went up.
 */
export async function sendWaFile(chat: string, file: Blob, opts: { name: string; caption?: string; doc?: boolean; quote?: WaMessage; queue?: boolean; /** Sent once this has ended (the files picked together go in their order). */ after?: Promise<unknown> } = { name: 'file' }): Promise<WaMessage> {
  if (!opts.queue && !waReady()) throw new AppError('wa.err.notReady');
  if (file.size > MAX_FILE_BYTES) throw new AppError('wa.err.tooBig');
  const kind = opts.doc ? 'doc' : sendKind({ type: file.type, name: opts.name });
  const local = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && (kind === 'photo' || kind === 'video') ? URL.createObjectURL(file) : undefined;
  return begin({ chat, kind: 'file', text: opts.caption?.trim() ?? '', blob: file, name: opts.name, doc: opts.doc, local, queue: !!opts.queue }, opts.quote, opts.after);
}

/* ---------- What is typed and not sent yet (v0.84) ---------- */

/**
 * A chat's draft — the same in «WhatsApp» and on a job's tab (one chat, one draft), back after the app is opened again
 * (only the words one typed are kept on this device). The message being answered stays with its chat while the app is
 * open: another job opened meanwhile does not take it.
 */
const DRAFTS_KEY = 'mygarage.wa.drafts';
let draftsCache: Record<string, string> | undefined;
function draftsAll(): Record<string, string> {
  if (!draftsCache) {
    try {
      draftsCache = JSON.parse(globalThis.localStorage?.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>;
    } catch {
      draftsCache = {};
    }
  }
  return draftsCache;
}
let draftsSave: ReturnType<typeof setTimeout> | undefined;
export const waDraft = (chat: string): string => draftsAll()[chat] ?? '';
export function setWaDraft(chat: string, text: string) {
  const all = draftsAll();
  if ((all[chat] ?? '') === text) return;
  if (text) all[chat] = text;
  else delete all[chat];
  clearTimeout(draftsSave);
  draftsSave = setTimeout(() => {
    try {
      const keys = Object.keys(all);
      // The newest 80 chats' drafts: nobody keeps more open at once.
      for (const k of keys.slice(0, Math.max(0, keys.length - 80))) delete all[k];
      if (Object.keys(all).length) globalThis.localStorage?.setItem(DRAFTS_KEY, JSON.stringify(all));
      else globalThis.localStorage?.removeItem(DRAFTS_KEY);
    } catch {
      // kept while the app is open
    }
  }, 300);
}
const replies = new Map<string, WaMessage>();
export const waReplyOf = (chat: string): WaMessage | null => replies.get(chat) ?? null;
export function setWaReply(chat: string, m: WaMessage | null) {
  if (m) replies.set(chat, m);
  else replies.delete(chat);
}

/** A recording that was stopped before it was sent (a call, the app put away, another chat opened): its chat keeps it. */
export interface VoiceDraft {
  blob: Blob;
  seconds: number;
  url: string;
  /** Why it stopped: by hand (locked, «■»), or by something else. */
  how: 'stopped' | 'interrupted';
}
export const waVoiceDraft = (chat: string, s: WaStore = store): VoiceDraft | undefined => s.voices[chat];
export function setWaVoiceDraft(chat: string, v: VoiceDraft | null) {
  const had = store.voices[chat];
  if (had && had !== v) URL.revokeObjectURL?.(had.url);
  const next = { ...store.voices };
  if (v) next[chat] = v;
  else delete next[chat];
  set({ voices: next });
}

/** The texts left waiting when the app was closed: back in their chats, on their way again. */
function restoreQueue() {
  let texts: { id: string; chat: string; t: number; text: string; quote?: string }[] = [];
  try {
    texts = JSON.parse(globalThis.localStorage?.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return;
  }
  for (const x of texts) {
    if (!x?.id || !x.chat || !x.text || outgoing.has(x.id)) continue;
    const o: Outgoing = { id: x.id, chat: x.chat, t: x.t, kind: 'text', text: x.text, quote: x.quote, queue: true, queued: true, unsure: true, tries: 1 };
    outgoing.set(o.id, o);
    putPending(o.chat, { ...pendingOf(o), queued: true });
  }
  if (outgoing.size) later(2000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushWa());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void flushWa());
  restoreQueue();
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
/**
 * What makes a chat the garage's (v0.81, «Только гараж»): the statuses given by hand, and the groups the garage writes to
 * by itself — the work group, the boss, the wash, the customers' own groups.
 */
export async function loadChatRoles(): Promise<ChatRoles> {
  const [settings, customers] = await Promise.all([getSettings(), db.customers.filter((c) => !!c.waGroup).toArray()]);
  const auto = waAutoOf(settings.waAuto);
  const groups = new Set([auto.work.to?.chat, auto.boss.to?.chat, auto.wash.to?.chat, ...customers.map((c) => c.waGroup?.chat)].filter((x): x is string => !!x));
  return { tags: settings.waChatTags ?? {}, groups, ai: settings.waChatAi ?? {} };
}

/** Chats picked in the list given one status (or theirs taken off — null): kept with the garage's settings. */
export async function tagChats(ids: string[], tag: WaTag | null): Promise<void> {
  const tags = { ...((await getSettings()).waChatTags ?? {}) };
  for (const id of ids) {
    if (tag) tags[id] = tag;
    else delete tags[id];
  }
  await saveSettings({ waChatTags: tags });
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
  /** «Только гараж» (v0.81): the list shows the chats that are something to the garage — on by default. */
  garageOnly: boolean;
}
const PREFS_KEY = 'mygarage.wa';
const DEFAULT_PREFS: WaPrefs = { direct: true, seen: true, garageOnly: true };
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
    if (ev.state.phase === 'ready' && was !== 'ready') later(300);
    return;
  }
  if (ev.t === 'chats') {
    // The server read its list anew (every ten minutes, and after a new chat): this one follows, if it is in use.
    if (store.chatsAt) void loadChats(true);
    else if (store.status) set({ status: { ...store.status, unread: ev.unread, chats: ev.n } });
    return;
  }
  if (ev.t === 'gap') {
    // The server did not hear WhatsApp for a moment (v0.87): what is on a screen is read again.
    catchUpWa();
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
