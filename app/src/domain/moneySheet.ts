import { COMMENTS, CONTENTTYPES, DRAWING, ROOTRELS, SHEETRELS, STYLES, THEME, VML, WORKBOOK, WORKBOOKRELS } from './moneySheetTemplate';
import { unzip, zipStore } from './zip';

/*
 * The money sheet — the garage's "Money Tracker — Income & Expenses" workbook (one sheet,
 * "Transactions"): opening cash and card at A4 / E4, the totals beside them, and the MoneyLog table
 * from row 6 — Date · Type (Income / Expense) · Amount (AED, always positive) · Payment (Cash / Card) ·
 * Category · Cash Balance · Card Balance · Notes. Card money spent does not reduce either balance.
 *
 * Export writes it exactly as the original (its styles, formulas, lists, colouring and notes), with the
 * balances already worked out so a phone's preview shows them; import reads such a workbook back.
 */

export type MoneyType = 'Income' | 'Expense';
export type MoneyPayment = 'Cash' | 'Card';

export interface MoneyRow {
  date: string; // YYYY-MM-DD
  type: MoneyType;
  amountFils: number;
  payment: MoneyPayment;
  category: string;
  notes: string;
}

export interface MoneySheet {
  cashStartFils: number;
  cardStartFils: number;
  rows: MoneyRow[];
}

/** The Category list of the sheet (its drop-down). */
export const SHEET_CATEGORIES = [
  'Salary', 'Side Income', 'Sales', 'Refund', 'Transfer', 'Groceries', 'Transport', 'Housing', 'Phone & Internet', 'Health',
  'Shopping', 'Other', 'Repair Labor', 'Diagnostics', 'Parts Sales', 'Customer Deposit', 'Parts Purchases', 'Workshop Supplies',
  'Tools & Equipment', 'Outsourced Work', 'Staff Wages', 'Workshop Rent', 'Workshop Utilities', 'Towing & Delivery',
];

const DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);
/** Excel's day number of a date (as Excel counts: 46211 = 8 Jul 2026). */
export const excelSerial = (date: string) => Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - EPOCH) / DAY);
export const fromExcelSerial = (n: number) => new Date(EPOCH + Math.floor(n) * DAY).toISOString().slice(0, 10);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const aed = (fils: number) => String(Math.round(fils) / 100);

const TITLE = 'Money Tracker';
const HINT = 'Enter one transaction per row. Always enter a positive amount.';
const LABELS = ['Cash Start', 'Cash Balance', 'Cash In', 'Cash Out', 'Card Start', 'Card Balance', 'Card In', 'Card Out'];
const NOTE = 'Enter opening balances in A4 and E4. Card expenses are tracked separately and do not reduce either balance.';
const HEADERS = ['Date', 'Type', 'Amount (AED)', 'Payment', 'Category', 'Cash Balance', 'Card Balance', 'Notes'];
const COLS = 'ABCDEFGH';

const SHEET_HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mx="http://schemas.microsoft.com/office/mac/excel/2008/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:mv="urn:schemas-microsoft-com:mac:vml" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetPr><pageSetUpPr/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="6.0" topLeftCell="A7" activePane="bottomLeft" state="frozen"/><selection activeCell="B8" sqref="B8" pane="bottomLeft"/></sheetView></sheetViews><sheetFormatPr customHeight="1" defaultColWidth="12.63" defaultRowHeight="15.0"/><cols><col customWidth="1" min="1" max="1" width="23.0"/><col customWidth="1" min="2" max="2" width="17.0"/><col customWidth="1" min="3" max="3" width="18.63"/><col customWidth="1" min="4" max="4" width="14.88"/><col customWidth="1" min="5" max="5" width="23.13"/><col customWidth="1" min="6" max="7" width="18.0"/><col customWidth="1" min="8" max="8" width="62.5"/><col customWidth="1" min="9" max="27" width="8.63"/></cols><sheetData>';

const Q = '&quot;';
const sumifs = (last: number, type: MoneyType, pay: MoneyPayment) =>
  `ROUND(SUMIFS($C$7:$C${last},$B$7:$B${last},${Q}${type}${Q},$D$7:$D${last},${Q}${pay}${Q},$C$7:$C${last},${Q}&gt;0${Q}),2)`;
