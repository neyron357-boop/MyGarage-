import { CAR_CATALOG, canonicalMake } from './carCatalog';
import { makesInText } from './chatStudy';
import { dubaiDate } from './dates';
import { lineName } from './items';
import { printedDate, receiptExpense, type ReceiptRead } from './receipt';
import { brandWord } from './supplierReply';
import { sellerKey } from './suppliers';
import type { Expense, PaperItem, SupplierPaper } from './types';

/*
 * The garage's paper invoices from its suppliers, read in bulk (v1.05, the owner: «до появления приложения накопилось
 * огромное количество инвойсов от поставщиков… в этих инвойсах прописаны все данные, каждая позиция, цены… создать
 * мультисканер… ИИ должен анализировать, узнать поставщика, присваивать ему работы… рейтинг… кто что часто продаёт…
 * сохранял все цены, прайс-листы, чтобы в новом заказе… приложение показывало: вот этот поставщик ранее продавал тебе вот
 * это… даже если поставщик не существует — создать»). A paper is knowledge, not money: it writes no expense (the money book
 * of those days is not the app's), it teaches the supplier's history, its rating, who sells what for which car, and its
 * prices (the price book). Pure: the server's reading in (server/src/ai.mjs `receipt`), the paper's fields out; which
 * paper is the same as another, which expense it already is, what a supplier's papers say of it.
 */

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}
const yearsBack = (today: string, n: number) => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;

/**
 * An old paper's day: as printed (day first, as UAE papers write it), else the server's. Old papers are old — years back
 * is right (the receipt scanner's «within a year» is not). A day after today is a misread: the same day a year before, or
 * day and month swapped — whichever has passed; not sure then. Older than six years, or none — none, to be looked at.
 */
export function paperDate(read: Pick<ReceiptRead, 'dateText' | 'date' | 'dateSure'>, today = dubaiDate()): { date?: string; sure: boolean } {
  const printed = read.dateText ? printedDate(String(read.dateText)) : undefined;
  const s = String(read.date ?? '');
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? ymd(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))) : undefined;
  const date = printed ?? iso;
  if (!date) return { sure: false };
  const sure = read.dateSure !== false && (!printed || !iso || printed === iso);
  const oldest = yearsBack(today, 6);
  if (date <= today && date >= oldest) return { date, sure };
  if (date > today) {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    const again = [ymd(y - 1, m, d), d <= 12 ? ymd(y, d, m) : undefined].filter((x): x is string => !!x && x <= today && x >= oldest).sort().pop();
    return { date: again, sure: false };
  }
  return { sure: false };
}

/** The car some words name: the make (one only), and its model of the catalogue when the words name one. */
export function carOfText(text?: string): { make?: string; model?: string } {
  if (!text?.trim()) return {};
  const makes = makesInText(text);
  if (makes.length !== 1) return {};
  const make = canonicalMake(makes[0]);
  const words = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const flat = words.replace(/\s+/g, '');
  // The longest name first («LAND CRUISER PRADO» before «LAND CRUISER»); a short one («XA», «RX») only as a word of its own.
  const model = [...(CAR_CATALOG[make] ?? [])]
    .sort((a, b) => b.length - a.length)
    .find((m) => {
      const k = m.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k) return false;
      return k.replace(/\s/g, '').length >= 4 ? flat.includes(k.replace(/\s/g, '')) : words.includes(` ${k} `);
    });
  return { make, ...(model ? { model } : {}) };
}

const OEM_WORDS = /\b(genuine|original|orginal|oem|org)\b/i;
const COPY_WORDS = /\b(duplicate|dupl?|copy|aftermarket|after\s*market|taiwan|china|commercial)\b/i;
const USED_WORDS = /\b(used|second\s*hand|scrap)\b/i;

/** What kind a line says it is: the car's own make or «genuine» — original; another maker, «copy» — aftermarket; «used». */
export function lineKind(name: string, make?: string): { kind: 'oem' | 'aftermarket' | 'used'; said: boolean; brand?: string } {
  if (USED_WORDS.test(name)) return { kind: 'used', said: true };
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const brand = words.find((w) => brandWord(w) && w.length >= 3);
  if (OEM_WORDS.test(name)) return { kind: 'oem', said: true, ...(brand ? { brand: brand.toUpperCase() } : {}) };
  if (COPY_WORDS.test(name)) return { kind: 'aftermarket', said: true, ...(brand ? { brand: brand.toUpperCase() } : {}) };
  if (brand) return { kind: make && canonicalMake(brand).toLowerCase() === canonicalMake(make).toLowerCase() ? 'oem' : 'aftermarket', said: true, brand: brand.toUpperCase() };
  return { kind: 'aftermarket', said: false };
}

