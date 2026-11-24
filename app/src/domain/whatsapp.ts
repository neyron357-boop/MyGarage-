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
 * finds them. A search goes by the garage's name, WhatsApp's name and the number as it is said («050…»).
 */
export function filterChats(chats: WaChat[], opts: { tab: ChatTab; query?: string; people: Map<string, Who> }): WaChat[] {
  const q = fold(opts.query ?? '');
  const qDigits = q.replace(/\D/g, '').replace(/^0+/, '');
  const out = chats.filter((c) => {
    const who = whoOf(c, opts.people);
    if (q) {
      const names = fold(`${who?.name ?? ''} ${c.name}`);
      const byName = names.includes(q);
      const byNumber = qDigits.length >= 3 && c.phone.includes(qDigits);
      if (!byName && !byNumber) return false;
    } else if (c.archived) return false;
    if (opts.tab === 'unread') return c.unread > 0;
    if (opts.tab === 'customers') return who?.kind === 'customer';
    if (opts.tab === 'suppliers') return who?.kind === 'supplier';
    if (opts.tab === 'groups') return c.group;
    return true;
  });
  return orderChats(out);
}

/** How many chats of each tab wait to be read (the tab's number). */
export function tabCounts(chats: WaChat[], people: Map<string, Who>): Record<ChatTab, number> {
  const n: Record<ChatTab, number> = { all: 0, unread: 0, customers: 0, suppliers: 0, groups: 0 };
  for (const c of chats) {
    if (c.archived || !c.unread) continue;
    n.all++;
    n.unread++;
    const who = whoOf(c, people);
    if (who?.kind === 'customer') n.customers++;
    if (who?.kind === 'supplier') n.suppliers++;
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

export type Ticks = 'failed' | 'wait' | 'sent' | 'got' | 'read';
/** One's own message's ticks: on its way, sent, delivered, read. */
export function ticksOf(m: Pick<WaMessage, 'ack' | 'pending' | 'failed'>): Ticks {
  if (m.failed || m.ack < 0) return 'failed';
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

/** A chat's messages with these put in: one of the same id replaces it, the order is the time's. */
export function mergeMessages(have: WaMessage[], more: WaMessage[]): WaMessage[] {
  if (!more.length) return have;
  const by = new Map(have.map((m) => [m.id, m]));
  for (const m of more) by.set(m.id, { ...by.get(m.id), ...m, pending: m.pending, failed: m.failed, local: m.local ?? by.get(m.id)?.local });
  // (Messages of the same second keep the order they came in: WhatsApp's times are whole seconds.)
  return [...by.values()].sort((a, b) => a.t - b.t);
}

const putChat = (chats: WaChat[], row: WaChat): WaChat[] => (chats.some((c) => c.id === row.id) ? chats.map((c) => (c.id === row.id ? { ...c, ...row } : c)) : [row, ...chats]);

/**
 * The lists after an event: a message goes to its chat (if that chat's messages were read) and to the chat's line; its
 * ticks change in both; a chat's line changes. `was`: a message changed (edited, taken back) — it does not become the
 * chat's last one. Nothing changed — the same lists come back (the screens do not draw again).
 */
export function applyEvent(lists: WaLists, ev: WaEvent): WaLists {
  if (ev.t === 'msg') {
    let chats = ev.chat ? putChat(lists.chats, ev.chat) : lists.chats;
    const have = lists.messages[ev.msg.chat];
    // What was written here and is now on WhatsApp: the waiting copy leaves (the same words, sent within the minute).
    let list = have;
    if (have) {
      const waiting = ev.msg.me ? have.find((m) => m.pending && !m.failed && m.text === ev.msg.text && (m.type === ev.msg.type || !!m.file === !!ev.msg.file) && Math.abs(m.t - ev.msg.t) < 120_000) : undefined;
      const rest = waiting ? have.filter((m) => m !== waiting) : have;
      list = mergeMessages(rest, [waiting?.local && !ev.msg.local ? { ...ev.msg, local: waiting.local } : ev.msg]);
    }
    if (!ev.chat && !ev.was) {
      const last: WaLast = { id: ev.msg.id, t: ev.msg.t, me: ev.msg.me, type: ev.msg.type, text: ev.msg.text.slice(0, 160), ack: ev.msg.ack, name: ev.msg.file?.name, sec: ev.msg.file?.sec, from: ev.msg.from?.name };
      chats = chats.map((c) => (c.id === ev.msg.chat && ev.msg.t >= c.t ? { ...c, t: ev.msg.t, last } : c));
    }
    return { chats, messages: list === have ? lists.messages : { ...lists.messages, [ev.msg.chat]: list! } };
  }
  if (ev.t === 'ack') {
    const have = lists.messages[ev.chat];
    const hit = have?.some((m) => m.id === ev.id && m.ack !== ev.ack);
    const inList = lists.chats.some((c) => c.id === ev.chat && c.last?.id === ev.id && c.last.ack !== ev.ack);
    if (!hit && !inList) return lists;
    return {
      chats: inList ? lists.chats.map((c) => (c.id === ev.chat && c.last?.id === ev.id ? { ...c, last: { ...c.last, ack: ev.ack } } : c)) : lists.chats,
      messages: hit ? { ...lists.messages, [ev.chat]: have!.map((m) => (m.id === ev.id ? { ...m, ack: ev.ack } : m)) } : lists.messages,
    };
  }
  if (ev.t === 'chat') return { ...lists, chats: putChat(lists.chats, ev.chat) };
  return lists;
}
