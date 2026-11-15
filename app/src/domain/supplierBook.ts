import { canonicalMake } from './carCatalog';
import { normalizePhone } from './phone';
import { BOOK_FRAMES, BOOK_STYLES, BOOK_THEME } from './supplierBookTemplate';
import type { BookCell, Supplier, SupplierBookRow } from './types';
import { unzip, zipStore, type ZipFile } from './zip';

/*
 * The garage's supplier base as a workbook — "UAE_Contacts.xlsx": "Как пользоваться" (a guide with counts),
 * "Контакты" (one row per supplier: ID, company, categories, makes, phone, WhatsApp, area, map, email, sites, all
 * numbers, photos, notes), "Индекс марок" (one row per make and supplier), "Журнал фото" and "Уточнить" (the
 * photos the base was made from and what is still unclear), "Рядом с …" (by the distance from the garage) and
 * "Услуги для гаража" (contractors: machining, exhaust, towing…).
 *
 * Import reads the suppliers from "Контакты" (with their rows on the contractor and nearby sheets) and keeps every
 * column as it came (`Supplier.book`). Export writes the same workbook back: the supplier sheets anew from the
 * app — what the app holds (name, phone, makes, what they do, address, map, notes) as it is now, every other column
 * as it came — and, when the workbook was brought in, all its other sheets and its look untouched. Without one it
 * is built from the same look (`supplierBookTemplate.ts`, taken from the garage's file).
 */

type Row = Record<string, BookCell>;

export const BOOK_FILE = 'UAE_Contacts.xlsx';

const SHEET = { guide: 'Как пользоваться', contacts: 'Контакты', makes: 'Индекс марок', services: 'Услуги для гаража' } as const;
const isNearby = (name: string) => /^рядом/i.test(name.trim());

export const CONTACT_COLS = ['ID', 'Компания / филиал', 'Категории', 'Марки авто', 'Модель / годы', 'Специализация', 'Основной телефон', 'WhatsApp', 'Эмират', 'Район / адрес', 'Геозона', 'Тип деталей', 'Группа марок', 'Карта', 'Email', 'Сайты / соцсети', 'Все номера', 'Фото и позиции', 'Исходное фото', 'Примечания'];
const MAKE_COLS = ['Марка', 'ID', 'Компания', 'Категории', 'Модель / годы', 'Эмират', 'Район', 'Геозона', 'Телефон', 'WhatsApp'];
const NEARBY_COLS = ['Км', 'ID', 'Магазин / филиал', 'Адрес', 'Телефон', 'WhatsApp', 'Марки авто', 'Специализация', 'Карта', 'Маршрут', 'Источник', 'Примечание'];
const SERVICE_COLS = ['ID', 'Услуга', 'Мастерская / служба', 'Что делают', 'Адрес / зона выезда', 'Км', 'Телефон', 'WhatsApp', 'Формат', 'Что уточнить', 'Карта', 'Маршрут', 'Источник'];

/* ---------------- Reading ---------------- */

const unesc = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (tag: string, name: string) => unesc(new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1] ?? '');
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (i: number) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
/** A part's path from a relationship's target (absolute "/xl/…" or relative to the part that points to it). */
const resolve = (from: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
};
const relsPath = (part: string) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};
interface Rel {
  id: string;
  type: string;
  target: string;
  tag: string;
}
const relsOf = (xml: string | undefined): Rel[] =>
  [...(xml ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({ id: attr(m[0], 'Id'), type: attr(m[0], 'Type'), target: attr(m[0], 'Target'), tag: m[0] }));

type Cells = Map<number, Map<number, BookCell>>;

interface Book {
  files: Map<string, Uint8Array>;
  text: (part: string) => string | undefined;
  sheets: { name: string; path: string }[];
  strings: string[];
}

async function openBook(bytes: Uint8Array): Promise<Book> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const text = (part: string) => {
    const f = files.get(part);
    return f ? dec.decode(f) : undefined;
  };
  const wb = text('xl/workbook.xml') ?? '';
  const rels = relsOf(text('xl/_rels/workbook.xml.rels'));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const rel = rels.find((r) => r.id === attr(m[0], 'r:id'));
    return { name: attr(m[0], 'name'), path: rel ? resolve('xl/workbook.xml', rel.target) : '' };
  });
  const strings = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(''));
  return { files, text, sheets: sheets.filter((s) => s.path), strings };
}