/** The paper's own fields out of the server's reading: who sold, when, its number, its sums, each line as the garage names it. */
export interface PaperFields {
  ok: boolean;
  /** Not a supplier's invoice at all (a photo of something else). */
  notPaper: boolean;
  /** A parts shop's, a contractor's, or of another kind (fuel, food…). */
  kind: 'parts' | 'service' | 'other';
  vendor?: string;
  vendorPhone?: string;
  vendorTrn?: string;
  vendorEmail?: string;
  vendorAddress?: string;
  invoiceNo?: string;
  date?: string;
  dateSure: boolean;
  totalFils: number;
  vatFils: number;
  method?: Expense['method'];
  car?: string;
  make?: string;
  model?: string;
  lines: PaperItem[];
  /** The lines add up to the paper's sum (with its VAT or without). */
  adds: boolean;
}

export function paperFields(read: ReceiptRead, today = dubaiDate()): PaperFields {
  const x = receiptExpense(read, today);
  const { date, sure } = paperDate(read, today);
  const car = String(read.carText ?? '').trim().slice(0, 80) || undefined;
  const paperCar = carOfText(car);
  const lines: PaperItem[] = x.items.map((i) => {
    const own = carOfText(i.car);
    const make = own.make ?? paperCar.make;
    const model = own.make && own.make !== paperCar.make ? own.model : own.model ?? paperCar.model;
    const k = lineKind(i.name, make);
    return {
      name: i.name,
      ...(i.part ? { part: lineName(i.part) } : {}),
      ...(i.partNumber ? { partNumber: i.partNumber } : {}),
      qty: i.qty,
      ...(i.unitNetFils !== undefined ? { unitFils: i.unitNetFils } : {}),
      ...(i.lineNetFils !== undefined ? { totalFils: i.lineNetFils } : {}),
      ...(make ? { make } : {}),
      ...(model ? { model } : {}),
      kind: k.kind,
      ...(k.said ? {} : { unsure: true as const }),
      ...(k.brand ? { brand: k.brand } : {}),
    };
  });
  const net = x.amountFils - x.vatFils;
  const sum = lines.reduce((s, l) => s + (l.totalFils ?? 0), 0);
  const near = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(200, Math.round(b * 0.02));
  return {
    ok: x.amountFils > 0 && read.isReceipt !== false,
    notPaper: read.isReceipt === false,
    kind: x.kind === 'parts' || x.kind === 'service' ? x.kind : 'other',
    vendor: x.vendor,
    vendorPhone: x.vendorPhone,
    vendorTrn: x.vendorTrn?.replace(/\D/g, '') || undefined,
    vendorEmail: x.vendorEmail,
    vendorAddress: x.vendorAddress,
    invoiceNo: read.invoiceNo ? String(read.invoiceNo).trim().slice(0, 24) || undefined : undefined,
    date,
    dateSure: sure,
    totalFils: x.amountFils,
    vatFils: x.vatFils,
    method: x.method,
    car,
    ...paperCar,
    lines,
    adds: !lines.length || near(sum, net) || near(sum, x.amountFils),
  };
}

/** What in a paper needs a look: the seller not known, no day or not sure of it, its lines not adding up, no lines. */
export function paperDoubts(p: Pick<SupplierPaper, 'supplierId' | 'date' | 'dateSure' | 'lines' | 'adds'>): ('seller' | 'date' | 'sum' | 'lines')[] {
  const out: ('seller' | 'date' | 'sum' | 'lines')[] = [];
  if (!p.supplierId) out.push('seller');
  if (!p.date || !p.dateSure) out.push('date');
  if (!p.lines?.length) out.push('lines');
  else if (p.adds === false) out.push('sum');
  return out;
}

const digits = (s?: string) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/**
 * The same paper scanned before (photographed twice, or a copy of it): the same seller with the same number, or the same
 * seller, day and sum. `others` — the papers read before it.
 */
