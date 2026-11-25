import { dubaiDate } from './dates';
import { normalizePhone, phoneDigits } from './phone';

/*
 * The garage's WhatsApp in the app (v0.78, the user: «полная интеграция, профессиональная панель, добавление чатов»):
 * the garage's server is one linked device of the account (server/whatsapp), the app shows its chats and sends
 * through it. Here — the rules, with no server and no screen: whose chat it is (a customer's, a supplier's — by the
 * number), what a chat's line says, which chats a tab shows, how what WhatsApp says changes the lists.
 */

export type WaPhase = 'off' | 'starting' | 'qr' | 'loading' | 'ready' | 'offline';

/** Where the garage's WhatsApp stands, as the server says. */
export interface WaStatus {
  /** The bridge can run on the server: its packages are installed and there is a browser. */
  available: boolean;
  installed: boolean;
  browser: boolean;
  /** Turned on (it was linked, or is being linked). */
  on: boolean;
  phase: WaPhase;
  /** The server is a linked device of the account. */
  linked: boolean;
  /** The QR to scan from the phone (a picture's address), while waiting to be linked. */
  qr: string;
  qrAt: number;
  /** The code to type on the phone instead of the QR. */
  code: string;
  loading: number;
  me: { id: string; phone: string; name: string } | null;
  platform: string;
  web: string;
  error: string;
  chats: number;
  unread: number;
}

export interface WaLast {
  id: string;
  t: number;
  me: boolean;
  type: string;
  text: string;
  ack: number;
  name?: string;
  sec?: number;
  /** In a group: who wrote it. */
  from?: string;
}

export interface WaChat {
  id: string;
  /** The name WhatsApp shows (the phone's contact, else the number). */
  name: string;
  group: boolean;
  /** The person's number, digits only ('' — a group). */
  phone: string;
  unread: number;
  t: number;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  /** The account's own chat («Вы»). */
  self: boolean;
  last: WaLast | null;
}

export interface WaFile {
  mime?: string;
  name?: string;
  size?: number;
  sec?: number;
  w?: number;
  h?: number;
  /** The small blurred preview WhatsApp sends with a photo (JPEG, base64). */
  thumb?: string;
  /** Still on WhatsApp's servers (an old file is only on the phone). */
  here: boolean;
}

export interface WaMessage {
  id: string;
  chat: string;
  t: number;
  me: boolean;
  type: string;
  text: string;
  /** −1 not sent · 0 on its way · 1 sent · 2 delivered · 3 read · 4 played. */
  ack: number;
  file?: WaFile;
  from?: { id: string; name?: string; phone?: string };
  quote?: { id?: string; type: string; text: string; me: boolean; thumb?: string };
  place?: { lat: number; lng: number };
  card?: { name: string; phone: string };
  fwd?: boolean;
  star?: boolean;
  /** Written here and not on WhatsApp yet; `failed` — it did not go (a tap sends it again). */
  pending?: boolean;
  failed?: boolean;
  /**
   * Waiting for the network (v0.84): it goes by itself when the server answers again — under the same key, so it is never
   * sent twice. `checking` — the last try ended without an answer: whether it went is asked by its key first.
   */
  queued?: boolean;
  checking?: boolean;
  /** A file on its way to the server: how much of it went (0–1). */
  progress?: number;
  /** Why it did not go (an i18n key, `wa.err.*`). */
  err?: string;
  /** A file being sent: shown from this address until WhatsApp has it. */
  local?: string;
}

/* ---------- Whose chat ---------- */

export type WhoKind = 'customer' | 'supplier' | 'employee' | 'driver';
export interface Who {
  kind: WhoKind;
  id: string;
  name: string;
}
export interface Person {
  kind: WhoKind;
  id: string;
  name: string;
  /** As kept: E.164, or as typed long ago («050 123 4567»). */
  phones: (string | undefined)[];
}

/** A number's digits as WhatsApp has them («971501234567») — none for what is not a number. */
export function waDigits(phone: string | undefined): string {
  if (!phone) return '';
  const d = phoneDigits(normalizePhone(phone) ?? '');
  return d.length >= 8 ? d : '';
}

