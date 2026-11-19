import { dubaiDate } from './dates';
import { lineName } from './items';
import { partKey } from './partsVocab';
import { CAR_MAKES, carWordsOf, partName, partSimilarity } from './partMatch';
import type { ExpenseMethod } from './types';

/*
 * A supplier's receipt read off its photo (v0.50, the user: «нажал Расход — открылась камера — отсканировал — создаётся
 * расход, и приложение само понимает, к какому заказу он относится»): what of the reading becomes the expense, and
 * which job the parts on it were bought for. Pure: the reading in, the expense's fields and the job out — no money is
 * invented (no VAT the paper does not show, no total the paper does not add up to), no job without a part of it on
 * the paper.
 */

/** What the server read off the picture (server/src/ai.mjs `receipt`). */
export interface ReceiptItem {
  name: string;
  /** The part alone, in the usual English words (v0.50.2: the server's reading). */
  part?: string;
  /** The car the line names ("CANTER", "NISSAN"). */
  car?: string;
  partNumber?: string;
  qty?: number;
  unitPrice?: number;
  total?: number;
}
export interface ReceiptRead {
  isReceipt?: boolean;
  vendor?: string;
  vendorTrn?: string;
  vendorPhone?: string;
  vendorAddress?: string;
  /** The seller's e-mail, as printed (v0.51: read on the phone — the supplier is known by it). */
  vendorEmail?: string;
  /** What the paper is for: parts, a contractor's work, fuel, food, other (v0.50.1). */
  kind?: string;
  invoiceNo?: string;
  /** The date as printed ("18-Nov-2026") — read here day first, as UAE papers write it. */
  dateText?: string;
  date?: string;
  /** False when a digit of the date was hidden (a stamp, a fold). */
  dateSure?: boolean;
  items?: ReceiptItem[];
  subtotal?: number;
  vat?: number;
  total?: number;
  paymentMethod?: string;
  carText?: string;
  confidence?: number;
}

export type ReceiptKind = 'parts' | 'service' | 'fuel' | 'food' | 'other';

/** The expense as the receipt says it. */
export interface ReceiptExpense {
  /** A receipt with a sum to record. */
  ok: boolean;
  amountFils: number;
  vatFils: number;
  vendor?: string;
  vendorPhone?: string;
  vendorTrn?: string;
  vendorAddress?: string;
  vendorEmail?: string;
  /** Parts and a contractor's work are recorded by themselves; anything else waits for the manager's category. */
  kind: ReceiptKind;
  date: string;
  /** The date is as printed and read whole (false: a digit hidden, or its year put right here) — the manager should look. */
  dateSure: boolean;
  method: ExpenseMethod;
  note: string;
  /** The lines, named as the garage names lines (capitals), each with its net price per piece in fils when the paper gives one. */
  items: { name: string; part?: string; car?: string; qty: number; partNumber?: string; unitNetFils?: number; lineNetFils?: number }[];
  /** The VAT's share of the net (basis points): a line's own VAT is its net × this. */
  vatShareBp: number;
}

const clean = (x: unknown, max: number): string | undefined => String(x ?? '').trim().slice(0, max) || undefined;
/** The paper's kind as the server names it; a reading from before kinds (none) is a parts shop's. */
const receiptKind = (k: unknown): ReceiptKind => {
  const s = String(k ?? '').toLowerCase();
  if (!s || /^parts?$/.test(s)) return 'parts';
  if (/^service/.test(s)) return 'service';
  if (/^fuel/.test(s)) return 'fuel';
  if (/^food/.test(s)) return 'food';
  return 'other';
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}
const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** A month's name as OCR may read it: «Oct», «Qct», «0ct», «N0v» — the month within a letter of it, if only one is. */
function monthOf(word: string): number {
  const w = word.slice(0, 3).replace(/0/g, 'o').replace(/1/g, 'l');
  const exact = MONTHS.indexOf(w);
  if (exact >= 0) return exact + 1;
  if (w.length < 3) return 0;
  const close = MONTHS.map((m, i) => [i, [...m].filter((c, k) => c !== w[k]).length] as const).filter(([, d]) => d === 1);
  return close.length === 1 ? close[0][0] + 1 : 0;
}

