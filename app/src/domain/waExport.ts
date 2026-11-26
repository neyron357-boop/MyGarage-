import { makesInText } from './chatStudy';
import type { WaMessage } from './whatsapp';

/*
 * A chat exported from the garage's phone (v0.91.5, the owner: «у меня нету в настройках включить всю историю» → «Да,
 * сделай» — WhatsApp gives a linked device only the recent history, the phone's own «Export chat» gives all of it): its text
 * read into messages as the study reads them — when, who, the kind, the words. Pure; nothing of it is kept (the study keeps
 * only what the messages came to).
 * The formats seen in WhatsApp's exports:
 *  - iPhone: «[26/11/2026, 14:05:33] Name: words» (a zip with «_chat.txt»), the date in the phone's own order (26.11.26,
 *    11/26/26, 2026-11-26), the time 24-hour or «2:05:33 PM», invisible direction marks before lines and attachments;
 *  - Android: «26/11/2026, 14:05 - Name: words» (a .txt);
 *  - a message of several lines — the next lines without a date; a line of WhatsApp's own (encryption, «X added Y») — no
 *    «Name: »; an attachment — «<attached: 0001-PHOTO-….jpg>», «image omitted», «IMG-….jpg (file attached)», «<Media
 *    omitted>»; a deleted one — «This message was deleted».
 */

export interface ExportLine {
  /** When (ms, the phone's time in Dubai). */
  t: number;
  sender: string;
  /** WhatsApp's kind of message: 'chat', 'image', 'video', 'ptt', 'document', 'sticker', 'revoked', 'call_log'. */
  type: string;
  text: string;
}

export interface ParsedExport {
  lines: ExportLine[];
  /** Who wrote in it, the most first. */
  senders: string[];
}

const MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;
const SPACES = /[    ]/g;
const IOS = /^\[(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]\s?(.*)$/;
const ANDROID = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\s[-–]\s(.*)$/;
/** Dubai: UTC+4, no summer time. */
const DUBAI_MS = 4 * 3600_000;

/** The chat's name from the export's file name («WhatsApp Chat - Name.zip», «WhatsApp Chat with Name.txt», …). */
export function exportChatName(fileName: string): string {
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.(zip|txt)$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(MARKS, '')
    .trim();
  const m = base.match(/^(?:WhatsApp\s+Chat(?:\s*-|\s+with)|Чат\s+WhatsApp\s+с|Переписка\s+WhatsApp\s+с|WhatsApp-чат\s+с|WhatsApp-Chat\s+mit|Chat\s+de\s+WhatsApp\s+con|محادثة\s+واتساب\s+مع)\s*(.+)$/i);
  return (m ? m[1] : base).trim();
}

const ATTACHED =
  /<attached:\s*[^>]*>|\(file attached\)|<Media omitted>|<Медиа (?:файл )?(?:отсутствует|опущен)>|\b(?:image|video|audio|sticker|GIF|document|Contact card) omitted\b|(?:изображение|видео|аудио|стикер|документ|GIF)\s+(?:отсутствует|опущено|пропущено|не включено)|файл не включ|файл прикреплён/i;
const DELETED = /^(?:This message was deleted|You deleted this message|Это сообщение (?:было )?удалено|Вы удалили (?:это )?сообщение)\.?$/i;
const CALL = /^(?:Missed (?:voice|video) call|Voice call|Video call|Пропущенный (?:аудио|видео)?звонок|Аудиозвонок|Видеозвонок)\b/i;

function attachmentKind(text: string): string {
  if (/PHOTO|IMG-|\.(?:jpe?g|png|heic|webp)\b|image omitted|изображение/i.test(text)) return 'image';
  if (/VIDEO|VID-|\.(?:mp4|mov)\b|video omitted|видео/i.test(text)) return 'video';
  if (/AUDIO|PTT-|\.(?:opus|m4a|aac|mp3|ogg)\b|audio omitted|аудио/i.test(text)) return 'ptt';
  if (/STICKER|\.webp\b|sticker omitted|стикер/i.test(text)) return 'sticker';
  return 'document';
}

/** An export's text read into its messages (in their order). */
export function parseExport(raw: string): ParsedExport {
  const rows = raw.replace(/\r\n?/g, '\n').replace(SPACES, ' ').split('\n');
  type Head = { a: string; b: string; c: string; h: number; mi: number; s: number; ap?: string; rest: string };
  const items: { head?: Head; text: string }[] = [];
  for (const row of rows) {
    const line = row.replace(MARKS, '');
    const m = IOS.exec(line) ?? ANDROID.exec(line);
    if (m) items.push({ head: { a: m[1], b: m[2], c: m[3], h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0), ap: m[7], rest: m[8] }, text: '' });
    else if (items.length) items[items.length - 1].text += `\n${line}`;
  }
  // The date's order, by what the file holds: a year first; a day over 12 first; a month over 12 second; else day first (UAE).
  const heads = items.map((x) => x.head!).filter(Boolean);
  const order: 'ymd' | 'dmy' | 'mdy' = heads.some((x) => x.a.length === 4) ? 'ymd' : heads.some((x) => Number(x.a) > 12) ? 'dmy' : heads.some((x) => Number(x.b) > 12) ? 'mdy' : 'dmy';
  const lines: ExportLine[] = [];
  const count = new Map<string, number>();
  for (const x of items) {
    const h = x.head;
    if (!h) continue;
    const [y0, mo, d] = order === 'ymd' ? [h.a, h.b, h.c] : order === 'dmy' ? [h.c, h.b, h.a] : [h.c, h.a, h.b];
    let y = Number(y0);
    if (y < 100) y += 2000;
    let hour = h.h;
    if (h.ap) {
      const pm = /^p/i.test(h.ap);
      if (pm && hour < 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    }
    const t = Date.UTC(y, Number(mo) - 1, Number(d), hour, h.mi, h.s) - DUBAI_MS;
    if (!Number.isFinite(t)) continue;
    // «Name: words»; a line of WhatsApp's own has no name.
    const at = h.rest.indexOf(': ');
    if (at <= 0) continue;
    const sender = h.rest.slice(0, at).trim();
    let text = (h.rest.slice(at + 2) + x.text).trim();
    let type = 'chat';
    if (ATTACHED.test(text)) {
      type = attachmentKind(text);
      text = text.replace(ATTACHED, '').trim();
    } else if (DELETED.test(text)) {
      type = 'revoked';
      text = '';
    } else if (CALL.test(text)) {
      type = 'call_log';
      text = '';
    }
    lines.push({ t, sender, type, text });
    count.set(sender, (count.get(sender) ?? 0) + 1);
  }
  return { lines, senders: [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s) };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Which of the senders is the garage: the account's own name (as WhatsApp gives it), else in a chat of two — the one that is
 * not the chat (its name, or its number), else the one whose messages name cars (the garage asks of its suppliers by the
 * car). None found — undefined (the person says it).
 */
export function whoIsGarage(p: ParsedExport, chatName: string, garageNames: string[]): string | undefined {
  const s = p.senders;
  const own = s.find((x) => garageNames.some((g) => norm(g) && norm(g) === norm(x)));
  if (own) return own;
  if (s.length === 1) return norm(s[0]) === norm(chatName) ? undefined : s[0];
  if (s.length !== 2) return undefined;
  const digits = (x: string) => x.replace(/\D/g, '');
  const them = s.find((x) => norm(x) === norm(chatName) || (digits(chatName).length >= 8 && digits(x).endsWith(digits(chatName).slice(-9))));
  if (them) return s.find((x) => x !== them);
  const cars = (who: string) => p.lines.filter((l) => l.sender === who && makesInText(l.text).length).length;
  const [a, b] = [cars(s[0]), cars(s[1])];
  if (a >= 2 * b + 2) return s[0];
  if (b >= 2 * a + 2) return s[1];
  return undefined;
}

/** The messages as the study reads them: the garage's are `me`. */
export const exportMessages = (p: ParsedExport, garage: string): Pick<WaMessage, 't' | 'me' | 'type' | 'text'>[] => p.lines.map((l) => ({ t: l.t, me: l.sender === garage, type: l.type, text: l.text }));