/** A sheet's cells (row → column → text and link), its links included. */
function cellsOf(book: Book, path: string): Cells {
  const xml = book.text(path) ?? '';
  const rels = relsOf(book.text(relsPath(path)));
  const links = new Map<string, string>();
  for (const m of xml.matchAll(/<hyperlink\b[^>]*>/g)) {
    const target = rels.find((r) => r.id === attr(m[0], 'r:id'))?.target;
    if (target) links.set(attr(m[0], 'ref'), target);
  }
  const rows: Cells = new Map();
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, BookCell>();
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const t = attr(cm[1], 't');
      const inner = cm[2] ?? '';
      let v = '';
      if (t === 'inlineStr') v = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1])).join('');
      else if (t === 's') v = book.strings[+(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)] ?? '';
      else v = unesc(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      const link = links.get(ref);
      if (!v && !link) continue;
      cells.set(colIndex(ref.replace(/\d+$/, '')), link ? { v, link } : { v });
    }
    rows.set(+attr(rm[1], 'r'), cells);
  }
  return rows;
}

/** The table of a sheet: its header row (the first one with "ID" and `must`) and the rows under it, by header. */
function tableOf(cells: Cells, must: string): { at: number; header: string[]; rows: Row[] } | null {
  for (const [r, row] of cells) {
    if (r > 12) break;
    const names = [...row.values()].map((c) => c.v.trim());
    if (!names.includes('ID') || !names.includes(must)) continue;
    const header: string[] = [];
    for (const [i, c] of row) header[i] = c.v.trim();
    const rows: Row[] = [];
    for (const [rr, cs] of cells) {
      if (rr <= r) continue;
      const rec: Row = {};
      for (const [i, c] of cs) if (header[i]) rec[header[i]] = c;
      if (Object.keys(rec).length) rows.push(rec);
    }
    return { at: r, header, rows };
  }
  return null;
}

const text = (r: Row | undefined, k: string) => r?.[k]?.v.trim() ?? '';
const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '');

const MAKE_SPLIT = /\s*[,;•·/]\s*/;
function makesOf(s: string): string[] | undefined {
  const list = s
    .split(MAKE_SPLIT)
    .map((m) => m.trim())
    .filter((m) => m && !/^(all|any|все|любые)\b/i.test(m))
    .map((m) => canonicalMake(m));
  return list.length ? [...new Set(list)] : undefined;
}
function conditionOf(s: string): Supplier['condition'] {
  const used = /б\/у|\bбу\b|used|second|разбор/i.test(s);
  const fresh = /нов|new|ориг|original|genuine|аналог|aftermarket/i.test(s);
  return used && fresh ? 'both' : used ? 'used' : fresh ? 'new' : undefined;
}
/** A contractor (work done by others) rather than a parts shop. */
const SERVICE_CAT = /автосервис|кузовн|токарн|сварк|ремонт|эвакуат|шиномонтаж|автоэлектр|автостекл|проточк|радиатор/i;

/** A supplier read from the workbook: the app's fields, and the whole row kept for the way back out. */
export type BookSupplier = Pick<Supplier, 'name' | 'phone' | 'makes' | 'condition' | 'parts' | 'service' | 'locationUrl' | 'address' | 'notes'> & { book: SupplierBookRow };

export function supplierOfRow(contact: Row, service?: Row, nearby?: Row): BookSupplier {
  const rawPhone = text(contact, 'Основной телефон');
  const phone = rawPhone.startsWith('+') ? rawPhone.replace(/[^\d+]/g, '') : normalizePhone(rawPhone) ?? (rawPhone || undefined);
  const map = contact['Карта']?.link;
  const cats = text(contact, 'Категории');
  return {
    name: text(contact, 'Компания / филиал'),
    phone: phone || undefined,
    makes: makesOf(text(contact, 'Марки авто')),
    condition: conditionOf(text(contact, 'Тип деталей')),
    parts: text(contact, 'Специализация') || undefined,
    service: !!service || (SERVICE_CAT.test(cats) && !/запчаст/i.test(cats)) || undefined,
    locationUrl: map && /^https?:\/\//i.test(map) ? map : undefined,
    address: text(contact, 'Район / адрес') || undefined,
    notes: text(contact, 'Примечания') || undefined,
    book: { id: text(contact, 'ID'), contact, ...(service ? { service } : {}), ...(nearby ? { nearby } : {}) },
  };
}