/** A chat's own screen in the app. */
export const chatPath = (id: string): string => `/whatsapp/chat/${encodeURIComponent(id)}`;

/** A person's chat by the number. */
export function chatIdOf(phone: string | undefined): string {
  const d = waDigits(phone);
  return d ? `${d}@c.us` : '';
}

const RANK: Record<WhoKind, number> = { customer: 0, supplier: 1, employee: 2, driver: 3 };

/** The garage's people by their numbers: a number two of them share is the customer's, then the supplier's. */
export function peopleIndex(people: Person[]): Map<string, Who> {
  const out = new Map<string, Who>();
  for (const p of people) {
    for (const phone of p.phones) {
      const d = waDigits(phone);
      if (!d) continue;
      const have = out.get(d);
      if (!have || RANK[p.kind] < RANK[have.kind]) out.set(d, { kind: p.kind, id: p.id, name: p.name });
    }
  }
  return out;
}

export const whoOf = (chat: Pick<WaChat, 'phone' | 'group'>, people: Map<string, Who>): Who | undefined => (chat.group || !chat.phone ? undefined : people.get(chat.phone));

/** What a chat is called here: the garage's own name for the person, else WhatsApp's, else the number. */
export function chatTitle(chat: Pick<WaChat, 'name' | 'phone' | 'group'>, who?: Who): string {
  return who?.name?.trim() || chat.name.trim() || (chat.phone ? `+${chat.phone}` : '');
}

/* ---------- The garage's chats (v0.81) ---------- */

/**
 * A status the manager gives chats by hand (v0.81, the user's brief: «отметить несколько чатов и одним действием присвоить им
 * общий статус — «Клиент», «Поставщик» или «Услуги»»): kept with the garage's settings (`Settings.waChatTags`), the same
 * on every device; it is only what the chat is to the garage — no customer or supplier is made of it.
 */
export type WaTag = 'customer' | 'supplier' | 'service' | 'work';
export const WA_TAGS: WaTag[] = ['customer', 'supplier', 'service', 'work'];

/** What makes a chat the garage's own: its statuses given by hand, and the groups the garage writes to by itself. */
export interface ChatRoles {
  tags: Record<string, WaTag>;
  /** The work group, the boss, the wash, the customers' own groups (domain/waAuto.ts, `Customer.waGroup`). */
  groups: Set<string>;
}
export const NO_ROLES: ChatRoles = { tags: {}, groups: new Set() };

/**
 * What a chat is to the garage, if anything: the person behind its number (a customer, a supplier, a mechanic, a driver —
 * the statuses the base gives by itself), else the status given by hand, else a group the garage writes to («work»).
 */
export function chatRole(chat: Pick<WaChat, 'id' | 'phone' | 'group'>, people: Map<string, Who>, roles: ChatRoles): WhoKind | WaTag | undefined {
  return whoOf(chat, people)?.kind ?? roles.tags[chat.id] ?? (roles.groups.has(chat.id) ? 'work' : undefined);
}

/* ---------- The list ---------- */

export type ChatTab = 'all' | 'unread' | 'customers' | 'suppliers' | 'groups';
export const CHAT_TABS: ChatTab[] = ['all', 'unread', 'customers', 'suppliers', 'groups'];

