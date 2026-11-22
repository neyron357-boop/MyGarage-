import { owedInNotes, type MoneyType } from './moneySheet';
import { buildWorkbook, colName, daySerial, sheetRef, type XCell, type XChart, type XSheet, type XStyle } from './xlsx';

/*
 * The money book as the workbook the garage exports (the owner: «разбить журнал на листы — один общий со всеми, другие
 * по способу: карта, перевод, в кредит…; дизайн приятный для глаз, чтения и анализа — просторно, цвета прихода и
 * расхода»):
 * - Transactions — every operation, oldest first; the first sheet, and the one `readMoneyWorkbook` reads back: "Cash Start"
 *   with its value right under it, the head row Date · Type · Amount (AED) · Payment · Category · Cash Balance · Notes,
 *   Payment Cash / Card / Transfer / Owner / Credit; no row under the table (it would be read as a row).
 * - a sheet per way that has rows — Cash (its balance after each row), Card, Transfer (operations only: no balance, as in
 *   the app), Owner (past the cash box), Credit (taken on credit — no money moved; whom it is owed to, paid back, left);
 *   money In and Out in columns of their own, the Total row under the table counts what a filter leaves.
 * - By month — each way in and out, what was taken on credit, Total In / Out (every way but credit) and Net; a chart.
 * A title band (the garage, the period, the day exported), figures in tiles over each table, the head row frozen with a
 * filter; income green, expense red, credit orange, the owner grey. Money is fils until a cell is written. Pure.
 */

export type MoneyWay = 'cash' | 'card' | 'transfer' | 'owner' | 'credit';
/** The ways in the order of their sheets. */
export const MONEY_WAYS: readonly MoneyWay[] = ['cash', 'card', 'transfer', 'owner', 'credit'];

export interface MoneyBookRow {
  date: string; // YYYY-MM-DD
  type: MoneyType;
  /** Positive. */
  amountFils: number;
  way: MoneyWay;
  category: string;
  /** Taken on credit: «Owed to … — …» first (the Credit sheet puts the name in a column of its own). */
  notes: string;
  /** Taken on credit: what is still owed on it — the Credit sheet shows it and what is paid. */
  leftFils?: number;
}

export interface MoneyBook {
  /** The garage's name ('' — none). */
  garage: string;
  /** The day of the export, YYYY-MM-DD. */
  today: string;
  cashStartFils: number;
  /** Oldest first. */
  rows: MoneyBookRow[];
}

export interface InOut {
  inFils: number;
  outFils: number;
}

export interface MoneyMonth extends InOut {
  /** YYYY-MM */
  month: string;
  ways: Record<MoneyWay, InOut>;
}

export interface MoneyBookTotals extends InOut {
  ways: Record<MoneyWay, InOut & { count: number }>;
  /** The cash after the last row. */
  cashEndFils: number;
  /** Oldest first. In / Out of a month and of the book (`inFils`, `outFils`): every way but credit (no money moved). */
  months: MoneyMonth[];
}

const inOut = (): InOut => ({ inFils: 0, outFils: 0 });
function byWay<T>(make: () => T): Record<MoneyWay, T> {
  return Object.fromEntries(MONEY_WAYS.map((w) => [w, make()])) as Record<MoneyWay, T>;
}