const running = (start: string, inner: string) =>
  `IF(AND(ISNUMBER(INDEX($C:$C,ROW())),INDEX($C:$C,ROW())&gt;0,OR(INDEX($B:$B,ROW())=${Q}Income${Q},INDEX($B:$B,ROW())=${Q}Expense${Q}),OR(INDEX($D:$D,ROW())=${Q}Cash${Q},INDEX($D:$D,ROW())=${Q}Card${Q})),ROUND(${start}+${inner},2),${Q}${Q})`;
const runSum = (type: MoneyType, pay: MoneyPayment) =>
  `SUMIFS($C$7:INDEX($C:$C,ROW()),$B$7:INDEX($B:$B,ROW()),${Q}${type}${Q},$D$7:INDEX($D:$D,ROW()),${Q}${pay}${Q},$C$7:INDEX($C:$C,ROW()),${Q}&gt;0${Q})`;
const RUNNING_CASH = running('$A$4', `${runSum('Income', 'Cash')}-${runSum('Expense', 'Cash')}`);
const RUNNING_CARD = running('$E$4', runSum('Income', 'Card'));

const CATEGORY_LIST =
  `${Q}Salary,Side Income,Sales,Refund,Transfer,Groceries,Transport,Housing,Phone &amp; Internet,Health,Shopping,Other,Repair Labor,Diagnostics,Parts Sales,Customer Deposit,Parts Purchases,Workshop Supplies,Tools &amp; Equipment,Outsourced Work,Staff Wages,Workshop Rent${Q}&amp;${Q},Workshop Utilities,Towing &amp; Delivery${Q}`;

const sheetTail = (last: number) =>
  `</sheetData><conditionalFormatting sqref="B7:B${last}"><cfRule type="expression" dxfId="5" priority="1" stopIfTrue="1"><formula>$B7=${Q}Income${Q}</formula></cfRule></conditionalFormatting>` +
  `<conditionalFormatting sqref="B7:B${last}"><cfRule type="expression" dxfId="6" priority="2" stopIfTrue="1"><formula>$B7=${Q}Expense${Q}</formula></cfRule></conditionalFormatting>` +
  `<conditionalFormatting sqref="C7:C${last}"><cfRule type="expression" dxfId="7" priority="3" stopIfTrue="1"><formula>AND($C7&lt;&gt;${Q}${Q},OR(NOT(ISNUMBER($C7)),$C7&lt;=0))</formula></cfRule></conditionalFormatting>` +
  `<dataValidations><dataValidation type="custom" allowBlank="1" showDropDown="1" showInputMessage="1" showErrorMessage="1" prompt="Enter the transaction date." sqref="A7:A${last}"><formula1>OR(NOT(ISERROR(DATEVALUE(A7))), AND(ISNUMBER(A7), LEFT(CELL(${Q}format${Q}, A7))=${Q}D${Q}))</formula1></dataValidation>` +
  `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="B7:B${last}"><formula1>${Q}Income,Expense${Q}</formula1></dataValidation>` +
  `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="E7:E${last}"><formula1>${CATEGORY_LIST}</formula1></dataValidation>` +
  `<dataValidation type="decimal" operator="greaterThan" allowBlank="1" showDropDown="1" showInputMessage="1" showErrorMessage="1" prompt="Enter an amount greater than zero. The transaction type determines whether it is added or subtracted." sqref="C7:C${last}"><formula1>0.0</formula1></dataValidation>` +
  `<dataValidation type="list" allowBlank="1" sqref="D7:D${last}"><formula1>${Q}Card,Cash${Q}</formula1></dataValidation></dataValidations>` +
  `<printOptions/><pageMargins bottom="0.75" footer="0.0" header="0.0" left="0.7" right="0.7" top="0.75"/><pageSetup orientation="landscape"/><drawing r:id="rId2"/><legacyDrawing r:id="rId3"/><tableParts count="1"><tablePart r:id="rId5"/></tableParts></worksheet>`;

