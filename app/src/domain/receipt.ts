import { dubaiDate } from './dates';
import { lineName } from './items';
import { partKey } from './partsVocab';
import { normalizeText } from './search';
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
  /** What the paper is for: parts, a contractor's work, fuel, food, other (v0.50.1). */
  kind?: string;
  invoiceNo?: string;
  date?: string;
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
  /** Parts and a contractor's work are recorded by themselves; anything else waits for the manager's category. */
  kind: ReceiptKind;
  date: string;
  method: ExpenseMethod;
  note: string;
  /** The lines, named as the garage names lines (capitals), each with its net price per piece in fils when the paper gives one. */
  items: { name: string; qty: number; partNumber?: string; unitNetFils?: number; lineNetFils?: number }[];
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
    return { name: lineName(String(i.name).trim().slice(0, 80)), qty, partNumber: String(i.partNumber ?? '').trim().toUpperCase() || undefined, lineTotal };
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
    return { name: l.name, qty: l.qty, partNumber: l.partNumber, lineNetFils: lineNet, unitNetFils: lineNet === undefined ? undefined : Math.round(lineNet / l.qty) };
  });
  const pm = String(read.paymentMethod ?? '').toLowerCase();
  const method: ExpenseMethod = /card/.test(pm) ? 'card' : /transfer|bank/.test(pm) ? 'transfer' : /credit|unpaid|due/.test(pm) ? 'credit' : 'cash';
  const d = String(read.date ?? '');
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today && d >= yearAgo ? d : today;
  const note = [read.invoiceNo ? `#${String(read.invoiceNo).trim().slice(0, 20)}` : '', ...items.map((i) => (i.qty !== 1 ? `${i.name} ×${i.qty}` : i.name))].filter(Boolean).join(' · ').slice(0, 200);
  return {
    ok: total > 0 && read.isReceipt !== false && (read.confidence ?? 1) >= 0.4,
    amountFils: total,
    vatFils: vat,
    vendor: clean(read.vendor, 60),
    vendorPhone: clean(read.vendorPhone, 30),
    vendorTrn: clean(read.vendorTrn, 20),
    vendorAddress: clean(read.vendorAddress, 120),
    kind: receiptKind(read.kind),
    date,
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
    notes: fields.vendorTrn ? `TRN ${fields.vendorTrn}` : undefined,
  };
}

/** A job the parts may have been bought for: its part lines and its car. */
export interface JobForGuess {
  id: string;
  number: number;
  changedAt: string;
  lines: { id: string; name: string; costFils?: number }[];
  car: { make: string; model: string; plateNumber: string };
}
export interface JobGuess {
  orderId: string;
  number: number;
  score: number;
  /** Which receipt line is which job line (the first word-for-word match wins a line). */
  matched: { item: number; lineId: string; how: 'key' | 'words' }[];
  /** Another job fits nearly as well: the manager should look. */
  close: boolean;
}

/** The words of a part's name that tell parts apart (three letters and more; English plurals folded). */
const nameWords = (s: string): Set<string> =>
  new Set(
    normalizeText(s)
      .split(' ')
      .filter((w) => w.length >= 3)
      .map((w) => (w.length > 4 && /[a-z]$/.test(w) && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  );

/**
 * The job the parts on the receipt were bought for: the one whose part lines name them — by the dictionary's key (one
 * part under any words) or by most of their words; the car named on the paper (its model, its plate) counts too. One
 * line of the job takes one line of the receipt. Nothing fits — no job; two fit alike — the fresher, marked `close`.
 */
export function guessJob(items: { name: string }[], paperText: string, jobs: JobForGuess[]): JobGuess | undefined {
  const names = [...new Set(items.map((i) => i.name.trim()).filter(Boolean))];
  if (!names.length && !paperText.trim()) return undefined;
  const keys = names.map((n) => partKey(n));
  const words = names.map(nameWords);
  const paper = normalizeText(paperText);
  const scored = jobs.map((job) => {
    const taken = new Set<string>();
    const matched: JobGuess['matched'] = [];
    let score = 0;
    const lineKeys = job.lines.map((l) => partKey(l.name));
    const lineWords = job.lines.map((l) => nameWords(l.name));
    names.forEach((_, i) => {
      let best: { lineId: string; how: 'key' | 'words'; w: number } | undefined;
      job.lines.forEach((l, k) => {
        if (taken.has(l.id)) return;
        if (keys[i] && keys[i] === lineKeys[k]) {
          if (!best || best.w < 1) best = { lineId: l.id, how: 'key', w: 1 };
          return;
        }
        const a = words[i];
        const b = lineWords[k];
        if (!a.size || !b.size) return;
        let common = 0;
        for (const w of a) if (b.has(w)) common++;
        const share = common / Math.min(a.size, b.size);
        // Every word of the shorter name in the other («BRAKE PADS» for a line «FRONT BRAKE PADS», «AIR FILTER ELEMENT»
        // for «AIR FILTER») is the part itself — as good as the dictionary's key; most of the words — likely.
        const w = share >= 1 && Math.min(a.size, b.size) >= 2 ? 1 : common >= 1 && share >= 0.6 ? 0.6 : 0;
        if (w && (!best || best.w < w)) best = { lineId: l.id, how: 'words', w };
      });
      if (best) {
        taken.add(best.lineId);
        matched.push({ item: i, lineId: best.lineId, how: best.how });
        score += best.w;
      }
    });
    if (paper) {
      const model = normalizeText(job.car.model);
      if (model.length >= 3 && paper.includes(model)) score += 0.5;
      const plate = job.car.plateNumber.replace(/\D/g, '');
      if (plate.length >= 4 && paper.includes(plate)) score += 1;
    }
    return { job, score, matched };
  });
  scored.sort((a, b) => b.score - a.score || b.job.changedAt.localeCompare(a.job.changedAt));
  const best = scored[0];
  if (!best || best.score < 1) return undefined;
  const second = scored[1];
  return { orderId: best.job.id, number: best.job.number, score: best.score, matched: best.matched, close: !!second && best.score - second.score < 0.5 };
}
