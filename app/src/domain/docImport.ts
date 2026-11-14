import { canonicalMake, canonicalModel, CAR_MAKES } from './carCatalog';
import type { TextItem } from './obdReport';
import type { Emirate, ItemKind } from './types';

/*
 * A tax invoice or a quotation as the garage prints them — from Eaglecart, its old system, or from this
 * app (the same layout): who it is for, the car and its plate, the lines with their prices. Read from the
 * text of the PDF (pdf.js items with their positions); Arabic captions are left out.
 *
 * The page: the title ("TAX INVOICE", "Quotation"), the seller on the left, "BILL TO" / "QUOTATION TO" on
 * the right (name, phone, e-mail, "Tax ID (TRN): …", the car "Suzuki Ertiga (Red)", "PLATE : Y-39957"),
 * "Invoice Number : 271", "Date : 30 Nov 2026, …", then the table "# · Description · Price · Discount ·
 * VAT · Qty · Total" — prices per unit without VAT, VAT per unit, the line's total with VAT — and the totals.
 */

export interface DocLine {
  title: string;
  kind: Extract<ItemKind, 'labor' | 'part'>;
  qty: number;
  /** Per unit without VAT, as printed. */
  priceFils: number;
  /** VAT per unit, as printed. */
  vatFils: number;
  /** The line's total with VAT (after its discount): what the customer pays for it. */
  totalFils: number;
}