/** The date as printed: "18-Nov-2026", "Nov 18, 2026", "2026-11-18", "18/11/26" (day first, as UAE papers write it). */
export function printedDate(text: string): string | undefined {
  const t = text.toLowerCase();
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([a-z0-9]{3,9})[\s\-/.,']*(\d{2,4})/);
  if (m && /[a-z]/.test(m[2]) && monthOf(m[2])) return ymd(Number(m[3]), monthOf(m[2]), Number(m[1]));
  m = t.match(/([a-z][a-z0-9]{2,8})[\s\-/.]*(\d{1,2})(?:st|nd|rd|th)?[\s,\-/.]+(\d{2,4})/);
  if (m && monthOf(m[1])) return ymd(Number(m[3]), monthOf(m[1]), Number(m[2]));
  m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Day first unless it cannot be (a "month" over 12).
    return b > 12 && a <= 12 ? ymd(Number(m[3]), a, b) : ymd(Number(m[3]), b, a);
  }
  return undefined;
}

/**
 * The receipt's day (v0.50.2, the user: «точно брать даты»): the date as printed, read day first; the server's
 * YYYY-MM-DD when nothing printed reads. Parts are bought now: a day ahead of today or more than a year back is a
 * misread — a year under a stamp («19-Nov-202?» read 2024): the same day and month this year or last, or day and month
 * swapped — the latest of them that has passed, within the last 120 days; else today. Any of that, a hidden digit, or the two readings apart — not sure.
 */
export function receiptDate(read: Pick<ReceiptRead, 'dateText' | 'date' | 'dateSure'>, today = dubaiDate()): { date: string; sure: boolean } {
  const printed = read.dateText ? printedDate(String(read.dateText)) : undefined;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(read.date ?? '')) ? ymd(Number(read.date!.slice(0, 4)), Number(read.date!.slice(5, 7)), Number(read.date!.slice(8, 10))) : undefined;
  let date = printed ?? iso;
  if (!date) return { date: today, sure: false };
  let sure = read.dateSure !== false && (!printed || !iso || printed === iso);
  const yearAgo = daysBefore(today, 366);
  // A day put right must be a recent one (parts are scanned within weeks of buying them).
  const lately = daysBefore(today, 120);
  const fits = (d?: string): boolean => !!d && d <= today && d >= yearAgo;
  if (!fits(date)) {
    const y = Number(today.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    const again = [ymd(y, m, d), ymd(y - 1, m, d), d <= 12 ? ymd(Number(date.slice(0, 4)), d, m) : undefined, d <= 12 ? ymd(y, d, m) : undefined]
      .filter((x): x is string => !!x && x <= today && x >= lately)
      .sort()
      .pop();
    date = again ?? today;
    sure = false;
  }
  return { date, sure };
}

const toFils = (x: unknown): number | undefined => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

/**
 * The expense's fields out of the reading. The total paid is the paper's grand total; without one — the subtotal plus
 * the VAT printed, else the lines' sum. VAT only as printed (or the difference between a printed total and a printed
 * subtotal) — never 5 % assumed. The date — the paper's when it is a real past day within a year, else today.
 */
export function receiptExpense(read: ReceiptRead, today = dubaiDate()): ReceiptExpense {
  const raw = (read.items ?? []).filter((i) => i && String(i.name ?? '').trim());
  const lines = raw.map((i) => {
    const qty = Number(i.qty) > 0 ? Number(i.qty) : 1;
    const lineTotal = toFils(i.total) ?? (toFils(i.unitPrice) !== undefined ? Math.round(toFils(i.unitPrice)! * qty) : undefined);
    return {
      name: lineName(String(i.name).trim().slice(0, 80)),
      part: clean(i.part, 60)?.toUpperCase(),
      car: clean(i.car, 40)?.toUpperCase(),
      qty,
      partNumber: String(i.partNumber ?? '').trim().toUpperCase() || undefined,
      lineTotal,
    };
  });
  const itemsSum = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  const subtotal = toFils(read.subtotal);
  const vatPrinted = toFils(read.vat);
  const total = toFils(read.total) || (subtotal ? subtotal + (vatPrinted ?? 0) : 0) || itemsSum;
  let vat = vatPrinted ?? (subtotal && total > subtotal ? total - subtotal : 0);
  if (vat > total) vat = 0;
  const net = total - vat;
  // Were the lines printed without VAT (their sum is the subtotal) or with it (their sum is the total)? Their net is told by that.
  const near = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(2, Math.round(b * 0.01));
  const linesGross = !near(itemsSum, net) && near(itemsSum, total) && vat > 0;
  const items = lines.map((l) => {
    const lineNet = l.lineTotal === undefined ? undefined : linesGross ? Math.round((l.lineTotal * net) / total) : l.lineTotal;
    return { name: l.name, part: l.part, car: l.car, qty: l.qty, partNumber: l.partNumber, lineNetFils: lineNet, unitNetFils: lineNet === undefined ? undefined : Math.round(lineNet / l.qty) };
  });
  const pm = String(read.paymentMethod ?? '').toLowerCase();
  const method: ExpenseMethod = /card/.test(pm) ? 'card' : /transfer|bank/.test(pm) ? 'transfer' : /credit|unpaid|due/.test(pm) ? 'credit' : 'cash';
  const { date, sure: dateSure } = receiptDate(read, today);
  const note = [read.invoiceNo ? `#${String(read.invoiceNo).trim().slice(0, 20)}` : '', ...items.map((i) => (i.qty !== 1 ? `${i.name} ×${i.qty}` : i.name))].filter(Boolean).join(' · ').slice(0, 200);
  return {
    ok: total > 0 && read.isReceipt !== false && (read.confidence ?? 1) >= 0.4,
    amountFils: total,
    vatFils: vat,
    vendor: clean(read.vendor, 60),
    vendorPhone: clean(read.vendorPhone, 30),
    vendorTrn: clean(read.vendorTrn, 20),
    vendorAddress: clean(read.vendorAddress, 120),
    vendorEmail: clean(read.vendorEmail, 60)?.toLowerCase(),
    kind: receiptKind(read.kind),
    date,
    dateSure,
    method,
    note,
    items,
    vatShareBp: net > 0 && vat > 0 ? Math.round((vat * 10000) / net) : 0,
  };
}

