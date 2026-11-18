import { docDate, join, money, parseGarageDoc, rowsOf, type Row } from './docImport';
import type { TextItem } from './obdReport';
import type { HistoryLine } from './types';

/*
 * A customer's invoices from before this app, read off the PDFs they were sent in (v0.45 — a corporate customer, May–October 2026).
 * A month's PDF is its summary page (or two) — typed by hand: the day, the car, its plate, perhaps the invoice's number,
 * the sum — then one invoice a page, in one of two templates:
 *   A (May–June): "INVOICE", "# 224", "Date: May 8, 2026"; Bill To — the customer, the car ("NISSAN URVAN"),
 *     "PLATE NO.H-50505"; Item · Quantity · Rate · Amount (without VAT); Subtotal, Tax (5%), Total. A long name goes on
 *     to the next row, without figures; an invoice may go on to a page of its terms only.
 *   B (July–October): the Tax Invoice (read by domain/docImport.ts) — "Job ID : 107" or "Invoice Number : 188",
 *     "Date : 1 Oct 2026, 12:35:00 AM", the car and "PLATE : W-12345" (a VIN sometimes); # · Description · Price ·
 *     Discount · VAT · Qty · Total — the price and VAT of one, the line's total with VAT.
 * Arabic is left out. Every invoice's sums are checked: price × qty (− the discount) + VAT = the line's total, the VAT of
 * a line = ROUND(net × rate), the lines add up to the printed total. Pure: the text (pdf.js pieces with their places) in.
 */

export type PageKind = 'summary' | 'A' | 'B' | 'continuation' | 'empty' | 'other';