/** The suppliers of a supplier base workbook — or null when the workbook is not one (no "Контакты" table). */
export async function readSupplierBook(bytes: Uint8Array): Promise<BookSupplier[] | null> {
  let book: Book;
  try {
    book = await openBook(bytes);
  } catch {
    return null;
  }
  const sheetTable = (pick: (name: string) => boolean, must: string) => {
    const s = book.sheets.find((x) => pick(x.name));
    return s ? tableOf(cellsOf(book, s.path), must) : null;
  };
  const contacts = sheetTable((n) => n === SHEET.contacts, 'Компания / филиал') ?? book.sheets.map((s) => tableOf(cellsOf(book, s.path), 'Компания / филиал')).find(Boolean);
  if (!contacts) return null;
  const byId = (t: { rows: Row[] } | null) => new Map((t?.rows ?? []).filter((r) => text(r, 'ID')).map((r) => [text(r, 'ID'), r]));
  const services = byId(sheetTable((n) => n === SHEET.services, 'Мастерская / служба'));
  const nearby = byId(sheetTable(isNearby, 'Магазин / филиал'));
  return contacts.rows.filter((r) => text(r, 'Компания / филиал')).map((r) => supplierOfRow(r, services.get(text(r, 'ID')), nearby.get(text(r, 'ID'))));
}

/* ---------------- Writing ---------------- */

