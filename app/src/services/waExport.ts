import { db } from '../db/db';
import { exportChatName, exportMessages, parseExport, whoIsGarage, type ParsedExport } from '../domain/waExport';
import { chatIdOf, waDigits } from '../domain/whatsapp';
import { unzip } from '../domain/zip';
import { learnFromExport } from './chatStudy';
import { getSettings } from './settings';
import { waStore } from './whatsapp';

/*
 * Chats exported from the garage's phone (v0.91.5, the owner: «у меня нету в настройках включить всю историю» → «Да,
 * сделай»): WhatsApp gives a linked device only its recent history; the phone's own «Export chat» (without media) gives all
 * of it, a chat at a time — a .zip (iPhone, «_chat.txt» in it) or a .txt (Android). Here: each file read (only its text —
 * the photos of an export with media are not even unpacked), matched to the garage's chat (by its name, its number; the
 * person can pick another), which of its two senders is the garage; then what its requests came to is kept with the chat
 * (services/chatStudy.ts `learnFromExport`) — never its words. The file goes nowhere: read here and dropped.
 */

export interface ExportChat {
  id: string;
  phone: string;
  name: string;
}

export interface ExportItem {
  /** The file's own name. */
  file: string;
  /** The chat's name, from the file's name. */
  name: string;
  parsed: ParsedExport;
  /** Which sender is the garage (none — the person says it). */
  garage?: string;
  /** The garage's chat it is (none — the person picks it). */
  chat?: ExportChat;
  from: number;
  to: number;
  /** Messages in it. */
  count: number;
  /** Three or more wrote in it — a group: not studied. */
  group: boolean;
  /** Nothing read of it (not an export). */
  empty: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The chats an export may be: the WhatsApp list, the chats studied, the base's suppliers and customers by their numbers. */
async function candidates(): Promise<ExportChat[]> {
  const out = new Map<string, ExportChat>();
  const put = (c: ExportChat) => {
    if (c.id && !out.has(c.id)) out.set(c.id, c);
  };
  for (const c of waStore().chats) if (!c.group && !c.self) put({ id: c.id, phone: c.phone, name: c.name });
  for (const f of await db.chatFacts.toArray()) if (f.name) put({ id: f.id, phone: f.phone, name: f.name });
  for (const s of await db.suppliers.filter((x) => !x.archivedAt).toArray()) {
    const id = chatIdOf(s.phone);
    if (id) put({ id, phone: waDigits(s.phone), name: s.name });
  }
  for (const c of await db.customers.filter((x) => !x.archivedAt).toArray()) {
    const id = chatIdOf(c.whatsapp || c.phone);
    const name = ((c.type === 'company' && c.companyName) || c.name || '').trim();
    if (id && name) put({ id, phone: waDigits(c.whatsapp || c.phone), name });
  }
  return [...out.values()];
}

/** The chat a name is: the same name (letters and digits), else its number. */
export function matchChat(name: string, list: ExportChat[]): ExportChat | undefined {
  const n = norm(name);
  if (n) {
    const same = list.find((c) => norm(c.name) === n);
    if (same) return same;
  }
  const digits = waDigits(name);
  if (digits) return list.find((c) => c.phone && (c.phone === digits || c.phone.endsWith(digits.slice(-9)))) ?? { id: chatIdOf(name), phone: digits, name };
  return undefined;
}

/** The text of an export file: a .zip's chat (only its .txt unpacked), else the file itself. */
async function textOf(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!zip) return new TextDecoder().decode(bytes);
  const files = await unzip(bytes, (n) => /\.txt$/i.test(n));
  const chat = [...files.entries()].find(([n]) => /(^|\/)_?chat\.txt$/i.test(n)) ?? [...files.entries()][0];
  return chat ? new TextDecoder().decode(chat[1]) : '';
}

/** The files picked, read: each one's chat, its garage side, how many messages from when to when. */
export async function readExports(files: File[]): Promise<ExportItem[]> {
  const [list, settings] = await Promise.all([candidates(), getSettings()]);
  const garageNames = [waStore().status?.me?.name ?? '', settings.name ?? ''].filter(Boolean);
  const out: ExportItem[] = [];
  for (const file of files) {
    let parsed: ParsedExport = { lines: [], senders: [] };
    try {
      parsed = parseExport(await textOf(file));
    } catch {
      // not a zip or not text: nothing read
    }
    const name = exportChatName(file.name);
    const times = parsed.lines.map((l) => l.t);
    out.push({
      file: file.name,
      name,
      parsed,
      garage: whoIsGarage(parsed, name, garageNames),
      chat: matchChat(name, list),
      from: times.length ? Math.min(...times) : 0,
      to: times.length ? Math.max(...times) : 0,
      count: parsed.lines.length,
      group: parsed.senders.length > 2,
      empty: !parsed.lines.length,
    });
  }
  return out;
}

/** The exports with their chat and their garage side, kept with their chats: how many chats, requests, the oldest time. */
export async function learnExports(items: ExportItem[]): Promise<{ chats: number; turns: number; from: number }> {
  let chats = 0;
  let turns = 0;
  let from = 0;
  for (const x of items) {
    if (!x.chat || !x.garage || x.group || x.empty) continue;
    const r = await learnFromExport(x.chat, exportMessages(x.parsed, x.garage));
    chats++;
    turns += r.turns;
    if (r.from && (!from || r.from < from)) from = r.from;
  }
  return { chats, turns, from };
}