export function twinOf<T extends Pick<SupplierPaper, 'id' | 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils' | 'state'>>(p: Pick<SupplierPaper, 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils'> & { id?: string }, others: T[]): T | undefined {
  const seller = (x: Pick<SupplierPaper, 'supplierId' | 'vendor'>) => x.supplierId ?? (x.vendor ? `v:${sellerKey(x.vendor)}` : '');
  const me = seller(p);
  if (!me) return undefined;
  const no = digits(p.invoiceNo);
  return others.find((o) => {
    if (o.id === p.id || o.state === 'twin' || o.state === 'failed' || seller(o) !== me) return false;
    const on = digits(o.invoiceNo);
    if (no.length >= 3 && on.length >= 3) return no === on && (!p.date || !o.date || Math.abs(Date.parse(p.date) - Date.parse(o.date)) < 400 * DAY);
    return !!p.date && p.date === o.date && !!p.totalFils && p.totalFils === o.totalFils;
  });
}

/**
 * The expense the paper already is (scanned by «Расход», or typed): the same seller (its supplier, else its name), the same
 * sum within a dirham, three days apart at most — or its number in the expense's note.
 */
export function expenseOf(p: Pick<SupplierPaper, 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils'>, expenses: Pick<Expense, 'id' | 'supplierId' | 'vendor' | 'note' | 'date' | 'amountFils'>[]): string | undefined {
  if (!p.date || !p.totalFils) return undefined;
  const key = p.vendor ? sellerKey(p.vendor) : '';
  const no = digits(p.invoiceNo);
  const same = (e: (typeof expenses)[number]) => (p.supplierId && e.supplierId === p.supplierId) || (!!key && key.length >= 3 && sellerKey(e.vendor ?? '') === key);
  const hit = expenses.find((e) => {
    if (!same(e)) return false;
    const days = Math.abs(Date.parse(e.date) - Date.parse(p.date!)) / DAY;
    if (no.length >= 3 && digits(e.note?.match(/#\s*([\w-]+)/)?.[1]).includes(no)) return days <= 40;
    return days <= 3 && Math.abs(e.amountFils - p.totalFils!) <= 100;
  });
  return hit?.id;
}

/** What a supplier's papers say of it (its card): how many, the money, since when, what it sold most, for which makes. */
export interface PaperStats {
  papers: number;
  totalFils: number;
  firstAt?: string;
  lastAt?: string;
  /** The parts bought most, the most first: how many times, the last price (one piece), its car. */
  parts: { part: string; times: number; lastFils?: number; make?: string }[];
  makes: { make: string; n: number }[];
}

/** A line's part as the garage names it: the server's generic name, else the line's own. */
export const partOfLine = (l: Pick<PaperItem, 'part' | 'name'>) => lineName((l.part || l.name || '').trim());

export function paperStats(papers: Pick<SupplierPaper, 'state' | 'date' | 'totalFils' | 'lines'>[]): PaperStats {
  const counted = papers.filter((p) => p.state === 'done' || p.state === 'look');
  const parts = new Map<string, { part: string; times: number; lastFils?: number; lastAt: string; make?: string }>();
  const makes = new Map<string, number>();
  let total = 0;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  for (const p of counted) {
    total += p.totalFils ?? 0;
    if (p.date && (!firstAt || p.date < firstAt)) firstAt = p.date;
    if (p.date && (!lastAt || p.date > lastAt)) lastAt = p.date;
    const seen = new Set<string>();
    for (const l of p.lines ?? []) {
      const part = partOfLine(l);
      if (!part) continue;
      const at = p.date ?? '';
      const was = parts.get(part) ?? { part, times: 0, lastAt: '' };
      was.times++;
      if (at >= was.lastAt) Object.assign(was, { lastAt: at, lastFils: l.unitFils ?? was.lastFils, make: l.make ?? was.make });
      parts.set(part, was);
      if (l.make && !seen.has(l.make)) {
        seen.add(l.make);
        makes.set(l.make, (makes.get(l.make) ?? 0) + 1);
      }
    }
  }
  return {
    papers: counted.length,
    totalFils: total,
    firstAt,
    lastAt,
    parts: [...parts.values()].sort((a, b) => b.times - a.times || b.lastAt.localeCompare(a.lastAt)).map(({ lastAt: _, ...x }) => x),
    makes: [...makes.entries()].map(([make, n]) => ({ make, n })).sort((a, b) => b.n - a.n || a.make.localeCompare(b.make)),
  };
}