/** Pinned on top, then the newest first. */
export function orderChats<T extends Pick<WaChat, 'pinned' | 't' | 'id'>>(chats: T[]): T[] {
  return [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.t - a.t || (a.id < b.id ? -1 : 1));
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

/**
 * The chats of a tab, in the list's order. Archived chats are out of every tab (WhatsApp hides them too) — a search
 * finds them. A search goes by the garage's name, WhatsApp's name and the number however it is typed («050 123-45-67»,
 * «+971…», «00971…»).
 */
export function filterChats(chats: WaChat[], opts: { tab: ChatTab; query?: string; people: Map<string, Who>; roles?: ChatRoles; garageOnly?: boolean }): WaChat[] {
  const q = fold(opts.query ?? '');
  // Letters in it — a name, not a number («Ali 2» is not «2»).
  const qDigits = /\p{L}/u.test(q) ? '' : searchDigits(q);
  const roles = opts.roles ?? NO_ROLES;
  const out = chats.filter((c) => {
    const who = whoOf(c, opts.people);
    const role = chatRole(c, opts.people, roles);
    if (q) {
      const names = fold(`${who?.name ?? ''} ${c.name}`);
      const byName = names.includes(q);
      const byNumber = !!qDigits && c.phone.includes(qDigits);
      if (!byName && !byNumber) return false;
    } else if (c.archived) return false;
    // «Только гараж» (v0.81): the chats that are something to the garage (and oneself). A search keeps to it too (v0.84,
    // «поиск по имени и номеру учитывает текущий фильтр»): the list says how many more the whole list has.
    if (opts.garageOnly && !role && !c.self) return false;
    if (opts.tab === 'unread') return c.unread > 0;
    if (opts.tab === 'customers') return role === 'customer';
    if (opts.tab === 'suppliers') return role === 'supplier' || role === 'service';
    if (opts.tab === 'groups') return c.group;
    return true;
  });
  return orderChats(out);
}

/** How many chats of each tab wait to be read (the tab's number). */
export function tabCounts(chats: WaChat[], people: Map<string, Who>, roles: ChatRoles = NO_ROLES, garageOnly = false): Record<ChatTab, number> {
  const n: Record<ChatTab, number> = { all: 0, unread: 0, customers: 0, suppliers: 0, groups: 0 };
  for (const c of chats) {
    if (c.archived || !c.unread) continue;
    const role = chatRole(c, people, roles);
    if (garageOnly && !role && !c.self) continue;
    n.all++;
    n.unread++;
    if (role === 'customer') n.customers++;
    if (role === 'supplier' || role === 'service') n.suppliers++;
    if (c.group) n.groups++;
  }
  return n;
}

/** Messages waiting to be read, as the app's badge says: muted and archived chats do not count. */
export const unreadTotal = (chats: WaChat[]): number => chats.reduce((n, c) => (c.archived || c.muted ? n : n + c.unread), 0);

/* ---------- A message, in a few words ---------- */

export type WaKind = 'text' | 'photo' | 'video' | 'voice' | 'audio' | 'file' | 'sticker' | 'place' | 'card' | 'call' | 'gone' | 'poll' | 'other';

export function kindOf(type: string): WaKind {
  switch (type) {
    case 'chat':
    case 'hsm':
    case 'list':
    case 'list_response':
    case 'buttons_response':
    case 'template_button_reply':
    case 'groups_v4_invite':
      return 'text';
    case 'image':
      return 'photo';
    case 'video':
      return 'video';
    case 'ptt':
      return 'voice';
    case 'audio':
      return 'audio';
    case 'document':
      return 'file';
    case 'sticker':
      return 'sticker';
    case 'location':
      return 'place';
    case 'vcard':
    case 'multi_vcard':
      return 'card';
    case 'call_log':
      return 'call';
    case 'revoked':
      return 'gone';
    case 'poll_creation':
      return 'poll';
    default:
      return 'other';
  }
}

/** «0:07», «12:40» — how long a voice message or a video is. */
export function clock(sec: number | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A message in a line of the list: what kind (the screen draws its symbol and names it) and its own words, if any. */
export function previewOf(last: Pick<WaLast, 'type' | 'text' | 'name' | 'sec'>): { kind: WaKind; words: string } {
  const kind = kindOf(last.type);
  const text = last.text.replace(/\s+/g, ' ').trim();
  if (kind === 'text') return { kind, words: text };
  if (kind === 'voice' || kind === 'audio') return { kind, words: last.sec ? clock(last.sec) : text };
  if (kind === 'file') return { kind, words: text || last.name || '' };
  return { kind, words: text };
}

export type Ticks = 'failed' | 'queued' | 'checking' | 'wait' | 'sent' | 'got' | 'read';
/**
 * One's own message's state (v0.84, the brief: «В очереди», «Отправляется», «Отправлено», «Доставлено», «Прочитано»,
 * «Ошибка отправки», «Проверяем отправку»): waiting for the network, on its way, sent, delivered, read — or not sent.
 */
export function ticksOf(m: Pick<WaMessage, 'ack' | 'pending' | 'failed' | 'queued' | 'checking'>): Ticks {
  if (m.failed || m.ack < 0) return 'failed';
  if (m.pending && m.queued) return 'queued';
  if (m.pending && m.checking) return 'checking';
  if (m.pending || m.ack === 0) return 'wait';
  if (m.ack === 1) return 'sent';
  if (m.ack === 2) return 'got';
  return 'read';
}

/** «1,2 МБ», «340 КБ» — the units are the screen's words. */
export function fileSize(bytes: number | undefined): { n: string; unit: 'kb' | 'mb' } | undefined {
  if (!bytes || bytes <= 0) return undefined;
  if (bytes < 1024 * 1024) return { n: String(Math.max(1, Math.round(bytes / 1024))), unit: 'kb' };
  const mb = bytes / 1024 / 1024;
  return { n: mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1), unit: 'mb' };
}

/**
 * Where the unread begin (v0.84, «при первом открытии с непрочитанными дай ориентир на первое непрочитанное»): the first of
 * the last `unread` messages of the other side — WhatsApp counts only theirs. -1: none (or none of them read yet).
 */
export function firstUnread(list: Pick<WaMessage, 'me'>[], unread: number): number {
  if (unread <= 0) return -1;
  let left = unread;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].me) continue;
    left--;
    if (left === 0) return i;
  }
  // Fewer of theirs read here than WhatsApp counts (older ones not read yet): from the first of them.
  const first = list.findIndex((m) => !m.me);
  return first;
}