export interface GarageDoc {
  kind: 'invoice' | 'quotation';
  number?: string;
  /** YYYY-MM-DD */
  date?: string;
  customer: { name: string; phone?: string; email?: string; trn?: string };
  vehicle: { make: string; model: string; color?: string; vin?: string; plate?: { emirate: Emirate; code: string; number: string } };
  lines: DocLine[];
  totalFils?: number;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface Piece {
  x: number;
  w?: number;
  str: string;
}
interface Row {
  page: number;
  y: number;
  pieces: Piece[];
  text: string;
}

/** The page's lines, top to bottom: pieces on one height, left to right, glued where the PDF split a word. */
function rowsOf(items: TextItem[]): Row[] {
  const rows: Row[] = [];
  const latin = items.filter((i) => !ARABIC.test(i.str) && i.str.trim());
  for (const it of [...latin].sort((a, b) => a.page - b.page || b.y - a.y)) {
    const row = rows.find((r) => r.page === it.page && Math.abs(r.y - it.y) <= 2);
    if (row) row.pieces.push({ x: it.x, w: it.w, str: it.str });
    else rows.push({ page: it.page, y: it.y, pieces: [{ x: it.x, w: it.w, str: it.str }], text: '' });
  }
  for (const r of rows) {
    r.pieces.sort((a, b) => a.x - b.x);
    r.text = join(r.pieces);
  }
  return rows;
}

/** Pieces as text: a piece that starts where the last one ended is the same word ("M" + "itsubishi"). */
function join(pieces: Piece[]): string {
  let out = '';
  let end: number | undefined;
  for (const p of pieces) {
    const glued = end !== undefined && p.x - end < 1.2;
    out += out && !glued ? ' ' + p.str.trimStart() : p.str;
    end = p.w !== undefined ? p.x + p.w : undefined;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** "4,285.71", "AED 210.00", "-AED 92.00" → fils. */
const money = (s: string): number | undefined => {
  const m = /^(-?)(?:AED\s*)?([\d,]+)(?:\.(\d{1,2}))?$/i.exec(s.trim());
  if (!m) return undefined;
  const whole = Number(m[2].replace(/,/g, ''));
  const frac = Number((m[3] ?? '0').padEnd(2, '0'));
  if (!Number.isFinite(whole)) return undefined;
  return (m[1] ? -1 : 1) * (whole * 100 + frac);
};

/** "30 Nov 2026" → "2026-11-30". */
function docDate(text: string): string | undefined {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(text);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const EMIRATE_WORDS: [RegExp, Emirate][] = [
  [/\bdubai\b|\bdxb\b/i, 'DXB'],
  [/\bsharjah\b|\bshj\b/i, 'SHJ'],
  [/\babu\s*dhabi\b|\bauh\b/i, 'AUH'],
  [/\bajman\b|\bajm\b/i, 'AJM'],
  [/\bras\s*al\s*khaimah\b|\brak\b/i, 'RAK'],
  [/\bumm\s*al\s*quwain\b|\buaq\b/i, 'UAQ'],
  [/\bfujairah\b|\bfuj\b/i, 'FUJ'],
];

/** "E 86508", "Z-67274", "DD 22043", "5 / 87920", "Sharjah 3 12345" — the emirate is Dubai unless written. */
export function parsePlateText(text: string): { emirate: Emirate; code: string; number: string } | undefined {
  let s = text.trim();
  let emirate: Emirate = 'DXB';
  for (const [re, e] of EMIRATE_WORDS)
    if (re.test(s)) {
      emirate = e;
      s = s.replace(re, ' ');
    }
  const m = /^\s*([A-Z]{1,3}|\d{1,2})?\s*[-/ ]?\s*(\d{1,6})\s*$/i.exec(s.replace(/\s+/g, ' '));
  if (!m) return undefined;
  return { emirate, code: (m[1] ?? '').toUpperCase(), number: m[2] };
}

/** Short names the garage writes for a make. */
const MAKE_ALIASES: [RegExp, string][] = [
  [/^mercedes(?!-)\b|^benz\b|^mb\b/i, 'Mercedes-Benz'],
  [/^vw\b/i, 'Volkswagen'],
  [/^chevy\b/i, 'Chevrolet'],
  [/^range\s+rover\b/i, 'Land Rover Range Rover'],
];

/** "Suzuki Ertiga (Red)" → make, model, colour; makes of two words ("Land Rover") are known by the catalogue. */
export function parseCarText(text: string): { make: string; model: string; color?: string } {
  const color = /\(([^)]+)\)\s*$/.exec(text)?.[1]?.trim();
  let car = text.replace(/\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  for (const [re, make] of MAKE_ALIASES) if (re.test(car)) car = car.replace(re, make);
  const low = car.toLowerCase();
  const make = [...CAR_MAKES].sort((a, b) => b.length - a.length).find((m) => low === m.toLowerCase() || low.startsWith(m.toLowerCase() + ' '));
  const [first, ...rest] = car.split(' ');
  const mk = make ?? canonicalMake(first ?? '');
  const model = (make ? car.slice(make.length) : rest.join(' ')).trim();
  return { make: mk, model: canonicalModel(mk, model), color: color || undefined };
}

/** Work, not a part: the usual words of the garage's lines ("LABOUR CHARGES", "… REPAIR", "WHEEL ALIGNMENT"). */
const LABOR = /\b(LABOU?R|CHARGES?|REPAIR\w*|SERVIC\w*|REPLAC\w*|CHANGE|CHANGING|ALIG\w*|BALANC\w*|SKIM\w*|CHECK\w*|INSPECT\w*|DIAGNO\w*|SCAN\w*|WASH\w*|POLISH\w*|PAINT\w*|DENT\w*|WELD\w*|FITTING|INSTALL\w*|REMOV\w*|OVERHAUL\w*|CLEAN|CLEANING|FLUSH\w*|TUNE|TUNING|PROGRAM\w*|CODING|RESET|RECHARG\w*|REFILL\w*|TOWING|RECOVERY|ADJUST\w*|WORKS?|FIXING|TEST\w*|RESURFAC\w*|REBUILD\w*|RECONDITION\w*|BLEED\w*|TINT\w*|DETAIL\w*|PASSING|REGISTRATION)\b/i;

export function lineKind(title: string): DocLine['kind'] {
  return LABOR.test(title) ? 'labor' : 'part';
}

/** The garage's invoice or quotation from the text of its PDF; null when the page is not one. */
export function parseGarageDoc(items: TextItem[]): GarageDoc | null {
  const isTitle = (r: Row) => /^(simplified\s+)?(tax\s+)?(invoice|quotation|estimate|credit\s+note)$/i.test(r.text);
  const every = rowsOf(items);
  // Several documents in one PDF (merged, maybe after a summary page): the first one, from its page on.
  const titles = every.filter(isTitle);
  const from = titles.length ? every.findIndex((r) => r.page === titles[0].page) : 0;
  const rows = every.slice(from, titles.length > 1 ? every.indexOf(titles[1]) : undefined);
  const titleRow = titles[0];
  const head = rows.find((r) => /\bDescription\b/i.test(r.text) && /\bQty\b/i.test(r.text) && /\bTotal\b/i.test(r.text));
  if (!head) return null;
  const all = rows.map((r) => r.text).join('\n');
  const kindText = titleRow?.text ?? (/quotation\s+number/i.test(all) ? 'quotation' : 'invoice');
  if (/credit\s+note/i.test(kindText)) return null;
  const kind: GarageDoc['kind'] = /quotation|estimate/i.test(kindText) ? 'quotation' : 'invoice';
  // "Invoice Number : 271", "Quotation Number : 245", "Invoice Number : INV-2026-00004" (this app) or "Job ID : 106".
  const number = (/(?:invoice|quotation|estimate)\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9/-]*)/i.exec(all) ?? /\bJob\s*ID\s*:?\s*(\d+)/i.exec(all))?.[1];
  const date = docDate(/\bDate\s*:?\s*([^\n]+)/i.exec(all)?.[1] ?? '');

  // The customer and the car: the right-hand column between "BILL TO" and the table.
  const toRow = rows.find((r) => r.page === head.page && /\b(BILL\s+TO|QUOTATION\s+TO|INVOICE\s+TO|CUSTOMER)\b/i.test(r.text) && r.y > head.y);
  const right: string[] = [];
  if (toRow) {
    const toX = toRow.pieces.find((p) => /BILL|QUOTATION|INVOICE|CUSTOMER/i.test(p.str))?.x ?? 300;
    const from = Math.min(toX, 300) - 70;
    for (const r of rows) {
      if (r.page !== head.page || r.y >= toRow.y || r.y <= head.y) continue;
      const text = join(r.pieces.filter((p) => p.x >= from));
      if (text) right.push(text);
    }
  }
  const customer: GarageDoc['customer'] = { name: '' };
  const vehicle: GarageDoc['vehicle'] = { make: '', model: '' };
  const other: { text: string; at: number }[] = [];
  let plateAt = -1;
  right.forEach((line, at) => {
    const plate = /^PLATE\s*(?:NO\.?|NUMBER)?\s*:?\s*(.+)$/i.exec(line);
    const vin = /\b(?:VIN|CHASSIS)\b[^:]*:?\s*([A-HJ-NPR-Z0-9]{11,17})\s*$/i.exec(line);
    const trn = /\bTRN\b\)?\s*:?\s*(\d{15})/i.exec(line);
    if (plate) {
      vehicle.plate = parsePlateText(plate[1]);
      plateAt = at;
    } else if (vin) vehicle.vin = vin[1].toUpperCase();
    else if (trn) customer.trn = trn[1];
    else if (/@/.test(line)) customer.email = line.replace(/\s+/g, '');
    else if (/^\+?[\d\s()-]{8,}$/.test(line)) customer.phone = line.replace(/[^\d+]/g, '');
    else other.push({ text: line, at });
  });
  // The car is the line right above its plate; the name is what comes first.
  const carLine = plateAt > 0 ? other.find((o) => o.at === plateAt - 1) : undefined;
  if (carLine) Object.assign(vehicle, parseCarText(carLine.text));
  const name = other
    .filter((o) => o !== carLine && o.at < (carLine?.at ?? Infinity))
    .map((o) => o.text)
    .join(' ')
    .trim();
  customer.name = (name.match(/[A-Za-zА-Яа-яЁё]/g)?.length ?? 0) >= 2 ? name.replace(/\s+\.$/, '') : '';

  // The table: columns by the header, a numbered row starts a line, text under it goes on its name.
  const col = (re: RegExp) => head.pieces.find((p) => re.test(p.str))?.x;
  const cols = (
    [
      ['desc', col(/^Description/i)],
      ['price', col(/^(Unit\s+)?Price|^Rate/i)],
      ['discount', col(/^Disc/i)],
      ['vat', col(/^VAT|^Tax/i)],
      ['qty', col(/^Qty|^Quantity/i)],
      ['total', col(/^Total|^Amount/i)],
    ] as [string, number | undefined][]
  )
    .filter((c): c is [string, number] => c[1] !== undefined)
    .sort((a, b) => a[1] - b[1]);
  const descX = cols.find((c) => c[0] === 'desc')?.[1] ?? 50;
  const colOf = (x: number) => [...cols].reverse().find((c) => c[1] <= x + 12)?.[0] ?? 'desc';
  const lines: (DocLine & { discountFils: number })[] = [];
  let current: (DocLine & { discountFils: number; page: number }) | undefined;
  let totalFils: number | undefined;
  const start = rows.indexOf(head);
  for (const r of rows.slice(start + 1)) {
    if (/^(Total\s+Qty|Sub\s*total)\b/i.test(r.text) || /\bSubtotal\b/i.test(r.text)) break;
    if (r === head || (/\bDescription\b/i.test(r.text) && /\bQty\b/i.test(r.text))) continue;
    // The number and the name may come as one piece ("1. BRAKE PADS"): two, the name where names stand.
    const glued = r.pieces[0] && r.pieces[0].x < descX - 4 ? /^(\d+\.)\s+(.+)$/.exec(r.pieces[0].str.trim()) : null;
    if (glued) r.pieces.splice(0, 1, { x: r.pieces[0].x, str: glued[1] }, { x: descX, str: glued[2] });
    const numbered = r.pieces[0] && r.pieces[0].x < descX - 4 && /^\d+\.?$/.test(r.pieces[0].str.trim());
    const cells: Record<string, string[]> = {};
    for (const p of numbered ? r.pieces.slice(1) : r.pieces) {
      if (/^AED$/i.test(p.str.trim())) continue;
      const c = colOf(p.x);
      (cells[c] ??= []).push(p.str);
    }
    const desc = join((numbered ? r.pieces.slice(1) : r.pieces).filter((p) => colOf(p.x) === 'desc' && !/^AED$/i.test(p.str.trim())));
    const num = (c: string) => money((cells[c] ?? []).join('').replace(/^AED/i, ''));
    if (numbered) {
      const qty = Number((cells.qty ?? ['1']).join('').replace(/,/g, '')) || 1;
      const price = num('price') ?? 0;
      const vat = num('vat') ?? 0;
      const discount = num('discount') ?? 0;
      const total = num('total') ?? Math.round(qty * (price + vat - discount));
      current = { title: desc, kind: 'part', qty, priceFils: price, vatFils: vat, discountFils: discount, totalFils: total, page: r.page };
      lines.push(current);
    } else if (current && desc && current.page === r.page && Object.keys(cells).every((c) => c === 'desc')) {
      current.title = `${current.title} ${desc}`.replace(/\s+/g, ' ');
    }
  }
  const totalRow = rows.slice(start + 1).find((r) => /^Total\b(?!\s*Qty)/i.test(r.text) && r.pieces.some((p) => money(p.str) !== undefined));
  if (totalRow) totalFils = money(totalRow.pieces.filter((p) => money(p.str) !== undefined).pop()!.str);
  return {
    kind,
    number,
    date,
    customer,
    vehicle,
    lines: lines
      .filter((l) => l.title.trim())
      .map(({ title, qty, priceFils, vatFils, totalFils: t }) => {
        const clean = title.replace(/\s+/g, ' ').trim().toUpperCase();
        return { title: clean, kind: lineKind(clean), qty, priceFils, vatFils, totalFils: t };
      }),
    totalFils,
  };
}