/** The book's figures in fils: each way in and out, the cash at the end, the months. */
export function moneyBookTotals(book: Pick<MoneyBook, 'cashStartFils' | 'rows'>): MoneyBookTotals {
  const ways = byWay(() => ({ ...inOut(), count: 0 }));
  const months = new Map<string, MoneyMonth>();
  const all = inOut();
  for (const r of book.rows) {
    const side = r.type === 'Income' ? 'inFils' : 'outFils';
    ways[r.way][side] += r.amountFils;
    ways[r.way].count++;
    const key = r.date.slice(0, 7);
    let m = months.get(key);
    if (!m) months.set(key, (m = { month: key, ways: byWay(inOut), ...inOut() }));
    m.ways[r.way][side] += r.amountFils;
    if (r.way === 'credit') continue;
    m[side] += r.amountFils;
    all[side] += r.amountFils;
  }
  return {
    ways,
    cashEndFils: book.cashStartFils + ways.cash.inFils - ways.cash.outFils,
    ...all,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/* ---------------- The look ---------------- */

const NAVY = '1F3864';
const INK = '1F2937';
const NOTE_INK = '4B5563';
const GREY = '6B7280';
const TILE = 'EEF2F8';
const ZEBRA = 'F7F9FC';
const LINE = 'E3E7ED';
const GREEN = '1E7B34';
const GREEN_FILL = 'E3F4E7';
const RED = 'B3261E';
const RED_FILL = 'FBE7E5';
const ORANGE = 'B45F06';
/** The chart's bars: a shade brighter than the words. */
const BAR_IN = '3A9A5B';
const BAR_OUT = 'D0533F';

const MONEY = '#,##0.00';
/** Nothing in a month's cell is a dash, not 0.00. */
const MONEY_DASH = '#,##0.00;-#,##0.00;"–"';
/** DD/MM/YYYY whatever the computer's own separator (a "/" bare in a format is the locale's). */
const DATE = 'dd\\/mm\\/yyyy';
const MONTH = 'mmm yyyy';
const COUNT = '#,##0';

const WAY: Record<MoneyWay, { sheet: string; payment: string; title: string; color: string; fill: string; tab: string; note?: string }> = {
  cash: { sheet: 'Cash', payment: 'Cash', title: 'Cash', color: '1F6F8B', fill: 'E4F1F6', tab: '1F6F8B' },
  card: { sheet: 'Card', payment: 'Card', title: 'Card', color: '3949AB', fill: 'E8EAF6', tab: '3949AB', note: 'Card operations only: the card has no balance here.' },
  transfer: { sheet: 'Transfer', payment: 'Transfer', title: 'Bank transfer', color: '7B3FA0', fill: 'F1E8F7', tab: '7B3FA0', note: 'Bank transfers only: no balance here.' },
  owner: { sheet: 'Owner', payment: 'Owner', title: 'Owner — past the cash box', color: '5F6B7A', fill: 'EDEFF2', tab: '8A94A3', note: 'Paid by the owner from his own money, or taken by the owner: in no cash balance.' },
  credit: {
    sheet: 'Credit',
    payment: 'Credit',
    title: 'On credit',
    color: ORANGE,
    fill: 'FDEFD9',
    tab: 'E69138',
    note: 'Expenses taken on credit — no money moved, in no balance or total. Each payment of one is a row of the way it was paid.',
  },
};

const aed = (fils: number) => Math.round(fils) / 100;
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** How many characters a sum takes as #,##0.00 shows it (a column wide enough: no "####"). */
function moneyChars(fils: number): number {
  const whole = String(Math.floor(Math.abs(fils) / 100));
  return whole.length + Math.floor((whole.length - 1) / 3) + 3 + (fils < 0 ? 1 : 0);
}
/** Column i at least as wide as `chars` characters of a font `scale` times the sheet's (and a little air). */
function fit(cols: number[], i: number, chars: number, scale = 1, max = 80) {
  cols[i] = Math.min(max, Math.max(cols[i] ?? 10, Math.ceil(chars * scale) + 3));
}

const HEAD: XStyle = { bold: true, color: 'FFFFFF', fill: NAVY, valign: 'center' };
const ALIGN = { l: 'left', c: 'center', r: 'right' } as const;
type Align = keyof typeof ALIGN;
/** The head row of a table with a filter: each title standing as its column's figures do, clear of the filter's button. */
const headRow = (titles: string[], align: Align[]): XCell[] =>
  titles.map((v, i) => ({ v, s: { ...HEAD, align: ALIGN[align[i]], ...(align[i] === 'c' ? {} : { indent: align[i] === 'r' ? 2 : 1 }) } }));
/** A head title's column: the title, its filter's button and some air. */
const fitHead = (cols: number[], titles: string[]) => titles.forEach((h, i) => fit(cols, i, h.length + 4, 1.1));

/** A table's cell: in the middle of its row, a hairline under it, every other row lightly filled (its own fill wins). */
const td = (i: number, s: XStyle = {}): XStyle => ({ valign: 'center', bottom: LINE, ...(i % 2 ? { fill: ZEBRA } : {}), ...s });
const DATE_S: XStyle = { fmt: DATE, align: 'center' };
const TEXT_S: XStyle = { color: INK, indent: 1 };
const NOTE_S: XStyle = { color: NOTE_INK, indent: 1 };
const money = (color: string, fmt = MONEY): XStyle => ({ fmt, align: 'right', indent: 1, color });
const typeS = (t: MoneyType): XStyle => (t === 'Income' ? { color: GREEN, fill: GREEN_FILL, align: 'center' } : { color: RED, fill: RED_FILL, align: 'center' });
/** The way of a row: its colour; past the cash box and on credit — on its own light fill too. */
const wayS = (w: MoneyWay): XStyle => ({ color: WAY[w].color, align: 'center', ...(w === 'owner' || w === 'credit' ? { fill: WAY[w].fill } : {}) });
const TOTAL: XStyle = { bold: true, top: NAVY, fill: TILE, valign: 'center' };

/* ---------------- The band over a table ---------------- */

interface Tile {
  label: string;
  /** A sum (fils) or a count. */
  fils?: number;
  count?: number;
  f?: string;
  color: string;
}

const HEAD_ROW = 7;
const FIRST = HEAD_ROW + 1;

/**
 * Rows 1–6 of a sheet: its title, the garage · the period · the day exported, the tiles (a label over each figure — the
 * label row is where "Cash Start" is looked for, its value right under it), a short note. The head row is row 7.
 */
function band(title: string, color: string, sub: string, tiles: Tile[], note: string | undefined, cols: number[]): { rows: XCell[][]; heights: Record<number, number>; merges: string[] } {
  const width = cols.length;
  const last = colName(width - 1);
  const label: XStyle = { size: 9, color: GREY, fill: TILE, valign: 'bottom', indent: 1 };
  const figure = (t?: Tile): XStyle => ({ bold: true, size: 12, color: t?.color ?? INK, fill: TILE, valign: 'center', align: 'left', indent: 1, ...(t ? { fmt: t.fils !== undefined ? MONEY : COUNT } : {}) });
  tiles.forEach((t, i) => {
    fit(cols, i, t.label.length, 0.95);
    fit(cols, i, t.fils !== undefined ? moneyChars(t.fils) : String(t.count ?? 0).length, 1.35);
  });
  const rows: XCell[][] = [
    [{ v: title, s: { bold: true, size: 16, color, valign: 'center' } }],
    [{ v: sub, s: { size: 10, color: GREY, valign: 'center' } }],
    [],
    Array.from({ length: width }, (_, i) => (tiles[i] ? { v: tiles[i].label, s: label } : { s: label })),
    Array.from({ length: width }, (_, i): XCell => {
      const t = tiles[i];
      if (!t) return { s: figure() };
      const v = t.fils !== undefined ? aed(t.fils) : (t.count ?? 0);
      return t.f ? { f: t.f, v, s: figure(t) } : { v, s: figure(t) };
    }),
    note ? [{ v: note, s: { size: 9, italic: true, color: GREY, valign: 'center' } }] : [],
  ];
  return {
    rows,
    heights: { 1: 30, 2: 18, 3: 8, 4: 18, 5: 28, 6: note ? 20 : 10, [HEAD_ROW]: 24 },
    merges: [`A1:${last}1`, `A2:${last}2`, ...(note ? [`A6:${last}6`] : [])],
  };
}

/* ---------------- Transactions ---------------- */

function transactions(book: MoneyBook, tot: MoneyBookTotals, sub: string): XSheet {
  const n = book.rows.length;
  const last = Math.max(FIRST, HEAD_ROW + n);
  const range = (c: string) => `$${c}$${FIRST}:$${c}$${last}`;
  const sumifs = (type: MoneyType | undefined, pay: string) => `ROUND(SUMIFS(${range('C')},${type ? `${range('B')},"${type}",` : ''}${range('D')},"${pay}"),2)`;
  const cols = [13, 12, 15, 12, 20, 15, 44];
  const tiles: Tile[] = [
    { label: 'Cash Start', fils: book.cashStartFils, color: NAVY },
    { label: 'Cash In', fils: tot.ways.cash.inFils, f: sumifs('Income', 'Cash'), color: GREEN },
    { label: 'Cash Out', fils: tot.ways.cash.outFils, f: sumifs('Expense', 'Cash'), color: RED },
    { label: 'Cash Balance', fils: tot.cashEndFils, f: 'ROUND(A5+B5-C5,2)', color: NAVY },
    { label: 'Total In', fils: tot.inFils, f: sumifs('Income', '<>Credit'), color: GREEN },
    { label: 'Total Out', fils: tot.outFils, f: sumifs('Expense', '<>Credit'), color: RED },
    { label: 'On Credit', fils: tot.ways.credit.inFils + tot.ways.credit.outFils, f: sumifs(undefined, 'Credit'), color: ORANGE },
  ];
  let cash = book.cashStartFils;
  const body = book.rows.map((r, i): XCell[] => {
    const row = FIRST + i;
    const upTo = (c: string) => `$${c}$${FIRST}:$${c}${row}`;
    let balance: XCell = { s: td(i) };
    if (r.way === 'cash') {
      cash += r.type === 'Income' ? r.amountFils : -r.amountFils;
      const f = `ROUND($A$5+SUMIFS(${upTo('C')},${upTo('B')},"Income",${upTo('D')},"Cash")-SUMIFS(${upTo('C')},${upTo('B')},"Expense",${upTo('D')},"Cash"),2)`;
      balance = { f, v: aed(cash), s: td(i, money(NAVY)) };
      fit(cols, 5, moneyChars(cash), 1.05);
    }
    fit(cols, 2, moneyChars(r.amountFils), 1.05);
    fit(cols, 4, r.category.length, 1, 34);
    fit(cols, 6, r.notes.length, 0.95, 72);
    return [
      { date: r.date, s: td(i, DATE_S) },
      { v: r.type, s: td(i, typeS(r.type)) },
      { v: aed(r.amountFils), s: td(i, money(r.way === 'credit' ? ORANGE : r.type === 'Income' ? GREEN : RED)) },
      { v: WAY[r.way].payment, s: td(i, wayS(r.way)) },
      { v: r.category, s: td(i, TEXT_S) },
      balance,
      { v: r.notes, s: td(i, NOTE_S) },
    ];
  });
  const titles = ['Date', 'Type', 'Amount (AED)', 'Payment', 'Category', 'Cash Balance', 'Notes'];
  fitHead(cols, titles);
  const b = band(
    book.garage ? `${book.garage} · Money Tracker` : 'Money Tracker',
    NAVY,
    `All operations · ${sub}`,
    tiles,
    'Total In / Out — cash, card, transfer and the owner’s. On Credit — no money moved: in no balance or total.',
    cols,
  );
  const heights = { ...b.heights };
  body.forEach((_, i) => (heights[FIRST + i] = 21));
  return {
    name: 'Transactions',
    rows: [...b.rows, headRow(titles, ['c', 'c', 'r', 'c', 'l', 'r', 'l']), ...body],
    heights,
    merges: b.merges,
    cols,
    freeze: HEAD_ROW,
    filter: `A${HEAD_ROW}:G${HEAD_ROW + n}`,
    printRows: `$${HEAD_ROW}:$${HEAD_ROW}`,
    landscape: true,
    tab: NAVY,
    // The cash after each row sums the column down to it — on purpose.
    ...(n ? { partialRanges: `F${FIRST}:F${HEAD_ROW + n}` } : {}),
  };
}

/* ---------------- A sheet per way ---------------- */

interface Col {
  head: string;
  align: Align;
  width: number;
  cell: (r: MoneyBookRow, i: number, row: number) => XCell;
  /** A sum (fils) — the Total row counts it again under a filter, in this colour. */
  total?: { fils: number; color: string };
  /** The widest a cell of it is, in characters (its width follows). */
  chars?: (r: MoneyBookRow) => number;
  max?: number;
}

function waySheet(w: MoneyWay, rows: MoneyBookRow[], book: MoneyBook, sub: string): XSheet {
  const meta = WAY[w];
  const n = rows.length;
  const last = FIRST + n - 1;
  const t = moneyBookTotals({ cashStartFils: book.cashStartFils, rows }).ways[w];
  const col = (c: number) => colName(c);
  const sumOf = (c: number) => `ROUND(SUM(${col(c)}${FIRST}:${col(c)}${last}),2)`;
  const count = { label: 'Operations', count: n, f: `COUNT(A${FIRST}:A${last})`, color: INK };
  const date: Col = { head: 'Date', align: 'c', width: 13, cell: (r, i) => ({ date: r.date, s: td(i, DATE_S) }) };
  const type: Col = { head: 'Type', align: 'c', width: 12, cell: (r, i) => ({ v: r.type, s: td(i, typeS(r.type)) }) };
  const category: Col = { head: 'Category', align: 'l', width: 20, cell: (r, i) => ({ v: r.category, s: td(i, TEXT_S) }), chars: (r) => r.category.length, max: 34 };
  const side = (head: string, income: boolean): Col => ({
    head,
    align: 'r',
    width: 14,
    total: { fils: income ? t.inFils : t.outFils, color: income ? GREEN : RED },
    cell: (r, i) => ((r.type === 'Income') === income ? { v: aed(r.amountFils), s: td(i, money(income ? GREEN : RED)) } : { s: td(i) }),
    chars: (r) => moneyChars(r.amountFils),
  });
  const notes = (text: (r: MoneyBookRow) => string = (r) => r.notes): Col => ({ head: 'Notes', align: 'l', width: 44, cell: (r, i) => ({ v: text(r), s: td(i, NOTE_S) }), chars: (r) => text(r).length * 0.95, max: 72 });

  let cols: Col[];
  let tiles: Tile[];
  if (w === 'credit') {
    // Whom it is owed to — a column of its own; the notes are the rest.
    const owed = (r: MoneyBookRow) => owedInNotes(r.notes);
    // What is still owed on each, when the book says (never more than it, never below 0); paid — the rest of it.
    const left = (r: MoneyBookRow) => (r.leftFils === undefined ? undefined : Math.min(r.amountFils, Math.max(0, r.leftFils)));
    const paid = (r: MoneyBookRow) => {
      const l = left(r);
      return l === undefined ? undefined : r.amountFils - l;
    };
    const known = rows.some((r) => r.leftFils !== undefined);
    const takenFils = t.inFils + t.outFils;
    const leftFils = rows.reduce((a, r) => a + (left(r) ?? 0), 0);
    const paidFils = rows.reduce((a, r) => a + (paid(r) ?? 0), 0);
    const part = (head: string, of: (r: MoneyBookRow) => number | undefined, fils: number, color: string): Col => ({
      head,
      align: 'r',
      width: 14,
      total: { fils, color },
      cell: (r, i) => {
        const x = of(r);
        return x === undefined ? { s: td(i) } : { v: aed(x), s: td(i, money(color, MONEY_DASH)) };
      },
    });
    cols = [
      date,
      category,
      { head: 'Owed to', align: 'l', width: 18, cell: (r, i) => ({ v: owed(r).name ?? '', s: td(i, { ...TEXT_S, color: ORANGE }) }), chars: (r) => (owed(r).name ?? '').length, max: 34 },
      {
        head: 'Amount (AED)',
        align: 'r',
        width: 15,
        total: { fils: takenFils, color: ORANGE },
        cell: (r, i) => ({ v: aed(r.amountFils), s: td(i, money(ORANGE)) }),
        chars: (r) => moneyChars(r.amountFils),
      },
      ...(known ? [part('Paid (AED)', paid, paidFils, GREEN), part('Left (AED)', left, leftFils, ORANGE)] : []),
      notes((r) => owed(r).rest),
    ];
    tiles = [
      { label: 'Taken on Credit', fils: takenFils, f: sumOf(3), color: ORANGE },
      ...(known ? [{ label: 'Paid Back', fils: paidFils, f: sumOf(4), color: GREEN }, { label: 'Still Owed', fils: leftFils, f: sumOf(5), color: ORANGE }] : []),
      count,
    ];
  } else {
    const inCol = side(w === 'owner' ? 'To Owner (AED)' : 'In (AED)', true);
    const outCol = side(w === 'owner' ? 'Paid by Owner (AED)' : 'Out (AED)', false);
    cols = [date, type, category, inCol, outCol];
    if (w === 'cash') {
      // The cash after each row, from the opening in A5: what the cash box held then.
      let cash = book.cashStartFils;
      const after = rows.map((r) => (cash += r.type === 'Income' ? r.amountFils : -r.amountFils));
      cols.push({
        head: 'Balance (AED)',
        align: 'r',
        width: 15,
        cell: (_, i, row) => ({ f: `ROUND($A$5+SUM($D$${FIRST}:D${row})-SUM($E$${FIRST}:E${row}),2)`, v: aed(after[i]), s: td(i, money(NAVY)) }),
        chars: () => Math.max(...after.map(moneyChars)),
      });
      tiles = [
        { label: 'Opening', fils: book.cashStartFils, color: NAVY },
        { label: 'Cash In', fils: t.inFils, f: sumOf(3), color: GREEN },
        { label: 'Cash Out', fils: t.outFils, f: sumOf(4), color: RED },
        { label: 'Balance', fils: book.cashStartFils + t.inFils - t.outFils, f: 'ROUND(A5+B5-C5,2)', color: NAVY },
        count,
      ];
    } else if (w === 'owner') {
      tiles = [{ label: 'Received by Owner', fils: t.inFils, f: sumOf(3), color: GREEN }, { label: 'Paid by Owner', fils: t.outFils, f: sumOf(4), color: RED }, count];
    } else {
      const net = t.inFils - t.outFils;
      tiles = [
        { label: `${meta.sheet} In`, fils: t.inFils, f: sumOf(3), color: GREEN },
        { label: `${meta.sheet} Out`, fils: t.outFils, f: sumOf(4), color: RED },
        { label: 'Net', fils: net, f: 'ROUND(A5-B5,2)', color: net < 0 ? RED : NAVY },
        count,
      ];
    }
    cols.push(notes());
  }

  const widths = cols.map((c) => c.width);
  fitHead(
    widths,
    cols.map((c) => c.head),
  );
  cols.forEach((c, ci) => {
    if (c.chars) for (const r of rows) fit(widths, ci, c.chars(r), 1.05, c.max ?? 40);
  });
  const body = rows.map((r, i) => cols.map((c) => c.cell(r, i, FIRST + i)));
  // The Total row: the count and the sums of what a filter leaves.
  const totalRow = cols.map((c, ci): XCell => {
    if (ci === 0) return { f: `"Total · "&SUBTOTAL(103,A${FIRST}:A${last})`, v: `Total · ${n}`, s: { ...TOTAL, indent: 1 } };
    if (!c.total) return { s: TOTAL };
    return { f: `ROUND(SUBTOTAL(109,${col(ci)}${FIRST}:${col(ci)}${last}),2)`, v: aed(c.total.fils), s: { ...TOTAL, ...money(c.total.color), bold: true } };
  });
  const b = band(meta.title, meta.color, sub, tiles, meta.note, widths);
  const heights: Record<number, number> = { ...b.heights, [last + 1]: 24 };
  body.forEach((_, i) => (heights[FIRST + i] = 21));
  const lastCol = col(cols.length - 1);
  return {
    name: meta.sheet,
    rows: [...b.rows, headRow(cols.map((c) => c.head), cols.map((c) => c.align)), ...body, totalRow],
    heights,
    merges: b.merges,
    cols: widths,
    freeze: HEAD_ROW,
    filter: `A${HEAD_ROW}:${lastCol}${last}`,
    printRows: `$${HEAD_ROW}:$${HEAD_ROW}`,
    landscape: true,
    tab: meta.tab,
    ...(w === 'cash' ? { partialRanges: `F${FIRST}:F${last}` } : {}),
  };
}

/* ---------------- By month ---------------- */

function byMonth(book: MoneyBook, tot: MoneyBookTotals, sub: string): XSheet {
  const T = sheetRef('Transactions');
  const lastTx = Math.max(FIRST, HEAD_ROW + book.rows.length);
  const tx = (c: string) => `${T}!$${c}$${FIRST}:$${c}$${lastTx}`;
  const ways = MONEY_WAYS.filter((w) => w !== 'credit' && tot.ways[w].count > 0);
  const credit = tot.ways.credit.count > 0;
  const months = tot.months;
  const top = 6;
  const bottom = top + months.length - 1;
  const totalAt = top + months.length;

  // Columns: Month · each way In, Out · Credit · Total In, Out, Net.
  const wayCol = (k: number) => 1 + k * 2;
  const creditCol = 1 + ways.length * 2;
  const inCol = creditCol + (credit ? 1 : 0);
  const [outCol, netCol] = [inCol + 1, inCol + 2];
  const width = netCol + 1;
  const cols = Array.from({ length: width }, () => 14);
  const L = (c: number) => colName(c);

  // Two head rows: the way over its In and Out (its own colour), then In / Out on its light fill.
  const g = (fill: string): XStyle => ({ bold: true, color: 'FFFFFF', fill, align: 'center', valign: 'center' });
  const s = (color: string, fill: string): XStyle => ({ bold: true, color, fill, align: 'right', indent: 1, valign: 'center', bottom: LINE });
  const group: XCell[] = Array.from({ length: width }, () => ({ s: HEAD }));
  const heads: XCell[] = Array.from({ length: width }, () => ({ s: HEAD }));
  group[0] = { v: 'Month', s: { ...HEAD, align: 'left', indent: 1 } };
  const merges = ['A4:A5'];
  ways.forEach((w, k) => {
    const c = wayCol(k);
    group[c] = { v: WAY[w].sheet, s: g(WAY[w].color) };
    group[c + 1] = { s: g(WAY[w].color) };
    merges.push(`${L(c)}4:${L(c + 1)}4`);
    heads[c] = { v: 'In', s: s(WAY[w].color, WAY[w].fill) };
    heads[c + 1] = { v: 'Out', s: s(WAY[w].color, WAY[w].fill) };
  });
  if (credit) {
    group[creditCol] = { v: 'Credit', s: g(WAY.credit.color) };
    heads[creditCol] = { v: 'Taken', s: s(ORANGE, WAY.credit.fill) };
  }
  group[inCol] = { v: 'Total', s: g(NAVY) };
  group[outCol] = { s: g(NAVY) };
  group[netCol] = { s: g(NAVY) };
  merges.push(`${L(inCol)}4:${L(netCol)}4`);
  heads[inCol] = { v: 'In', s: s(GREEN, TILE) };
  heads[outCol] = { v: 'Out', s: s(RED, TILE) };
  heads[netCol] = { v: 'Net', s: s(NAVY, TILE) };

  // A month's sum over the Transactions: its type and way, its days.
  const inMonth = (row: number) => `${tx('A')},">="&$A${row},${tx('A')},"<"&DATE(YEAR($A${row}),MONTH($A${row})+1,1)`;
  const sumifs = (row: number, pay: string, type?: MoneyType) => `ROUND(SUMIFS(${tx('C')},${type ? `${tx('B')},"${type}",` : ''}${tx('D')},"${pay}",${inMonth(row)}),2)`;
  const body = months.map((m, i): XCell[] => {
    const row = top + i;
    const cells: XCell[] = [{ date: `${m.month}-01`, s: td(i, { fmt: MONTH, align: 'left', indent: 1, color: INK, bold: true }) }];
    ways.forEach((w, k) => {
      const c = wayCol(k);
      cells[c] = { f: sumifs(row, WAY[w].payment, 'Income'), v: aed(m.ways[w].inFils), s: td(i, money(INK, MONEY_DASH)) };
      cells[c + 1] = { f: sumifs(row, WAY[w].payment, 'Expense'), v: aed(m.ways[w].outFils), s: td(i, money(INK, MONEY_DASH)) };
      fit(cols, c, moneyChars(m.ways[w].inFils), 1.05);
      fit(cols, c + 1, moneyChars(m.ways[w].outFils), 1.05);
    });
    if (credit) cells[creditCol] = { f: sumifs(row, 'Credit'), v: aed(m.ways.credit.inFils + m.ways.credit.outFils), s: td(i, money(ORANGE, MONEY_DASH)) };
    const net = m.inFils - m.outFils;
    const ins = ways.map((_, k) => `${L(wayCol(k))}${row}`);
    const outs = ways.map((_, k) => `${L(wayCol(k) + 1)}${row}`);
    cells[inCol] = { f: ins.length ? `ROUND(${ins.join('+')},2)` : '0', v: aed(m.inFils), s: td(i, { ...money(GREEN, MONEY_DASH), bold: true }) };
    cells[outCol] = { f: outs.length ? `ROUND(${outs.join('+')},2)` : '0', v: aed(m.outFils), s: td(i, { ...money(RED, MONEY_DASH), bold: true }) };
    cells[netCol] = { f: `ROUND(${L(inCol)}${row}-${L(outCol)}${row},2)`, v: aed(net), s: td(i, { ...money(net < 0 ? RED : NAVY, MONEY_DASH), bold: true }) };
    for (const c of [inCol, outCol, netCol]) fit(cols, c, moneyChars(c === netCol ? net : c === inCol ? m.inFils : m.outFils), 1.1);
    return cells;
  });

  // The Total row: the sums of the months.
  const sumCol = (c: number, fils: number, color: string): XCell => ({
    f: months.length ? `ROUND(SUM(${L(c)}${top}:${L(c)}${bottom}),2)` : '0',
    v: aed(fils),
    s: { ...TOTAL, ...money(color, MONEY_DASH), bold: true },
  });
  const total: XCell[] = [{ v: 'Total', s: { ...TOTAL, indent: 1 } }];
  ways.forEach((w, k) => {
    total[wayCol(k)] = sumCol(wayCol(k), tot.ways[w].inFils, INK);
    total[wayCol(k) + 1] = sumCol(wayCol(k) + 1, tot.ways[w].outFils, INK);
  });
  if (credit) total[creditCol] = sumCol(creditCol, tot.ways.credit.inFils + tot.ways.credit.outFils, ORANGE);
  total[inCol] = sumCol(inCol, tot.inFils, GREEN);
  total[outCol] = sumCol(outCol, tot.outFils, RED);
  total[netCol] = sumCol(netCol, tot.inFils - tot.outFils, tot.inFils - tot.outFils < 0 ? RED : NAVY);
  for (const [c, fils] of [[inCol, tot.inFils], [outCol, tot.outFils], [netCol, tot.inFils - tot.outFils]] as const) fit(cols, c, moneyChars(fils), 1.1);
  ways.forEach((w, k) => {
    fit(cols, wayCol(k), moneyChars(tot.ways[w].inFils), 1.1);
    fit(cols, wayCol(k) + 1, moneyChars(tot.ways[w].outFils), 1.1);
  });
  if (credit) fit(cols, creditCol, moneyChars(tot.ways.credit.inFils + tot.ways.credit.outFils), 1.1);

  const lastCol = L(width - 1);
  const heights: Record<number, number> = { 1: 30, 2: 18, 3: 8, 4: 22, 5: 20, [totalAt]: 24 };
  body.forEach((_, i) => (heights[top + i] = 21));
  const BM = sheetRef('By month');
  // Money in against money out, month by month: one chart, the bars side by side (one scale for both).
  const charts: XChart[] = months.length
    ? [
        {
          type: 'column',
          title: 'Money in and out by month, AED',
          cats: { ref: `${BM}!$A$${top}:$A$${bottom}`, values: months.map((m) => daySerial(`${m.month}-01`)), fmt: MONTH },
          values: { ref: `${BM}!$${L(inCol)}$${top}:$${L(inCol)}$${bottom}`, values: months.map((m) => aed(m.inFils)), name: 'In' },
          color: BAR_IN,
          more: [{ ref: `${BM}!$${L(outCol)}$${top}:$${L(outCol)}$${bottom}`, values: months.map((m) => aed(m.outFils)), name: 'Out', color: BAR_OUT }],
          noLabels: months.length > 6,
          from: [0, totalAt + 1],
          to: [Math.max(width, 8), totalAt + 22],
        },
      ]
    : [];
  return {
    name: 'By month',
    rows: [
      [{ v: 'By month', s: { bold: true, size: 16, color: NAVY, valign: 'center' } }],
      [{ v: `${book.garage ? `${book.garage} · ` : ''}Money Tracker · ${sub}`, s: { size: 10, color: GREY, valign: 'center' } }],
      [],
      group,
      heads,
      ...body,
      total,
    ],
    heights,
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`, ...merges],
    cols,
    freeze: 5,
    printRows: '$4:$5',
    landscape: true,
    tab: '44546A',
    charts,
  };
}

/* ---------------- The workbook ---------------- */

/** The money book's workbook (.xlsx bytes): Transactions, a sheet per way that has rows, By month. */
export function buildMoneyBook(book: MoneyBook): Uint8Array {
  const tot = moneyBookTotals(book);
  const days = book.rows.map((r) => r.date).sort();
  const period = days.length ? (days[0] === days[days.length - 1] ? dmy(days[0]) : `${dmy(days[0])} – ${dmy(days[days.length - 1])}`) : 'No operations yet';
  const sub = `${period} · ${book.rows.length} operation${book.rows.length === 1 ? '' : 's'} · Exported ${dmy(book.today)}`;
  const garage = book.garage ? `${book.garage} · ` : '';
  const sheets: XSheet[] = [transactions(book, tot, sub)];
  for (const w of MONEY_WAYS) {
    const rows = book.rows.filter((r) => r.way === w);
    if (rows.length) sheets.push(waySheet(w, rows, book, `${garage}Money Tracker · ${sub}`));
  }
  sheets.push(byMonth(book, tot, sub));
  return buildWorkbook(sheets, { title: `${garage}Money Tracker`, author: book.garage || undefined });
}