/**
 * What a search for a number keeps (v0.84, «поиск номера работает с пробелами, дефисами и международным префиксом»): the
 * digits, without «00» or a leading «0» of the local way of saying it («050 123-45-67» → «501234567», «+971 50…» and
 * «00971 50…» → «97150…»). Fewer than three digits — not a number.
 */
export function searchDigits(query: string): string {
  const d = query.replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 3 ? d : '';
}

/** The messages by day (Dubai), the oldest first. */
export function groupDays(messages: WaMessage[]): [string, WaMessage[]][] {
  const days: [string, WaMessage[]][] = [];
  for (const m of messages) {
    const d = dubaiDate(new Date(m.t));
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(m);
    else days.push([d, [m]]);
  }
  return days;
}

/* ---------- Words with WhatsApp's marks ---------- */

export interface Mark {
  t: string;
  b?: true;
  i?: true;
  s?: true;
  m?: true;
  /** A link: opened in a new window. */
  href?: string;
}

const LINK = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*/gi;
// *bold*, _italic_, ~struck~, `mono`: the mark at a word's edge, no space just inside, on one line.
const STYLE = /(^|[\s([{"'«])([*_~`])(?=\S)([^\n]*?\S)\2(?=$|[\s)\]}.,!?:;"'»])/g;
const STYLE_OF: Record<string, 'b' | 'i' | 's' | 'm'> = { '*': 'b', _: 'i', '~': 's', '`': 'm' };

function styled(text: string): Mark[] {
  const out: Mark[] = [];
  let at = 0;
  STYLE.lastIndex = 0;
  for (let m = STYLE.exec(text); m; m = STYLE.exec(text)) {
    const start = m.index + m[1].length;
    if (start > at) out.push({ t: text.slice(at, start) });
    out.push({ t: m[3], [STYLE_OF[m[2]]]: true });
    at = start + m[2].length * 2 + m[3].length;
    STYLE.lastIndex = at;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}

/** A message's words in pieces: bold, italic, struck, mono (as WhatsApp marks them) and links. Nothing is ever HTML. */
export function marks(text: string): Mark[] {
  const out: Mark[] = [];
  let at = 0;
  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
    // A full stop or a bracket after an address is the sentence's, not the address's.
    const raw = m[0].replace(/[.,!?:;)\]»]+$/, '');
    if (m.index > at) out.push(...styled(text.slice(at, m.index)));
    out.push({ t: raw, href: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
    at = m.index + raw.length;
    LINK.lastIndex = at;
  }
  if (at < text.length) out.push(...styled(text.slice(at)));
  return out;
}

/* ---------- Sending a file ---------- */

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** How a file goes: a picture and an mp4 as WhatsApp shows them, a sound as a sound, the rest as a document. */
export function sendKind(file: { type: string; name: string }): 'photo' | 'video' | 'audio' | 'doc' {
  const type = file.type.toLowerCase();
  if (/^image\/(jpeg|png|webp)$/.test(type)) return 'photo';
  if (type === 'video/mp4') return 'video';
  if (/^audio\//.test(type)) return 'audio';
  return 'doc';
}

/* ---------- What WhatsApp says, into the lists ---------- */

export interface WaLists {
  chats: WaChat[];
  /** The messages read so far, by chat (the oldest first). */
  messages: Record<string, WaMessage[]>;
}

export type WaEvent =
  | { t: 'msg'; msg: WaMessage; chat: WaChat | null; was?: boolean }
  | { t: 'ack'; chat: string; id: string; ack: number }
  | { t: 'chat'; chat: WaChat; unread?: number }
  | { t: 'chats'; n: number; unread: number }
  | { t: 'state'; state: WaStatus };

/**
 * A message's own key — the last part of its id. The same message under a chat's two ids (its number's, and the one
 * WhatsApp hides the number behind — @lid) has the same key.
 */
export const msgKey = (id: string): string => id.slice(id.lastIndexOf('_') + 1);

/**
 * A chat's messages with these put in: one of the same id replaces it, the order is the time's. Its ticks only grow
 * (v0.80): an answer that left WhatsApp before its ticks came — the send's own, a list read a moment ago — does not take
 * a tick away («в приложении в ожидании, а в WhatsApp уже отправилось»).
 */
export function mergeMessages(have: WaMessage[], more: WaMessage[]): WaMessage[] {
  if (!more.length) return have;
  const by = new Map(have.map((m) => [m.id, m]));
  for (const m of more) {
    const was = by.get(m.id);
    const ack = was && m.ack >= 0 && was.ack > m.ack ? was.ack : m.ack;
    by.set(m.id, { ...was, ...m, ack, pending: m.pending, failed: m.failed, local: m.local ?? was?.local });
  }
  // (Messages of the same second keep the order they came in: WhatsApp's times are whole seconds.)
  return [...by.values()].sort((a, b) => a.t - b.t);
}

const putChat = (chats: WaChat[], row: WaChat): WaChat[] => (chats.some((c) => c.id === row.id) ? chats.map((c) => (c.id === row.id ? { ...c, ...row } : c)) : [row, ...chats]);

/**
 * The lists after an event: a message goes to its chat (if that chat's messages were read) and to the chat's line; its
 * ticks change in both; a chat's line changes. `was`: a message changed (edited, taken back) — it does not become the
 * chat's last one. Nothing changed — the same lists come back (the screens do not draw again).
 */
/**
 * Where a message of `chat` is kept here: its own chat's messages — or the same chat read under its other id (v0.80: a
 * number's `…@c.us` and WhatsApp's `…@lid`): by the number, or the list that already has `has` (the message, its copy
 * on the way).
 */
function listOf(lists: WaLists, chat: string, row: WaChat | null, sure: (m: WaMessage) => boolean, copy: (m: WaMessage) => boolean = () => false): string {
  const own = lists.messages[chat];
  if (own?.some((m) => sure(m) || copy(m))) return chat;
  // The message itself under the chat's other id: its key is its own.
  const other = Object.keys(lists.messages).find((c) => c !== chat && lists.messages[c].some(sure));
  if (other) return other;
  // The same person under the other id: by the number (the event's chat says it, or the chats read say whose id it is).
  const phone = row?.phone || (chat.endsWith('@c.us') ? chat.split('@')[0] : lists.chats.find((c) => c.id === chat)?.phone);
  const twins = phone ? [`${phone}@c.us`, ...lists.chats.filter((c) => !c.group && c.phone === phone).map((c) => c.id)].filter((c, i, all) => c !== chat && !!lists.messages[c] && all.indexOf(c) === i) : [];
  return twins.find((c) => lists.messages[c].some(copy)) ?? (own ? chat : (twins[0] ?? chat));
}

export function applyEvent(lists: WaLists, ev: WaEvent): WaLists {
  if (ev.t === 'msg') {
    let chats = ev.chat ? putChat(lists.chats, ev.chat) : lists.chats;
    const key = msgKey(ev.msg.id);
    // What was written here and is now on WhatsApp: the waiting copy leaves (the same words, sent within the minute).
    const waitingFor = (m: WaMessage) => ev.msg.me && !!m.pending && !m.failed && m.text === ev.msg.text && (m.type === ev.msg.type || !!m.file === !!ev.msg.file) && Math.abs(m.t - ev.msg.t) < 120_000;
    // The same message under the chat's other id.
    const twinOf = (m: WaMessage) => !m.pending && m.id !== ev.msg.id && m.me === ev.msg.me && msgKey(m.id) === key;
    const at = listOf(lists, ev.msg.chat, ev.chat, (m) => m.id === ev.msg.id || twinOf(m), waitingFor);
    const have = lists.messages[at];
    let list = have;
    if (have) {
      const waiting = have.find(waitingFor);
      const twin = have.find(twinOf);
      const rest = waiting ? have.filter((m) => m !== waiting) : have;
      list = mergeMessages(rest, [{ ...ev.msg, ...(twin ? { id: twin.id } : {}), ...(waiting?.local && !ev.msg.local ? { local: waiting.local } : {}) }]);
    }
    if (!ev.chat && !ev.was) {
      const last: WaLast = { id: ev.msg.id, t: ev.msg.t, me: ev.msg.me, type: ev.msg.type, text: ev.msg.text.slice(0, 160), ack: ev.msg.ack, name: ev.msg.file?.name, sec: ev.msg.file?.sec, from: ev.msg.from?.name };
      chats = chats.map((c) => ((c.id === ev.msg.chat || c.id === at) && ev.msg.t >= c.t ? { ...c, t: ev.msg.t, last } : c));
    }
    return { chats, messages: list === have ? lists.messages : { ...lists.messages, [at]: list! } };
  }
  if (ev.t === 'ack') {
    // A tick for this message, under whichever id its chat is read; ticks only grow (a late smaller one takes none away).
    const key = msgKey(ev.id);
    const is = (id: string) => id === ev.id || (!id.startsWith('p:') && msgKey(id) === key);
    const grows = (ack: number) => ack !== ev.ack && (ev.ack > ack || ev.ack < 0);
    const at = listOf(lists, ev.chat, null, (m) => is(m.id));
    const have = lists.messages[at];
    const hit = have?.some((m) => is(m.id) && grows(m.ack));
    const lineOf = (c: WaChat) => (c.id === ev.chat || c.id === at) && !!c.last && is(c.last.id) && grows(c.last.ack);
    const inList = lists.chats.some(lineOf);
    if (!hit && !inList) return lists;
    return {
      chats: inList ? lists.chats.map((c) => (lineOf(c) ? { ...c, last: { ...c.last!, ack: ev.ack } } : c)) : lists.chats,
      messages: hit ? { ...lists.messages, [at]: have!.map((m) => (is(m.id) && grows(m.ack) ? { ...m, ack: ev.ack } : m)) } : lists.messages,
    };
  }
  if (ev.t === 'chat') return { ...lists, chats: putChat(lists.chats, ev.chat) };
  return lists;
}