/** The number a WhatsApp link opens a chat with ("wa.me/971…", "wa.me/+971…"); a business link (wa.me/message/…, wa.me/qr/…) has none. */
const waNumber = (url: string | undefined) => /wa\.me\/\+?(\d{6,15})(?:[/?#]|$)/i.exec(url ?? '')?.[1] ?? '';

/**
 * The supplier's own WhatsApp link from the workbook, when its chat is not the main phone's: a number of its own or
 * a business link. Without one the chat is the phone's.
 */
export function supplierChatLink(s: Pick<Supplier, 'book'>): string | undefined {
  const c = s.book?.contact;
  const link = c?.['WhatsApp']?.link;
  if (!link) return undefined;
  const n = waNumber(link);
  return !n || n !== digits(c?.['Основной телефон']?.v) ? link : undefined;
}

const samePhone = (a: string, b: string) => digits(a) === digits(b);

/**
 * A cell of the app's own field: as the workbook wrote it (its exact writing kept) while the app's field is the same
 * as `before` — the workbook's value of that field — else the app's value. On "Контакты" `before` is the cell's own
 * text; the contractors' and nearby sheets write a supplier their own way, and follow the app only once it changed.
 */
const follow = (was: BookCell | undefined, before: string, now: string | undefined, same = (a: string, b: string) => a === b) =>
  same(before.trim(), (now ?? '').trim()) ? (was ?? cell('')) : cell(now);

/**
 * The WhatsApp cell of a row: as it came while the phone is the one the workbook had (`before`) — a number of its
 * own, a business link, the chat of that phone; the chat of the new phone when the phone it was the chat of
 * changed; none where there was none. A supplier the app made gets the chat of a UAE mobile (a landline has none).
 */
function waCell(s: Supplier, was: Row, phoneKey: string, label: string, before: string): BookCell {
  if (!s.book) return s.phone && /^\+9715\d{8}$/.test(s.phone) ? cell(label, `https://wa.me/${digits(s.phone)}`) : cell('');
  const c = was['WhatsApp'];
  if (!c?.link || samePhone(before, s.phone ?? '')) return c ?? cell('');
  const n = waNumber(c.link);
  if (!n || n !== digits(was[phoneKey]?.v)) return c;
  return s.phone ? cell(c.v || label, `https://wa.me/${digits(s.phone)}`) : cell('');
}

/** The map cell: as it came while the app has the link the workbook had (`before`), else the app's link under the row's words. */
const mapCell = (was: Row, before: string, url: string | undefined, label: string) =>
  before === (url ?? '') ? (was['Карта'] ?? cell('')) : url ? cell(text(was, 'Карта') || label, url) : cell('');
const ORIGIN: [string, RegExp][] = [
  ['Японские', /^(toyota|lexus|nissan|infiniti|honda|acura|mazda|mitsubishi|subaru|suzuki|isuzu|daihatsu|hino)$/i],
  ['Корейские', /^(hyundai|kia|genesis|ssangyong|daewoo)$/i],
  ['Американские', /^(ford|chevrolet|gmc|cadillac|lincoln|jeep|dodge|chrysler|ram|hummer|tesla|buick)$/i],
  ['Немецкие', /^(bmw|mercedes-benz|mercedes|volkswagen|audi|porsche|opel|mini)$/i],
  ['Европейские', /^(land rover|range rover|jaguar|volvo|peugeot|renault|citroen|fiat|alfa romeo|ferrari|lamborghini|maserati|bentley|rolls-royce|aston martin|skoda|seat)$/i],
  ['Китайские', /^(mg|changan|geely|chery|haval|gac|jac|byd|jetour|great wall|tank|exeed|hongqi|omoda|jaecoo|zeekr|lynk & co|dongfeng|baic|baw|maxus|bestune|kaiyi|avatr|riddara|rox|icar|poer)$/i],
  ['Индийские', /^(tata|ashok leyland|mahindra)$/i],
];
const groupsOf = (makes: string[] | undefined) => [...new Set((makes ?? []).map((m) => ORIGIN.find(([, re]) => re.test(m))?.[0]).filter((g): g is string => !!g))].join(' · ');
const sameList = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join('|').toLowerCase() === (b ?? []).join('|').toLowerCase();
const CONDITION_TEXT: Record<NonNullable<Supplier['condition']>, string> = { new: 'Новые', used: 'Б/у', both: 'Б/у • Новые' };
const cell = (v: string | undefined, link?: string): BookCell => (link ? { v: v ?? '', link } : { v: v ?? '' });

/** A supplier's row on "Контакты": what the app holds as it is now, every other column as it came. */
export function contactRow(s: Supplier, id: string): Row {
  const was = s.book?.contact ?? {};
  const sameMakes = sameList(makesOf(text(was, 'Марки авто')), s.makes);
  const row: Row = { ...was, ID: cell(id) };
  row['Компания / филиал'] = follow(was['Компания / филиал'], text(was, 'Компания / филиал'), s.name);
  row['Марки авто'] = sameMakes && was['Марки авто'] ? was['Марки авто'] : cell(s.makes?.join(', '));
  row['Группа марок'] = sameMakes && was['Группа марок'] ? was['Группа марок'] : cell(groupsOf(s.makes));
  row['Специализация'] = follow(was['Специализация'], text(was, 'Специализация'), s.parts);
  row['Основной телефон'] = follow(was['Основной телефон'], text(was, 'Основной телефон'), s.phone, samePhone);
  row['WhatsApp'] = waCell(s, was, 'Основной телефон', 'Открыть чат', text(was, 'Основной телефон'));
  row['Район / адрес'] = follow(was['Район / адрес'], text(was, 'Район / адрес'), s.address);
  row['Карта'] = mapCell(was, was['Карта']?.link ?? '', s.locationUrl, 'Открыть карту');
  row['Тип деталей'] = conditionOf(text(was, 'Тип деталей')) === s.condition ? (was['Тип деталей'] ?? cell('')) : cell(s.condition ? CONDITION_TEXT[s.condition] : '');
  if (!text(was, 'Категории')) row['Категории'] = cell(s.service ? 'Услуги' : 'Автозапчасти');
  row['Примечания'] = follow(was['Примечания'], text(was, 'Примечания'), s.notes);
  return row;
}

/** A contractor's row on "Услуги для гаража": its own writing, the app's name, phone and map once changed there. */
function serviceRow(s: Supplier, id: string): Row {
  const was = s.book?.service ?? {};
  const c = s.book?.contact ?? {};
  return {
    ...was,
    ID: cell(id),
    'Мастерская / служба': follow(was['Мастерская / служба'], text(c, 'Компания / филиал'), s.name),
    'Что делают': was['Что делают'] ?? cell(s.parts),
    'Адрес / зона выезда': was['Адрес / зона выезда'] ?? cell(s.address),
    'Телефон': follow(was['Телефон'], text(c, 'Основной телефон'), s.phone, samePhone),
    WhatsApp: waCell(s, was, 'Телефон', 'WhatsApp', text(c, 'Основной телефон')),
    'Карта': mapCell(was, c['Карта']?.link ?? '', s.locationUrl, 'Карта'),
  };
}

/** A supplier's row on the nearby sheet: the same — its own writing until the app changed a field. */
function nearbyRow(s: Supplier, id: string): Row {
  const was = s.book?.nearby ?? {};
  const c = s.book?.contact ?? {};
  return {
    ...was,
    ID: cell(id),
    'Магазин / филиал': follow(was['Магазин / филиал'], text(c, 'Компания / филиал'), s.name),
    'Телефон': follow(was['Телефон'], text(c, 'Основной телефон'), s.phone, samePhone),
    WhatsApp: waCell(s, was, 'Телефон', 'Открыть WhatsApp', text(c, 'Основной телефон')),
    'Марки авто': sameList(makesOf(text(c, 'Марки авто')), s.makes) ? (was['Марки авто'] ?? cell('')) : cell(s.makes?.join(', ')),
    'Карта': mapCell(was, c['Карта']?.link ?? '', s.locationUrl, 'Открыть карту'),
  };
}

const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : Infinity;
};
const idNum = (id: string) => +(/\d+/.exec(id)?.[0] ?? Infinity);

/** One row of a sheet as written: cells by column (text, style, link) and the row's height. */
interface OutRow {
  ht?: number;
  cells: { v: string; s?: number; link?: string }[];
}

/** How a sheet's cells look: the header's and the body's style per column, a linked cell's, the rows' heights. */
interface Look {
  head: (i: number) => number | undefined;
  body: (i: number) => number | undefined;
  link: (i: number) => number | undefined;
  headHt?: number;
  bodyHt?: number;
}

/** The look of the garage's own sheets (the indexes of BOOK_STYLES). */
const LOOKS: Record<'contacts' | 'makes' | 'nearby' | 'services', Look> = {
  contacts: { head: () => 9, body: (i) => (i === 6 ? 59 : 4), link: (i) => ([7, 18].includes(i) ? 11 : 60), headHt: 29.25, bodyHt: 43 },
  makes: { head: () => 9, body: (i) => (i === 8 ? 59 : 4), link: () => 11, headHt: 29.25, bodyHt: 33 },
  nearby: { head: () => undefined, body: (i) => (i === 0 ? 63 : i === 4 ? 64 : 57), link: () => 60, bodyHt: 43 },
  services: { head: () => undefined, body: (i) => (i === 5 ? 68 : i === 6 ? 69 : 67), link: () => 60, bodyHt: 39 },
};

/** A sheet's look read from the sheet itself (the most usual style per column) — a workbook brought in keeps its own. */
function lookOf(xml: string, headerAt: number, fallback: Look): Look {
  const count = (m: Map<number, Map<number, number>>, i: number, s: number) => {
    const c = m.get(i) ?? new Map<number, number>();
    c.set(s, (c.get(s) ?? 0) + 1);
    m.set(i, c);
  };
  const links = new Set([...xml.matchAll(/<hyperlink\b[^>]*>/g)].map((m) => attr(m[0], 'ref')));
  const head = new Map<number, Map<number, number>>();
  const body = new Map<number, Map<number, number>>();
  const link = new Map<number, Map<number, number>>();
  const hts = new Map<number, number>();
  let headHt: number | undefined;
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = +attr(rm[1], 'r');
    if (r < headerAt) continue;
    const ht = parseFloat(attr(rm[1], 'ht'));
    if (r === headerAt) headHt = Number.isFinite(ht) ? ht : undefined;
    else if (Number.isFinite(ht)) hts.set(ht, (hts.get(ht) ?? 0) + 1);
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>)/g)) {
      const ref = attr(cm[1], 'r');
      const s = attr(cm[1], 's');
      if (!s) continue;
      const i = colIndex(ref.replace(/\d+$/, ''));
      count(r === headerAt ? head : links.has(ref) ? link : body, i, +s);
    }
  }
  const top = (m: Map<number, Map<number, number>>, i: number) => [...(m.get(i) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1])[0]?.[0];
  const bodyHt = [...hts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    head: (i) => top(head, i) ?? fallback.head(i),
    body: (i) => top(body, i) ?? fallback.body(i),
    link: (i) => top(link, i) ?? fallback.link(i),
    headHt: headHt ?? fallback.headHt,
    bodyHt: bodyHt ?? fallback.bodyHt,
  };
}