/** The supplier the garage adds to its base off the paper: a parts shop or a contractor (`service`). */
export interface ReceiptSupplier {
  name: string;
  phone?: string;
  address?: string;
  makes?: string[];
  service?: boolean;
  parts?: string;
  notes?: string;
}

/**
 * The seller as a supplier of the garage's (v0.50.1, the user: «понимает поставщика и добавляет его»): the name as
 * printed, the phone and the address off the paper, the make of the car it was bought for, what it sold (the first
 * lines), the TRN in the notes; a contractor's bill makes a contractor. No name worth the word, or a paper that is not
 * a parts shop's or a contractor's (fuel, food) — none: those are not suppliers.
 */
export function supplierFromReceipt(fields: ReceiptExpense, make = ''): ReceiptSupplier | undefined {
  if (fields.kind !== 'parts' && fields.kind !== 'service') return undefined;
  const name = fields.vendor?.trim() ?? '';
  if (name.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return undefined;
  const sold = fields.items.map((i) => i.name).filter(Boolean).slice(0, 3).join(', ').slice(0, 60) || undefined;
  return {
    name,
    phone: fields.vendorPhone,
    address: fields.vendorAddress,
    makes: make.trim() ? [make.trim()] : undefined,
    service: fields.kind === 'service' || undefined,
    parts: sold,
    notes: [fields.vendorTrn ? `TRN ${fields.vendorTrn}` : '', fields.vendorEmail ?? ''].filter(Boolean).join(' · ') || undefined,
  };
}

/** A job the receipt's parts may have been bought for: its lines (parts, work done outside) and its car. */
export interface JobForGuess {
  id: string;
  number: number;
  changedAt: string;
  /** The day it was opened (YYYY-MM-DD, Dubai): no part is bought for a job before it is there. */
  openedOn?: string;
  lines: { id: string; name: string; partNumber?: string; costFils?: number; supplierId?: string }[];
  car: { make: string; model: string; plateNumber: string; year?: number };
}
/** A receipt's line as the guess reads it. */
export interface ReceiptLine {
  name: string;
  part?: string;
  car?: string;
  partNumber?: string;
  unitNetFils?: number;
}
export interface GuessContext {
  /** The car written on the paper. */
  carText?: string;
  /** All the paper's words (a plate's digits in them count). */
  paperText?: string;
  /** The receipt's day. */
  date?: string;
  /** The seller, when it is the garage's supplier: a line already put on it is likelier. */
  supplierId?: string;
}
/** A receipt line taken for a job's line: by its number or by what it is. */
export interface JobMatch {
  item: number;
  lineId: string;
  how: 'number' | 'name';
  s: number;
}
export interface JobScore {
  orderId: string;
  number: number;
  score: number;
  matched: JobMatch[];
  /** The car on the paper is this job's model, its make, or the paper names no car. */
  car: 'model' | 'make' | 'none';
  changedAt: string;
}
export interface JobGuess {
  orderId: string;
  number: number;
  score: number;
  matched: JobMatch[];
  /** Another job fits nearly as well: the manager should look (the likely ones are a tap away). */
  close: boolean;
  /** Who picked it: the app's own matching (v0.50.2: no AI is asked). */
  by: 'app';
}

const plainNo = (x?: string) => (x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const carIn = (text: string, words: Set<string>) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => words.has(w));

/**
 * The jobs the receipt may be for, the likeliest first (v0.50.2). Each receipt line is paired with one job line at
 * most and each job line with one receipt line, the surest pairs first: the same part number — 1.5; the same part
 * (domain/partMatch.ts: «TAIL LAMP COVER» for «REAR STOP LIGHT», «PULLY» for «TENSIONER PULLEY», the dictionary's key) —
 * up to 1 (0.5 and more counts); the line's purchase price as on the paper +0.3; the line already on this seller +0.2.
 * The car: the paper's (its car, or a car a line names) is the job's model +0.6, its make +0.3; the paper names another
 * car — not this job; a line naming another car pairs with none of its lines; the plate's digits on the paper +1. A
 * job opened after the receipt's day is not it.
 */
export function rankJobs(items: ReceiptLine[], jobs: JobForGuess[], ctx: GuessContext = {}): JobScore[] {
  const carWords = new Set([...CAR_MAKES, ...jobs.flatMap((j) => carWordsOf(j.car.make, j.car.model))]);
  const lines = items.map((it) => {
    const a = partName(it.name, carWords);
    const b = it.part ? partName(it.part, carWords) : undefined;
    return { a, b, key: partKey(it.name), cars: [...new Set([...a.cars, ...(b?.cars ?? []), ...carIn(it.car ?? '', carWords)])], no: plainNo(it.partNumber) };
  });
  const paperCars = new Set([...carIn(ctx.carText ?? '', carWords), ...lines.flatMap((l) => l.cars)]);
  const digits = ` ${(ctx.paperText ?? '').replace(/\D+/g, ' ')} `;
  const out: JobScore[] = [];
  for (const job of jobs) {
    if (ctx.date && job.openedOn && job.openedOn > ctx.date) continue;
    const jobCar = new Set(carWordsOf(job.car.make, job.car.model));
    const models = new Set(carWordsOf('', job.car.model));
    let car: JobScore['car'] = 'none';
    if (paperCars.size && jobCar.size) {
      const hit = [...paperCars].filter((w) => jobCar.has(w));
      if (!hit.length) continue;
      car = hit.some((w) => models.has(w)) ? 'model' : 'make';
    }
    const named = job.lines.map((l) => ({ l, p: partName(l.name, carWords), key: partKey(l.name), no: plainNo(l.partNumber) }));
    const pairs: JobMatch[] = [];
    lines.forEach((r, i) => {
      if (r.cars.length && jobCar.size && !r.cars.some((w) => jobCar.has(w))) return;
      for (const { l, p, key, no } of named) {
        let s = Math.max(partSimilarity(r.a, p), r.b ? partSimilarity(r.b, p) : 0, r.key && r.key === key ? 1 : 0);
        let how: JobMatch['how'] = 'name';
        if (r.no.length >= 5 && r.no === no) (s = 1.5), (how = 'number');
        if (s < 0.5) continue;
        const price = items[i].unitNetFils;
        if (l.costFils && price && Math.abs(l.costFils - price) <= 1) s += 0.3;
        if (ctx.supplierId && l.supplierId === ctx.supplierId) s += 0.2;
        pairs.push({ item: i, lineId: l.id, how, s: Math.round(s * 100) / 100 });
      }
    });
    pairs.sort((x, y) => y.s - x.s);
    const usedItems = new Set<number>();
    const usedLines = new Set<string>();
    const matched: JobMatch[] = [];
    for (const m of pairs) {
      if (usedItems.has(m.item) || usedLines.has(m.lineId)) continue;
      usedItems.add(m.item);
      usedLines.add(m.lineId);
      matched.push(m);
    }
    let score = matched.reduce((t, m) => t + m.s, 0) + (car === 'model' ? 0.6 : car === 'make' ? 0.3 : 0);
    const plate = job.car.plateNumber.replace(/\D/g, '');
    if (plate.length >= 4 && digits.includes(` ${plate} `)) score += 1;
    out.push({ orderId: job.id, number: job.number, score: Math.round(score * 100) / 100, matched: matched.sort((x, y) => x.item - y.item), car, changedAt: job.changedAt });
  }
  return out.sort((a, b) => b.score - a.score || b.changedAt.localeCompare(a.changedAt));
}

/**
 * The job the parts were bought for, by the app itself: the likeliest at 1 and more (a part of it on the paper, or its
 * model and a part, or its plate); another within 0.5 of it — `close`. Below 1 — none.
 */
export function guessJob(ranked: JobScore[]): JobGuess | undefined {
  const [best, second] = ranked;
  if (!best || best.score < 1) return undefined;
  return { orderId: best.orderId, number: best.number, score: best.score, matched: best.matched, close: !!second && best.score - second.score < 0.5, by: 'app' };
}