/** "1-Aug-26", "2-May-26" — a day of a summary. */
const SUMMARY_DAY = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** What a page is, by its words: a summary, an invoice of either template, an invoice's last page (terms), nothing. */
export function pageKind(rows: Row[]): PageKind {
  if (!rows.length) return 'empty';
  const text = rows.map((r) => r.text).join('\n');
  if (/^INVOICE$/im.test(text) && /^#\s*\d+\s*$/m.test(text)) return 'A';
  if (/TAX\s+INVOICE/i.test(text) && /(Job\s*ID|Invoice\s+Number)\s*:/i.test(text)) return 'B';
  if (/INVOICE\s+SUMMARY/i.test(text) || rows.some((r) => r.pieces.slice(0, 2).some((p) => SUMMARY_DAY.test(p.str.trim())))) return 'summary';
  if (/^Terms:/im.test(text)) return 'continuation';
  return 'other';
}

/** "1-Aug-26" → "2026-08-01". */
export function summaryDay(text: string): string | undefined {
  const m = SUMMARY_DAY.exec(text.trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  return month < 0 ? undefined : `20${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "May 8, 2026" → "2026-05-08" (template A). */
export function wordsDay(text: string): string | undefined {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  return month < 0 ? undefined : `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * A plate as printed, as code-number: "EE 54321" → "EE-54321", "14/12345" → "14-12345", "B - 12345" → "B-12345",
 * "PLATE NO.EE-12345" → "EE-12345", "AD1 2345" → "AD1-2345" (a code with its digit, set apart); a number without its
 * code stays alone ("-43364" → "43364").
 */
export function plateKey(raw: string): string {
  const s = raw
    .toUpperCase()
    .replace(/^\s*PLATE\s*(?:NO\.?|NUMBER|N\.)?\s*:?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // The code set apart by a space, a dash or a stroke: letters (with a digit or two after them) or one or two digits.
  const apart = /^([A-Z]{1,3}\d{0,2}|\d{1,2})\s*[-/.\s]\s*(\d{1,6})$/.exec(s);
  if (apart) return `${apart[1]}-${apart[2]}`;
  // Glued ("EE54321") or without its code ("-43364"): letters, then the number.
  const glued = /^([A-Z]{1,3})?(\d{1,6})$/.exec(s.replace(/[\s./-]/g, ''));
  if (glued) return glued[1] ? `${glued[1]}-${glued[2]}` : glued[2];
  return s.replace(/\s+/g, '');
}

/** Two plates a typing slip apart (or the same): one character other, missing or extra, or two neighbours swapped. */
export function plateNear(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

/** The VAT of a line: ROUND(net × rate), half away from zero (as a spreadsheet's ROUND). */
export const lineVat = (netFils: number, rateBp: number) => Math.sign(netFils) * Math.round((Math.abs(netFils) * rateBp) / 10000);

/** An invoice as read off its page. */
export interface ReadInvoice {
  template: 'A' | 'B';
  numberKind: 'invoice' | 'job';
  number: string;
  /** YYYY-MM-DD; `time` — "4:50 PM" (B). */
  date: string;
  time?: string;
  plateRaw: string;
  plate: string;
  vehicleText: string;
  vin?: string;
  lines: HistoryLine[];
  /** What is printed under the lines: Subtotal and Tax (A), Total (both). */
  printed: { net?: number; vat?: number; total: number };
  paymentMethod?: string;
  page: number;
  /** Pages it takes (May's 224 goes on to a page of its terms). */
  pages?: number;
}

const AED = /AED\s*-?[\d,]+\.\d{2}/i;
const lastAmount = (r: Row) => {
  const all = r.text.match(/-?[\d,]+\.\d{2}/g);
  return all ? money(all[all.length - 1]) : undefined;
};

/** An invoice of the old template (A) off its page's rows; none when the page is not one. */
export function readInvoiceA(rows: Row[], rateBp: number): ReadInvoice | null {
  const text = rows.map((r) => r.text).join('\n');
  const number = /^#\s*(\d+)\s*$/m.exec(text)?.[1];
  const date = wordsDay(/\bDate:\s*([^\n]+)/i.exec(text)?.[1] ?? '');
  const head = rows.findIndex((r) => /^Item\b.*\bQuantity\b.*\bRate\b.*\bAmount\b/i.test(r.text));
  if (!number || !date || head < 0) return null;
  // Bill To: the customer, the car right above its plate, the plate.
  const billAt = rows.findIndex((r) => /^Bill\s+To\b/i.test(r.text));
  const bill = rows.slice(billAt + 1, head).map((r) => r.text);
  const plateAt = bill.findIndex((l) => /^PLATE\b/i.test(l));
  const plateRaw = plateAt >= 0 ? bill[plateAt] : '';
  const vehicleText = plateAt > 0 ? bill[plateAt - 1] : '';
  // The lines: the name · quantity · rate · amount; a row without amounts goes on the name above it.
  const lines: HistoryLine[] = [];
  const printed: ReadInvoice['printed'] = { total: NaN };
  for (const r of rows.slice(head + 1)) {
    if (/^Subtotal\b/i.test(r.text)) printed.net = lastAmount(r);
    else if (/^Tax\b/i.test(r.text)) printed.vat = lastAmount(r);
    else if (/^Total\b/i.test(r.text)) {
      printed.total = lastAmount(r) ?? NaN;
      break;
    } else {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)\s+AED\s*(-?[\d,]+\.\d{2})\s+AED\s*(-?[\d,]+\.\d{2})$/i.exec(r.text);
      if (m) {
        const net = money(m[4])!;
        const vat = lineVat(net, rateBp);
        lines.push({ description: m[1].trim(), qty: Number(m[2]), unitNetFils: money(m[3])!, netFils: net, vatFils: vat, grossFils: net + vat });
      } else if (lines.length && !AED.test(r.text) && r.text.trim()) {
        const last = lines[lines.length - 1];
        last.description = `${last.description} ${r.text.trim()}`.replace(/\s+/g, ' ');
      }
    }
  }
  return { template: 'A', numberKind: 'invoice', number, date, plateRaw, plate: plateKey(plateRaw), vehicleText, lines, printed, page: rows[0]?.page ?? 0 };
}

/** A Tax Invoice (B) off its page's pieces; none when the page is not one. */
export function readInvoiceB(items: TextItem[], rateBp: number): ReadInvoice | null {
  const d = parseGarageDoc(items);
  if (!d || d.kind !== 'invoice' || !d.number || !d.date || d.totalFils === undefined) return null;
  const lines: HistoryLine[] = d.lines.map((l) => {
    const discount = l.discountFils ?? 0;
    // Without VAT: price × qty, less the discount — as the line's or as one's, whichever the line's total bears out.
    const asLine = l.qty * l.priceFils - discount;
    const asOne = l.qty * (l.priceFils - discount);
    const net = !discount || l.totalFils === asLine + lineVat(asLine, rateBp) || l.totalFils !== asOne + lineVat(asOne, rateBp) ? asLine : asOne;
    return {
      description: l.printed ?? l.title,
      qty: l.qty,
      unitNetFils: l.priceFils,
      ...(discount ? { discountFils: discount } : {}),
      netFils: net,
      vatFils: l.totalFils - net,
      grossFils: l.totalFils,
    };
  });
  const plateRaw = d.vehicle.plateText ?? '';
  return {
    template: 'B',
    numberKind: d.numberKind ?? 'invoice',
    number: d.number,
    date: d.date,
    ...(d.time ? { time: d.time } : {}),
    plateRaw,
    plate: plateKey(plateRaw),
    vehicleText: d.vehicle.carText ?? [d.vehicle.make, d.vehicle.model].filter(Boolean).join(' '),
    ...(d.vehicle.vin ? { vin: d.vehicle.vin } : {}),
    lines,
    printed: { total: d.totalFils },
    ...(d.paymentMethod ? { paymentMethod: d.paymentMethod } : {}),
    page: items[0]?.page ?? 0,
  };
}

/** What does not add up on an invoice (empty — all of it does). */
export function invoiceProblems(inv: ReadInvoice, rateBp: number): string[] {
  const out: string[] = [];
  const name = `${inv.numberKind === 'job' ? 'Job' : 'Invoice'} ${inv.number} (${inv.date})`;
  if (!inv.lines.length) out.push(`${name}: no lines`);
  inv.lines.forEach((l, i) => {
    const n = i + 1;
    if (inv.template === 'A' && Math.round(l.qty * l.unitNetFils) !== l.netFils) out.push(`${name}, line ${n}: ${l.qty} × ${l.unitNetFils / 100} ≠ ${l.netFils / 100}`);
    if (inv.template === 'B' && Math.round(l.qty * l.unitNetFils) - (l.discountFils ?? 0) !== l.netFils && Math.round(l.qty * (l.unitNetFils - (l.discountFils ?? 0))) !== l.netFils)
      out.push(`${name}, line ${n}: price × qty − discount ≠ ${l.netFils / 100}`);
    if (l.vatFils !== lineVat(l.netFils, rateBp)) out.push(`${name}, line ${n}: VAT ${l.vatFils / 100} ≠ ROUND(${l.netFils / 100} × ${rateBp / 100}%)`);
    if (l.netFils + l.vatFils !== l.grossFils) out.push(`${name}, line ${n}: ${l.netFils / 100} + ${l.vatFils / 100} ≠ ${l.grossFils / 100}`);
  });
  const sum = (k: 'netFils' | 'vatFils' | 'grossFils') => inv.lines.reduce((a, l) => a + l[k], 0);
  if (sum('grossFils') !== inv.printed.total) out.push(`${name}: the lines add up to ${sum('grossFils') / 100}, the total printed is ${inv.printed.total / 100}`);
  if (inv.printed.net !== undefined && sum('netFils') !== inv.printed.net) out.push(`${name}: net ${sum('netFils') / 100} ≠ Subtotal ${inv.printed.net / 100}`);
  if (inv.printed.vat !== undefined && sum('vatFils') !== inv.printed.vat) out.push(`${name}: VAT ${sum('vatFils') / 100} ≠ Tax ${inv.printed.vat / 100}`);
  if (!inv.plate) out.push(`${name}: no plate`);
  return out;
}

/* ---------------- The summary ---------------- */

export interface ReadSummaryRow {
  no: number;
  date?: string;
  vehicleText: string;
  plateRaw: string;
  plate: string;
  invoiceNo?: string;
  amountFils: number;
  page: number;
}

export interface ReadSummary {
  rows: ReadSummaryRow[];
  /** The TOTAL printed under the rows. */
  totalFils?: number;
  page: number;
}

type Col = 'no' | 'invoice' | 'date' | 'vehicle' | 'plate' | 'amount';

/** The columns of a summary's head row, by their middles: «DATE · CAR NAME · PLATE NO. · INVOICE NO. · AMOUNT» and the like. */
function summaryColumns(head: Row): [Col, number][] {
  const out: [Col, number][] = [];
  for (const p of head.pieces) {
    const t = p.str.trim().toUpperCase();
    const mid = p.x + (p.w ?? 0) / 2;
    const col: Col | undefined = /INV(OICE)?\.?\s*NO/.test(t) ? 'invoice' : /^NO\.?$/.test(t) ? 'no' : /DATE/.test(t) ? 'date' : /CAR|VEHICLE|MODEL/.test(t) ? 'vehicle' : /PLATE/.test(t) ? 'plate' : /AMOUNT/.test(t) ? 'amount' : undefined;
    if (col && !out.some((c) => c[0] === col)) out.push([col, mid]);
  }
  return out;
}

/** A summary off its pages' rows: the rows under its head row (a second page goes on under the first page's head), its TOTAL. */
export function readSummary(pages: Row[][]): ReadSummary | null {
  let cols: [Col, number][] | undefined;
  const rows: ReadSummaryRow[] = [];
  let totalFils: number | undefined;
  for (const page of pages) {
    for (const r of page) {
      const t = r.text.toUpperCase();
      if (/PLATE/.test(t) && /AMOUNT/.test(t)) {
        cols = summaryColumns(r);
        continue;
      }
      if (!cols) continue;
      if (/^TOTAL\b/.test(t)) {
        totalFils = lastAmount(r);
        continue;
      }
      const cells: Partial<Record<Col, string[]>> = {};
      for (const p of r.pieces) {
        const mid = p.x + (p.w ?? 0) / 2;
        const col = cols.reduce((best, c) => (Math.abs(c[1] - mid) < Math.abs(best[1] - mid) ? c : best))[0];
        (cells[col] ??= []).push(p.str.trim());
      }
      const cell = (c: Col) => (cells[c] ?? []).join(' ').replace(/\s+/g, ' ').trim();
      const amount = money(cell('amount').replace(/[^\d.,-]/g, ''));
      const date = summaryDay(cell('date'));
      if (amount === undefined || !date) continue;
      const plateRaw = cell('plate');
      rows.push({
        no: Number(cell('no')) || rows.length + 1,
        date,
        vehicleText: cell('vehicle'),
        plateRaw,
        plate: plateKey(plateRaw),
        ...(cell('invoice') ? { invoiceNo: cell('invoice').replace(/\D/g, '') } : {}),
        amountFils: amount,
        page: r.page,
      });
    }
  }
  return cols ? { rows, totalFils, page: pages[0]?.[0]?.page ?? 0 } : null;
}

/** A summary row with the invoice it is: ok, another sum, another plate (a typo), both — or no document for it. */
export interface SummaryMatch {
  row: ReadSummaryRow;
  /** The invoice's index; none — no document for the row. */
  invoice?: number;
  status: 'ok' | 'amount' | 'plate' | 'plate-amount' | 'missing';
}

/**
 * The rows of a summary matched with the invoices of its month: by the invoice's number where the summary has it, else
 * by the day and the plate, the day and the sum, the day and a plate a slip apart, the plate and the sum. Each invoice
 * once; `unlisted` — invoices no row is.
 */
export function matchSummary(rows: ReadSummaryRow[], invoices: Pick<ReadInvoice, 'number' | 'date' | 'plate' | 'printed'>[]): { matches: SummaryMatch[]; unlisted: number[] } {
  const used = new Set<number>();
  const found = new Map<ReadSummaryRow, number>();
  const pass = (fits: (r: ReadSummaryRow, inv: (typeof invoices)[number]) => boolean) => {
    for (const r of rows) {
      if (found.has(r)) continue;
      const hits = invoices.map((_, i) => i).filter((i) => !used.has(i) && fits(r, invoices[i]));
      if (hits.length === 1 || (hits.length > 1 && fits === byNumber)) {
        found.set(r, hits[0]);
        used.add(hits[0]);
      }
    }
  };
  const byNumber = (r: ReadSummaryRow, inv: (typeof invoices)[number]) => !!r.invoiceNo && r.invoiceNo === inv.number;
  pass(byNumber);
  pass((r, inv) => r.date === inv.date && r.plate === inv.plate);
  pass((r, inv) => r.date === inv.date && r.amountFils === inv.printed.total);
  pass((r, inv) => r.date === inv.date && plateNear(r.plate, inv.plate));
  pass((r, inv) => r.plate === inv.plate && r.amountFils === inv.printed.total);
  const matches = rows.map((row): SummaryMatch => {
    const i = found.get(row);
    if (i === undefined) return { row, status: 'missing' };
    const inv = invoices[i];
    const plateOk = row.plate === inv.plate;
    const sumOk = row.amountFils === inv.printed.total;
    return { row, invoice: i, status: plateOk && sumOk ? 'ok' : plateOk ? 'amount' : sumOk ? 'plate' : 'plate-amount' };
  });
  return { matches, unlisted: invoices.map((_, i) => i).filter((i) => !used.has(i)) };
}

/* ---------------- A whole PDF ---------------- */

export interface ReadDocument {
  pages: number;
  kinds: Partial<Record<PageKind, number>>;
  invoices: ReadInvoice[];
  summary?: ReadSummary;
  /** Pages that could not be read, sums that do not add up: an import does not go on with any. */
  problems: string[];
}

/** A month's PDF: its summary (its first pages), its invoices one a page, each checked. */
export function readDocument(items: TextItem[], pages: number, rateBp: number): ReadDocument {
  const byPage = new Map<number, TextItem[]>();
  for (const it of items) (byPage.get(it.page) ?? byPage.set(it.page, []).get(it.page)!).push(it);
  const kinds: ReadDocument['kinds'] = {};
  const invoices: ReadInvoice[] = [];
  const summaryPages: Row[][] = [];
  const problems: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const its = byPage.get(page) ?? [];
    const rows = rowsOf(its);
    const kind = pageKind(rows);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (kind === 'summary') summaryPages.push(rows);
    else if (kind === 'continuation') {
      const last = invoices[invoices.length - 1];
      if (last) last.pages = page - last.page + 1;
    } else if (kind === 'A' || kind === 'B') {
      const inv = kind === 'A' ? readInvoiceA(rows, rateBp) : readInvoiceB(its, rateBp);
      if (!inv) problems.push(`page ${page}: an invoice that could not be read`);
      else {
        inv.page = page;
        invoices.push(inv);
        problems.push(...invoiceProblems(inv, rateBp).map((p) => `page ${page}: ${p}`));
      }
    } else if (kind === 'other') problems.push(`page ${page}: not an invoice, a summary or its terms`);
  }
  const summary = summaryPages.length ? readSummary(summaryPages) ?? undefined : undefined;
  return { pages, kinds, invoices, ...(summary ? { summary } : {}), problems };
}

/* ---------------- The month table ---------------- */

/** A month's invoices: how many, their lines, net, VAT, total (the control table of an import). */
export interface MonthRow {
  /** YYYY-MM; the whole — "all". */
  month: string;
  invoices: number;
  lines: number;
  netFils: number;
  vatFils: number;
  totalFils: number;
}

/** The invoices by month (their days'), and all of them in the last row. */
export function monthTable(invoices: { date: string; lines: Pick<HistoryLine, 'netFils' | 'vatFils' | 'grossFils'>[] }[]): MonthRow[] {
  const by = new Map<string, MonthRow>();
  const all: MonthRow = { month: 'all', invoices: 0, lines: 0, netFils: 0, vatFils: 0, totalFils: 0 };
  for (const inv of invoices) {
    const m = inv.date.slice(0, 7);
    const row = by.get(m) ?? by.set(m, { month: m, invoices: 0, lines: 0, netFils: 0, vatFils: 0, totalFils: 0 }).get(m)!;
    for (const r of [row, all]) {
      r.invoices++;
      r.lines += inv.lines.length;
      for (const l of inv.lines) {
        r.netFils += l.netFils;
        r.vatFils += l.vatFils;
        r.totalFils += l.grossFils;
      }
    }
  }
  return [...[...by.values()].sort((a, b) => a.month.localeCompare(b.month)), all];
}

/** Two month tables the same, figure for figure (what differs, as words; none — the same). */
export function tableDiff(got: MonthRow[], want: MonthRow[]): string[] {
  const out: string[] = [];
  for (const w of want) {
    const g = got.find((r) => r.month === w.month);
    if (!g) {
      out.push(`${w.month}: none`);
      continue;
    }
    for (const k of ['invoices', 'lines', 'netFils', 'vatFils', 'totalFils'] as const)
      if (g[k] !== w[k]) out.push(`${w.month} ${k}: ${k.endsWith('Fils') ? g[k] / 100 : g[k]} ≠ ${k.endsWith('Fils') ? w[k] / 100 : w[k]}`);
  }
  for (const g of got) if (!want.some((w) => w.month === g.month)) out.push(`${g.month}: not expected`);
  return out;
}

export { join as joinPieces, docDate };