/** Rows of a table: the header, then a row per record (by the header's column names). */
function tableRows(header: string[], records: Row[], look: Look): OutRow[] {
  const out: OutRow[] = [{ ht: look.headHt, cells: header.map((h, i) => ({ v: h, s: look.head(i) })) }];
  for (const rec of records) {
    out.push({
      ht: look.bodyHt,
      cells: header.map((h, i) => {
        const c = rec[h];
        return c?.link ? { v: c.v, s: look.link(i), link: c.link } : { v: c?.v ?? '', s: look.body(i) };
      }),
    });
  }
  return out;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
function cellXml(ref: string, v: string, s?: number): string {
  const st = s !== undefined ? ` s="${s}"` : '';
  if (v === '') return st ? `<c r="${ref}"${st}/>` : '';
  if (NUMBER.test(v) && v.length < 15 && !/^-?0\d/.test(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A worksheet from its frame (everything before and after the data) and its rows from `first` on: the data, the
 * dimension and the links anew; the relationships it had that are not links (its table) kept.
 */
function writeSheet(frame: { head: string; tail: string }, first: number, rows: OutRow[], oldRels: Rel[], width: number): { xml: string; rels: string } {
  const rels = oldRels.filter((r) => r.type !== HYPERLINK).map((r) => r.tag);
  const links: string[] = [];
  const data = rows
    .map((row, k) => {
      const r = first + k;
      const cells = row.cells
        .map((c, i) => {
          const ref = `${colName(i)}${r}`;
          if (c.link) {
            const id = `rIdL${links.length + 1}`;
            links.push(`<hyperlink ref="${ref}" r:id="${id}"/>`);
            rels.push(`<Relationship Id="${id}" Type="${HYPERLINK}" Target="${esc(c.link)}" TargetMode="External"/>`);
          }
          return cellXml(ref, c.v, c.s);
        })
        .join('');
      return `<row r="${r}"${row.ht ? ` ht="${row.ht}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const last = first + rows.length - 1;
  const head = frame.head.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${colName(Math.max(0, width - 1))}${Math.max(1, last)}"/>`);
  // Links go before the page settings (the order a worksheet's parts must keep).
  const linkXml = links.length ? `<hyperlinks xmlns:r="${REL_NS}">${links.join('')}</hyperlinks>` : '';
  const tail = frame.tail.replace(/<hyperlinks[\s\S]*?<\/hyperlinks>/, '');
  const at = tail.search(/<printOptions|<pageMargins|<pageSetup|<tableParts|<\/worksheet>/);
  const xml = `${head}<sheetData>${data}</sheetData>${tail.slice(0, at)}${linkXml}${tail.slice(at)}`;
  return { xml, rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` };
}

/** A table part's range set to its rows (its header row `at`, `rows` records under it). */
const fitTable = (xml: string, at: number, width: number, rows: number) => {
  const ref = `A${at}:${colName(width - 1)}${at + Math.max(1, rows)}`;
  return xml.replace(/(<table\b[^>]*?\sref=")[^"]*"/, `$1${ref}"`).replace(/(<autoFilter\b[^>]*?\sref=")[^"]*"/, `$1${ref}"`);
};

/**
 * The suppliers in the book's order, each with its ID: a supplier the app made gets the next one after every ID
 * taken (`taken` — the removed ones too), in the order they were made, so it keeps its number from one export to
 * the next; brought back in, it is found by its phone or name and takes the ID for good.
 */
export function withIds(suppliers: Supplier[], taken: Supplier[] = suppliers): { s: Supplier; id: string }[] {
  let next = Math.max(0, ...taken.map((s) => (s.book?.id ? idNum(s.book.id) : 0)).filter(Number.isFinite)) + 1;
  return [...suppliers]
    .sort((a, b) => idNum(a.book?.id ?? '') - idNum(b.book?.id ?? '') || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
    .map((s) => ({ s, id: s.book?.id || `CT-${String(next++).padStart(4, '0')}` }));
}

interface Parts {
  contacts: Row[];
  makes: Row[];
  nearby: Row[];
  services: Row[];
  counts: { all: number; parts: number; other: number; services: number };
}

function partsOf(list: { s: Supplier; id: string }[]): Parts {
  const contacts = list.map(({ s, id }) => contactRow(s, id));
  const zone = (r: Row) => num(text(r, 'Геозона'));
  const makes: Row[] = [];
  list.forEach(({ s, id }, k) => {
    const c = contacts[k];
    for (const make of s.makes ?? []) {
      makes.push({
        'Марка': cell(make),
        ID: cell(id),
        'Компания': cell(s.name),
        'Категории': c['Категории'] ?? cell(''),
        'Модель / годы': c['Модель / годы'] ?? cell(''),
        'Эмират': c['Эмират'] ?? cell(''),
        'Район': cell(s.address),
        'Геозона': cell(/^\d+/.exec(text(c, 'Геозона'))?.[0] ?? ''),
        'Телефон': cell(s.phone),
        WhatsApp: c.WhatsApp ?? cell(''),
      });
    }
  });
  makes.sort((a, b) => text(a, 'Марка').localeCompare(text(b, 'Марка')) || zone(a) - zone(b) || text(a, 'Компания').localeCompare(text(b, 'Компания')));
  const nearby = list.filter(({ s }) => s.book?.nearby).map(({ s, id }) => nearbyRow(s, id)).sort((a, b) => num(text(a, 'Км')) - num(text(b, 'Км')));
  const services = list
    .filter(({ s }) => s.book?.service || (s.service && !s.book))
    .map(({ s, id }) => serviceRow(s, id))
    .sort((a, b) => text(a, 'Услуга').localeCompare(text(b, 'Услуга')) || num(text(a, 'Км')) - num(text(b, 'Км')));
  const parts = contacts.filter((c) => /запчаст/i.test(text(c, 'Категории'))).length;
  return { contacts, makes, nearby, services, counts: { all: contacts.length, parts, other: contacts.length - parts, services: services.length } };
}

/** The workbook brought in, its supplier sheets written anew: everything else as it was. */
async function patchBook(base: Uint8Array, p: Parts): Promise<ZipFile[] | null> {
  const book = await openBook(base);
  const out = new Map(book.files);
  const enc = new TextEncoder();
  const put = (part: string, text: string) => out.set(part, enc.encode(text));
  const frameOf = (xml: string) => ({ head: xml.slice(0, xml.indexOf('<sheetData')), tail: xml.slice(xml.indexOf('</sheetData>') + '</sheetData>'.length) });
  const redo = (pick: (name: string) => boolean, must: string, rows: Row[], fallback: Look, cols: string[], keepOrder = true) => {
    const sheet = book.sheets.find((s) => pick(s.name));
    const xml = sheet && book.text(sheet.path);
    if (!sheet || !xml || !xml.includes('<sheetData')) return false;
    const t = tableOf(cellsOf(book, sheet.path), must);
    if (!t) return false;
    // The suppliers in the order the sheet had them (its own order: by area, by distance…); new ones after them.
    const at = new Map(t.rows.map((r, i) => [text(r, 'ID'), i]));
    const records = keepOrder ? [...rows].sort((a, b) => (at.get(text(a, 'ID')) ?? Infinity) - (at.get(text(b, 'ID')) ?? Infinity)) : rows;
    const header = t.header.length ? Array.from(t.header, (h) => h ?? '') : cols;
    const look = lookOf(xml, t.at, fallback);
    // The rows above the table (a title, a line under it) stay as they were.
    const before = [...xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)].map((m) => m[0]).filter((r) => +attr(r.slice(0, r.indexOf('>')), 'r') < t.at);
    const rels = relsOf(book.text(relsPath(sheet.path)));
    const { xml: sheetXml, rels: relsXml } = writeSheet(frameOf(xml), t.at, tableRows(header, records, look), rels, header.length);
    put(sheet.path, sheetXml.replace('<sheetData>', `<sheetData>${before.join('')}`));
    put(relsPath(sheet.path), relsXml);
    for (const r of rels.filter((x) => /\/table$/.test(x.type))) {
      const part = resolve(sheet.path, r.target);
      const tx = book.text(part);
      if (tx) put(part, fitTable(tx, t.at, header.length, records.length));
    }
    return true;
  };
  if (!redo((n) => n === SHEET.contacts, 'Компания / филиал', p.contacts, LOOKS.contacts, CONTACT_COLS)) return null;
  redo((n) => n === SHEET.makes, 'Компания', p.makes, LOOKS.makes, MAKE_COLS, false);
  redo(isNearby, 'Магазин / филиал', p.nearby, LOOKS.nearby, NEARBY_COLS);
  redo((n) => n === SHEET.services, 'Мастерская / служба', p.services, LOOKS.services, SERVICE_COLS);
  // The guide's counts: records, parts suppliers, other categories (the photo count stays — the app has no photos log).
  const guide = book.sheets.find((s) => s.name === SHEET.guide);
  const gx = guide && book.text(guide.path);
  if (guide && gx && /Записей/.test(gx)) {
    const set = (ref: string, n: number) => (x: string) => x.replace(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`), (_m, a: string) => `<c r="${ref}"${a.replace(/\st="[^"]*"/, '')}><v>${n}</v></c>`);
    put(guide.path, [set('A5', p.counts.all), set('B5', p.counts.parts), set('C5', p.counts.other)].reduce((x, f) => f(x), gx));
  }
  return [...out].map(([name, data]) => ({ name, data }));
}

/** The workbook built from the garage's look (no workbook was brought in). */
function freshBook(p: Parts, today: string): ZipFile[] {
  const enc = new TextEncoder();
  const f = (name: string, text: string) => ({ name, data: enc.encode(text) });
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const tables: { name: string; cols: string[]; at: number; rows: number; filter: boolean }[] = [];
  const sheets: { name: string; xml: string; rels: string }[] = [];
  const merges = (refs: string[]) => (refs.length ? `<mergeCells count="${refs.length}">${refs.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '');
  // The guide: the title, the counts, how to look things up.
  const lines = [
    'Контакты. Фильтруй по категории, марке и специализации. Для одной марки — лист «Индекс марок».',
    '«Услуги для гаража» — мастерские и выезд по работам.',
    'Обратно в MyGarage: Запчасти → Поставщики → Excel → Загрузить.',
  ];
  const guideRows: OutRow[] = [
    { ht: 39, cells: [{ v: 'Поставщики автозапчастей и услуг • ОАЭ', s: 17 }] },
    { ht: 27.75, cells: [{ v: `MyGarage • ${today.split('-').reverse().join('/')}`, s: 23 }] },
    { cells: [] },
    { ht: 22.5, cells: ['Записей', 'Автозапчасти', 'Другие категории', 'Услуги для гаража'].map((v) => ({ v, s: 28 })) },
    { ht: 35.25, cells: [p.counts.all, p.counts.parts, p.counts.other, p.counts.services].map((n) => ({ v: String(n), s: 29 })) },
    { cells: [] },
    { ht: 27, cells: [{ v: 'КАК ИСКАТЬ', s: 32 }] },
    ...lines.map((v, i) => ({ ht: 30, cells: [{ v, s: i % 2 ? 43 : 38 }] })),
  ];
  const guide = writeSheet({ head: BOOK_FRAMES.guide.head, tail: merges(['A1:D1', 'A2:D2', 'A7:D7', 'A8:D8', 'A9:D9', 'A10:D10']) + BOOK_FRAMES.guide.tail }, 1, guideRows, [], 4);
  sheets.push({ name: SHEET.guide, ...guide });
  const table = (name: string, frame: { head: string; tail: string }, title: OutRow[], cols: string[], records: Row[], look: Look, filter: boolean) => {
    const at = title.length + 1;
    const rows = tableRows(cols, records.length ? records : [{}], look);
    const id = tables.length + 1;
    tables.push({ name, cols, at, rows: Math.max(1, records.length), filter });
    const tail = frame.tail.replace('</worksheet>', `<tableParts count="1"><tablePart xmlns:r="${REL_NS}" r:id="rIdT"/></tableParts></worksheet>`);
    const tableRel = `<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="/xl/tables/table${id}.xml"/>`;
    return writeSheet({ head: frame.head, tail }, 1, [...title, ...rows], [{ id: 'rIdT', type: 'table', target: `/xl/tables/table${id}.xml`, tag: tableRel }], cols.length);
  };
  sheets.push({ name: SHEET.contacts, ...table('UaeContacts', BOOK_FRAMES.contacts, [], CONTACT_COLS, p.contacts, LOOKS.contacts, true) });
  sheets.push({ name: SHEET.makes, ...table('UaeMakes', BOOK_FRAMES.makes, [], MAKE_COLS, p.makes, LOOKS.makes, true) });
  const serviceTitle: OutRow[] = [{ ht: 24, cells: [{ v: 'Услуги для гаража', s: 65 }] }, { ht: 24, cells: [{ v: 'Мастерские и выезд по работам', s: 66 }] }, { cells: [] }];
  sheets.push({ name: SHEET.services, ...table('UaeGarageServices', BOOK_FRAMES.services, serviceTitle, SERVICE_COLS, p.services, LOOKS.services, false) });
  const files: ZipFile[] = [];
  sheets.forEach((s, i) => {
    files.push(f(`xl/worksheets/sheet${i + 1}.xml`, s.xml.startsWith('<?xml') ? s.xml : xmlHead + s.xml));
    files.push(f(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, s.rels));
  });
  tables.forEach((t, i) => {
    const ref = `A${t.at}:${colName(t.cols.length - 1)}${t.at + t.rows}`;
    files.push(
      f(
        `xl/tables/table${i + 1}.xml`,
        `${xmlHead}<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${i + 1}" name="${t.name}" displayName="${t.name}" ref="${ref}" headerRowCount="1" totalsRowCount="0" totalsRowShown="0">` +
          (t.filter ? `<autoFilter ref="${ref}"/>` : '') +
          `<tableColumns count="${t.cols.length}">${t.cols.map((c, k) => `<tableColumn id="${k + 1}" name="${esc(c)}"/>`).join('')}</tableColumns>` +
          '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>',
      ),
    );
  });
  const ct =
    `${xmlHead}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    tables.map((_, i) => `<Override PartName="/xl/tables/table${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join('') +
    '</Types>';
  const wb =
    `${xmlHead}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}"><workbookPr/><sheets>` +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" state="visible" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const wbRels =
    `${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdTh" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
    '</Relationships>';
  return [
    f('[Content_Types].xml', ct),
    f('_rels/.rels', `${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    f('xl/workbook.xml', wb),
    f('xl/_rels/workbook.xml.rels', wbRels),
    f('xl/styles.xml', BOOK_STYLES),
    f('xl/theme/theme1.xml', BOOK_THEME),
    ...files,
  ];
}

/**
 * The supplier base workbook of these suppliers (each with its ID). With the workbook last brought in (`base`), its
 * other sheets and its look are kept; without one it is built from the garage's look.
 */
export async function buildSupplierBook(list: { s: Supplier; id: string }[], base: Uint8Array | null, today: string): Promise<Uint8Array> {
  const p = partsOf(list);
  const files = (base && (await patchBook(base, p).catch(() => null))) || freshBook(p, today);
  return zipStore(files);
}