const tableXml = (last: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ref="A6:H${last}" displayName="MoneyLog" name="MoneyLog" id="1"><tableColumns count="8">` +
  HEADERS.map((h, i) => `<tableColumn name="${h}" id="${i + 1}"/>`).join('') +
  `</tableColumns><tableStyleInfo name="Transactions-style" showColumnStripes="0" showFirstColumn="1" showLastColumn="1" showRowStripes="1"/></table>`;

/** Balances as the sheet counts them: cash in − cash out from the cash start; card in only on the card. */
export function sheetBalances(sheet: MoneySheet): { cash: number[]; card: number[]; cashIn: number; cashOut: number; cardIn: number; cardOut: number } {
  let cash = sheet.cashStartFils;
  let card = sheet.cardStartFils;
  let cashIn = 0;
  let cashOut = 0;
  let cardIn = 0;
  let cardOut = 0;
  const cashAfter: number[] = [];
  const cardAfter: number[] = [];
  for (const r of sheet.rows) {
    if (r.payment === 'Cash' && r.type === 'Income') {
      cash += r.amountFils;
      cashIn += r.amountFils;
    } else if (r.payment === 'Cash') {
      cash -= r.amountFils;
      cashOut += r.amountFils;
    } else if (r.type === 'Income') {
      card += r.amountFils;
      cardIn += r.amountFils;
    } else cardOut += r.amountFils;
    cashAfter.push(cash);
    cardAfter.push(card);
  }
  return { cash: cashAfter, card: cardAfter, cashIn, cashOut, cardIn, cardOut };
}

/** The workbook (.xlsx bytes) of these entries, oldest first, in the money sheet's own format. */
export function buildMoneyWorkbook(sheet: MoneySheet): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const s = (value: string) => {
    if (!index.has(value)) {
      index.set(value, strings.length);
      strings.push(value);
    }
    return index.get(value)!;
  };
  const last = Math.max(1508, sheet.rows.length + 6 + 300);
  const b = sheetBalances(sheet);
  const str = (ref: string, style: number, value: string) => `<c r="${ref}" s="${style}" t="s"><v>${s(value)}</v></c>`;
  const blanks = (row: number, style: number) => [...COLS.slice(1)].map((c) => `<c r="${c}${row}" s="${style}"/>`).join('');
  const rows: string[] = [];
  rows.push(`<row r="1" ht="27.75" customHeight="1">${str('A1', 1, TITLE)}${blanks(1, 2)}</row>`);
  rows.push(`<row r="2" ht="21.75" customHeight="1">${str('A2', 3, HINT)}${blanks(2, 2)}</row>`);
  rows.push(`<row r="3" ht="21.75" customHeight="1">${LABELS.map((l, i) => str(`${COLS[i]}3`, 4, l)).join('')}</row>`);
  const cashBal = sheet.cashStartFils + b.cashIn - b.cashOut;
  const cardBal = sheet.cardStartFils + b.cardIn;
  rows.push(
    `<row r="4" ht="21.75" customHeight="1"><c r="A4" s="5"><v>${aed(sheet.cashStartFils)}</v></c>` +
      `<c r="B4" s="6"><f>ROUND(A4+C4-D4,2)</f><v>${aed(cashBal)}</v></c>` +
      `<c r="C4" s="7"><f>${sumifs(last, 'Income', 'Cash')}</f><v>${aed(b.cashIn)}</v></c>` +
      `<c r="D4" s="7"><f>${sumifs(last, 'Expense', 'Cash')}</f><v>${aed(b.cashOut)}</v></c>` +
      (sheet.cardStartFils ? `<c r="E4" s="8"><v>${aed(sheet.cardStartFils)}</v></c>` : '<c r="E4" s="8"/>') +
      `<c r="F4" s="6"><f>ROUND(E4+G4,2)</f><v>${aed(cardBal)}</v></c>` +
      `<c r="G4" s="7"><f>${sumifs(last, 'Income', 'Card')}</f><v>${aed(b.cardIn)}</v></c>` +
      `<c r="H4" s="7"><f>${sumifs(last, 'Expense', 'Card')}</f><v>${aed(b.cardOut)}</v></c></row>`,
  );
  rows.push(`<row r="5" ht="57.75" customHeight="1">${str('A5', 3, NOTE)}${blanks(5, 2)}</row>`);
  rows.push(`<row r="6" ht="21.75" customHeight="1">${HEADERS.map((h, i) => str(`${COLS[i]}6`, i === 6 ? 10 : 9, h)).join('')}</row>`);
  // The running balances are one shared formula each, defined on row 7 (as in the original).
  const fCash = (r: number) => (r === 7 ? `<f t="shared" ref="F7:F${last}" si="1">${RUNNING_CASH}</f>` : '<f t="shared" si="1"/>');
  const fCard = (r: number) => (r === 7 ? `<f t="shared" ref="G7:G${last}" si="2">${RUNNING_CARD}</f>` : '<f t="shared" si="2"/>');
  sheet.rows.forEach((row, i) => {
    const r = 7 + i;
    rows.push(
      `<row r="${r}" ht="21.75" customHeight="1"><c r="A${r}" s="11"><v>${excelSerial(row.date)}</v></c>${str(`B${r}`, 12, row.type)}` +
        `<c r="C${r}" s="13"><v>${aed(row.amountFils)}</v></c>${str(`D${r}`, 12, row.payment)}${str(`E${r}`, 12, row.category)}` +
        `<c r="F${r}" s="14">${fCash(r)}<v>${aed(b.cash[i])}</v></c><c r="G${r}" s="15">${fCard(r)}<v>${aed(b.card[i])}</v></c>` +
        (row.notes ? str(`H${r}`, 16, row.notes) : `<c r="H${r}" s="17"/>`) +
        '</row>',
    );
  });
  for (let r = 7 + sheet.rows.length; r <= last; r++) {
    rows.push(
      `<row r="${r}" ht="21.75" customHeight="1"><c r="A${r}" s="18"/><c r="B${r}" s="19"/><c r="C${r}" s="20"/><c r="D${r}" s="19"/><c r="E${r}" s="19"/>` +
        `<c r="F${r}" s="14" t="str">${fCash(r)}<v></v></c><c r="G${r}" s="15" t="str">${fCard(r)}<v></v></c><c r="H${r}" s="17"/></row>`,
    );
  }
  const sst =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((v) => `<si><t${/^\s|\s$/.test(v) ? ' xml:space="preserve"' : ''}>${esc(v)}</t></si>`).join('') +
    '</sst>';
  const enc = new TextEncoder();
  const f = (name: string, content: string) => ({ name, data: enc.encode(content) });
  return zipStore([
    f('[Content_Types].xml', CONTENTTYPES),
    f('_rels/.rels', ROOTRELS),
    f('xl/workbook.xml', WORKBOOK),
    f('xl/_rels/workbook.xml.rels', WORKBOOKRELS),
    f('xl/styles.xml', STYLES),
    f('xl/theme/theme1.xml', THEME),
    f('xl/sharedStrings.xml', sst),
    f('xl/worksheets/sheet1.xml', SHEET_HEAD + rows.join('') + sheetTail(last)),
    f('xl/worksheets/_rels/sheet1.xml.rels', SHEETRELS),
    f('xl/tables/table1.xml', tableXml(last)),
    f('xl/comments1.xml', COMMENTS),
    f('xl/drawings/drawing1.xml', DRAWING),
    f('xl/drawings/vmlDrawing1.vml', VML),
  ]);
}

/* ---------------- Reading a workbook back ---------------- */

const unesc = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');

/** Shared strings: a string may be rich text (several runs). */
function readStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(''));
}

type Cell = string | number | undefined;
const colIndex = (ref: string) => [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The rows of a sheet as arrays of values (strings resolved, formulas by their last value). */
function readCells(xml: string, strings: string[]): Map<number, Cell[]> {
  const rows = new Map<number, Cell[]>();
  for (const r of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Cell[] = [];
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell;
      if (type === 's') value = v !== undefined ? strings[+v] : undefined;
      else if (type === 'inlineStr') value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join('');
      else if (type === 'str' || type === 'e' || type === 'b') value = v !== undefined && v !== '' ? unesc(v) : undefined;
      else value = v !== undefined && v !== '' ? Number(v) : undefined;
      cells[colIndex(ref)] = value;
    }
    rows.set(+r[1], cells);
  }
  return rows;
}

const text = (c: Cell) => (c === undefined ? '' : String(c).trim());
const money = (c: Cell): number | undefined => {
  if (typeof c === 'number') return Math.round(c * 100);
  const raw = text(c).replace(/[,\s]|AED/gi, '');
  const n = Number(raw);
  return raw && Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
function dateOf(c: Cell): string | undefined {
  if (typeof c === 'number' && c > 20000 && c < 80000) return fromExcelSerial(c);
  const s = text(c);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}
const typeOf = (c: Cell): MoneyType | undefined => {
  const s = text(c).toLowerCase();
  return /^(income|приход|доход)/.test(s) ? 'Income' : /^(expense|расход)/.test(s) ? 'Expense' : undefined;
};
const paymentOf = (c: Cell): MoneyPayment => (/^(card|bank|transfer|карта|перевод)/i.test(text(c)) ? 'Card' : 'Cash');

export interface ReadMoneySheet extends MoneySheet {
  /** Rows with something in them but no date, type or positive amount. */
  skipped: number;
}

/** A money sheet back from its workbook (the "Transactions" sheet, or the first one). */
export async function readMoneyWorkbook(bytes: Uint8Array): Promise<ReadMoneySheet> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const get = (name: string) => {
    const f = files.get(name);
    return f ? dec.decode(f) : undefined;
  };
  // Which file is the "Transactions" sheet (or the first sheet).
  const wb = get('xl/workbook.xml') ?? '';
  const rels = get('xl/_rels/workbook.xml.rels') ?? '';
  const sheets = [...wb.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: unesc(m[1]), rid: m[2] }));
  const pick = sheets.find((x) => x.name.toLowerCase() === 'transactions') ?? sheets[0];
  const rel = pick ? [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => a.includes(`Id="${pick.rid}"`)) : undefined;
  const target = rel ? /Target="([^"]+)"/.exec(rel)?.[1] : undefined;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const sheetXml = get(path) ?? get('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('no sheet');
  const cells = [...readCells(sheetXml, readStrings(get('xl/sharedStrings.xml')))].sort((a, b) => a[0] - b[0]);
  const byRow = new Map(cells);

  // The table's header row: where "Date", "Type" and "Amount…" stand.
  let head = -1;
  let col = { date: -1, type: -1, amount: -1, payment: -1, category: -1, notes: -1 };
  for (const [r, row] of cells) {
    const names = row.map((c) => text(c).toLowerCase());
    const at = (re: RegExp) => names.findIndex((n) => re.test(n));
    if (at(/^date$/) >= 0 && at(/^type$/) >= 0 && at(/^amount/) >= 0) {
      head = r;
      col = { date: at(/^date$/), type: at(/^type$/), amount: at(/^amount/), payment: at(/^payment/), category: at(/^category/), notes: at(/^notes?$/) };
      break;
    }
  }
  if (head < 0) throw new Error('no table');

  // Opening balances: the values under "Cash Start" / "Card Start".
  let cashStartFils = 0;
  let cardStartFils = 0;
  for (const [r, row] of cells) {
    if (r >= head) break;
    row.forEach((c, i) => {
      if (/^cash start$/i.test(text(c))) cashStartFils = money(byRow.get(r + 1)?.[i]) ?? 0;
      if (/^card start$/i.test(text(c))) cardStartFils = money(byRow.get(r + 1)?.[i]) ?? 0;
    });
  }

  const at = (row: Cell[], i: number) => (i >= 0 ? row[i] : undefined);
  const rows: MoneyRow[] = [];
  let skipped = 0;
  for (const [r, row] of cells) {
    if (r <= head) continue;
    const date = dateOf(at(row, col.date));
    const type = typeOf(at(row, col.type));
    const amountFils = money(at(row, col.amount));
    if (!date || !type || !amountFils || amountFils <= 0) {
      if (text(at(row, col.amount)) || text(at(row, col.type)) || text(at(row, col.notes))) skipped++;
      continue;
    }
    rows.push({ date, type, amountFils, payment: paymentOf(at(row, col.payment)), category: text(at(row, col.category)), notes: text(at(row, col.notes)) });
  }
  return { cashStartFils, cardStartFils, rows, skipped };
}
