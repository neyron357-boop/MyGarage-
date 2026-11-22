import { describe, expect, it } from 'vitest';
import { buildMoneyBook, moneyBookTotals, type MoneyBook, type MoneyBookRow } from './moneyBook';
import { readMoneyWorkbook } from './moneySheet';
import { unzip } from './zip';

// A small made-up book over two months: every way, a credit owed to a person, a day closing's difference.
const ROWS: MoneyBookRow[] = [
  { date: '2026-10-02', type: 'Income', amountFils: 45_000, way: 'cash', category: 'Repair Labor', notes: '#351 Toyota Camry' },
  { date: '2026-10-02', type: 'Expense', amountFils: 12_050, way: 'cash', category: 'Parts Purchases', notes: 'brake pads' },
  { date: '2026-10-05', type: 'Income', amountFils: 150_000, way: 'card', category: 'Repair Labor', notes: '#352 Nissan Patrol' },
  { date: '2026-10-06', type: 'Expense', amountFils: 2_500, way: 'card', category: 'Workshop Supplies', notes: 'gloves' },
  { date: '2026-10-09', type: 'Income', amountFils: 80_000, way: 'transfer', category: 'Repair Labor', notes: '#353 ACME fleet' },
  { date: '2026-10-12', type: 'Expense', amountFils: 30_000, way: 'credit', category: 'Parts Purchases', notes: 'Owed to Ahmed — Al Noor Auto · alternator', leftFils: 10_000 },
  { date: '2026-10-15', type: 'Expense', amountFils: 5_000, way: 'owner', category: 'Other', notes: 'paid by the owner' },
  { date: '2026-11-01', type: 'Income', amountFils: 7_000, way: 'owner', category: 'Repair Labor', notes: 'taken by the owner' },
  { date: '2026-11-03', type: 'Expense', amountFils: 20_000, way: 'cash', category: 'Other', notes: 'Credit paid to Ahmed: alternator' },
  { date: '2026-11-04', type: 'Expense', amountFils: 200, way: 'cash', category: 'Other', notes: 'Day closing difference' },
  { date: '2026-11-07', type: 'Expense', amountFils: 60_000, way: 'transfer', category: 'Workshop Rent', notes: '' },
];
const BOOK: MoneyBook = { garage: 'Test Garage', today: '2026-11-22', cashStartFils: 10_000, rows: ROWS };

const PAYMENT = { cash: 'Cash', card: 'Card', transfer: 'Card', owner: 'Owner', credit: 'Credit' } as const;

async function files(bytes: Uint8Array): Promise<Map<string, string>> {
  const raw = await unzip(bytes);
  const dec = new TextDecoder();
  return new Map([...raw].map(([k, v]) => [k, dec.decode(v)]));
}
const sheetNames = (wb: string) => [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
/** A cell's value as written (a formula's — the value worked out here). */
const valueAt = (xml: string, ref: string) => new RegExp(`<c r="${ref}"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]*)</v>`).exec(xml)?.[1];
const formulaAt = (xml: string, ref: string) =>
  new RegExp(`<c r="${ref}"[^>]*><f>([^<]*)</f>`)
    .exec(xml)?.[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

describe('the money book workbook (Transactions, a sheet per way, By month)', () => {
  it('the Transactions sheet reads back as the rows it was made of, with the cash start', async () => {
    const back = await readMoneyWorkbook(buildMoneyBook(BOOK));
    expect(back.rows).toEqual(ROWS.map((r) => ({ date: r.date, type: r.type, amountFils: r.amountFils, payment: PAYMENT[r.way], category: r.category, notes: r.notes })));
    expect([back.cashStartFils, back.cardStartFils, back.skipped]).toEqual([10_000, 0, 0]);
  });

  it('the figures in fils: each way in and out, the cash at the end, the months (credit in no total)', () => {
    const t = moneyBookTotals(BOOK);
    expect(t.ways.cash).toEqual({ inFils: 45_000, outFils: 32_250, count: 4 });
    expect(t.ways.card).toEqual({ inFils: 150_000, outFils: 2_500, count: 2 });
    expect(t.ways.transfer).toEqual({ inFils: 80_000, outFils: 60_000, count: 2 });
    expect(t.ways.owner).toEqual({ inFils: 7_000, outFils: 5_000, count: 2 });
    expect(t.ways.credit).toEqual({ inFils: 0, outFils: 30_000, count: 1 });
    expect(t.cashEndFils).toBe(10_000 + 45_000 - 32_250);
    expect([t.inFils, t.outFils]).toEqual([45_000 + 150_000 + 80_000 + 7_000, 32_250 + 2_500 + 60_000 + 5_000]);
    expect(t.months.map((m) => [m.month, m.inFils, m.outFils, m.ways.credit.outFils])).toEqual([
      ['2026-10', 275_000, 19_550, 30_000],
      ['2026-11', 7_000, 80_200, 0],
    ]);
  });

  it('sheets: Transactions first, a sheet per way that has rows, By month last; the tiles and the cash after each cash row', async () => {
    const f = await files(buildMoneyBook(BOOK));
    expect(sheetNames(f.get('xl/workbook.xml')!)).toEqual(['Transactions', 'Cash', 'Card', 'Transfer', 'Owner', 'Credit', 'By month']);
    const tx = f.get('xl/worksheets/sheet1.xml')!;
    // The tiles: Cash Start · Cash In · Cash Out · Cash Balance · Total In · Total Out · On Credit.
    expect(['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5'].map((r) => valueAt(tx, r))).toEqual(['100', '450', '322.5', '227.5', '2820', '997.5', '300']);
    expect(formulaAt(tx, 'D5')).toBe('ROUND(A5+B5-C5,2)');
    // The head row is row 7, frozen, with a filter over the table; nothing under it.
    expect(tx).toContain('<pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/>');
    expect(tx).toContain(`<autoFilter ref="A7:G${7 + ROWS.length}"/>`);
    expect(tx).not.toContain(`<row r="${8 + ROWS.length}"`);
    // Cash Balance: after each cash row (a formula with its value), empty on the others.
    expect(valueAt(tx, 'F8')).toBe('550');
    expect(valueAt(tx, 'F9')).toBe('429.5');
    expect(tx).toMatch(/<c r="F10" s="\d+"\/>/);
    expect(valueAt(tx, 'F16')).toBe('229.5');
    expect(valueAt(tx, 'F17')).toBe('227.5');
    expect(tx).toMatch(/<c r="F18" s="\d+"\/>/);
    const strings = f.get('xl/sharedStrings.xml')!;
    for (const w of ['Date', 'Type', 'Amount (AED)', 'Payment', 'Category', 'Cash Balance', 'Notes', 'Transfer', 'Owner', 'Credit', 'Cash Start']) expect(strings).toContain(`<t>${w}</t>`);
    expect(strings).toContain('Test Garage · Money Tracker');
    expect(strings).toContain('02/10/2026 – 07/11/2026 · 11 operations · Exported 22/11/2026');
  });

  it('the way sheets: their own In / Out columns and totals; the cash its balance; the credit whom it is owed to, paid and left', async () => {
    const f = await files(buildMoneyBook(BOOK));
    const cash = f.get('xl/worksheets/sheet2.xml')!;
    // Opening · Cash In · Cash Out · Balance · Operations
    expect(['A5', 'B5', 'C5', 'D5', 'E5'].map((r) => valueAt(cash, r))).toEqual(['100', '450', '322.5', '227.5', '4']);
    expect(formulaAt(cash, 'F8')).toBe('ROUND($A$5+SUM($D$8:D8)-SUM($E$8:E8),2)');
    expect(valueAt(cash, 'F11')).toBe('227.5');
    // The Total row: SUBTOTAL (a filter counts again).
    expect(formulaAt(cash, 'D12')).toBe('ROUND(SUBTOTAL(109,D8:D11),2)');
    expect([valueAt(cash, 'A12'), valueAt(cash, 'D12'), valueAt(cash, 'E12')]).toEqual(['Total · 4', '450', '322.5']);
    const card = f.get('xl/worksheets/sheet3.xml')!;
    expect(['A5', 'B5', 'C5', 'D5'].map((r) => valueAt(card, r))).toEqual(['1500', '25', '1475', '2']);
    const transfer = f.get('xl/worksheets/sheet4.xml')!;
    expect(['A5', 'B5', 'C5'].map((r) => valueAt(transfer, r))).toEqual(['800', '600', '200']);
    const owner = f.get('xl/worksheets/sheet5.xml')!;
    expect(['A5', 'B5', 'C5'].map((r) => valueAt(owner, r))).toEqual(['70', '50', '2']);
    const credit = f.get('xl/worksheets/sheet6.xml')!;
    // Taken on Credit · Paid Back · Still Owed · Operations; the row: Ahmed in «Owed to», the rest in Notes.
    expect(['A5', 'B5', 'C5', 'D5'].map((r) => valueAt(credit, r))).toEqual(['300', '200', '100', '1']);
    expect(['D8', 'E8', 'F8'].map((r) => valueAt(credit, r))).toEqual(['300', '200', '100']);
    const strings = [...f.get('xl/sharedStrings.xml')!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
    const at = (xml: string, ref: string) => strings[+valueAt(xml, ref)!];
    expect([at(credit, 'C8'), at(credit, 'G8')]).toEqual(['Ahmed', 'Al Noor Auto · alternator']);
  });

  it('By month: each way in and out by SUMIFS over the Transactions, the totals, a chart of in against out', async () => {
    const f = await files(buildMoneyBook(BOOK));
    const m = f.get('xl/worksheets/sheet7.xml')!;
    // Month · Cash In/Out · Card In/Out · Transfer In/Out · Owner In/Out · Credit · Total In · Total Out · Net
    expect(['B6', 'C6', 'D6', 'E6', 'F6', 'G6', 'H6', 'I6', 'J6', 'K6', 'L6', 'M6'].map((r) => valueAt(m, r))).toEqual(['450', '120.5', '1500', '25', '800', '0', '0', '50', '300', '2750', '195.5', '2554.5']);
    expect(['K7', 'L7', 'M7'].map((r) => valueAt(m, r))).toEqual(['70', '802', '-732']);
    expect(['K8', 'L8', 'M8'].map((r) => valueAt(m, r))).toEqual(['2820', '997.5', '1822.5']);
    expect(formulaAt(m, 'B6')).toBe('ROUND(SUMIFS(Transactions!$C$8:$C$18,Transactions!$B$8:$B$18,"Income",Transactions!$D$8:$D$18,"Cash",Transactions!$A$8:$A$18,">="&$A6,Transactions!$A$8:$A$18,"<"&DATE(YEAR($A6),MONTH($A6)+1,1)),2)');
    const chart = f.get('xl/charts/chart1.xml')!;
    expect(chart.match(/<c:ser>/g)).toHaveLength(2);
    expect(chart).toContain("<c:f>'By month'!$K$6:$K$7</c:f>");
    expect(chart).toContain("<c:f>'By month'!$L$6:$L$7</c:f>");
    expect(chart).toContain('<c:legend>');
  });

  it('only the ways that have rows get a sheet; an empty book is a sheet to fill', async () => {
    const two = await files(buildMoneyBook({ ...BOOK, rows: ROWS.filter((r) => r.way === 'cash' || r.way === 'credit') }));
    expect(sheetNames(two.get('xl/workbook.xml')!)).toEqual(['Transactions', 'Cash', 'Credit', 'By month']);
    const empty = buildMoneyBook({ garage: '', today: '2026-11-22', cashStartFils: 5_000, rows: [] });
    const f = await files(empty);
    expect(sheetNames(f.get('xl/workbook.xml')!)).toEqual(['Transactions', 'By month']);
    expect([...f.keys()].some((k) => k.startsWith('xl/charts/'))).toBe(false);
    const back = await readMoneyWorkbook(empty);
    expect([back.rows.length, back.cashStartFils, back.skipped]).toEqual([0, 5_000, 0]);
  });

  it('the styles: as many cell formats as listed; DD/MM/YYYY days, #,##0.00 sums; no sum in a cell too narrow for it', async () => {
    const f = await files(buildMoneyBook(BOOK));
    const styles = f.get('xl/styles.xml')!;
    const xfs = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(styles)!;
    expect(xfs[2].match(/<xf /g)).toHaveLength(+xfs[1]);
    for (const [list, item] of [['fonts', 'font'], ['fills', 'fill'], ['borders', 'border']]) {
      const m = new RegExp(`<${list} count="(\\d+)">([\\s\\S]*?)</${list}>`).exec(styles)!;
      expect(m[2].match(new RegExp(`<${item}>`, 'g'))).toHaveLength(+m[1]);
    }
    expect(styles).toContain('formatCode="dd\\/mm\\/yyyy"');
    expect(styles).toContain('numFmtId="4"');
    // Every s="n" of the sheets is a format that exists.
    for (const [k, xml] of f) if (k.startsWith('xl/worksheets/')) for (const s of xml.matchAll(/ s="(\d+)"/g)) expect(+s[1]).toBeLessThan(+xfs[1]);
    // A big sum widens its tile's column.
    const big = await files(buildMoneyBook({ ...BOOK, rows: [{ date: '2026-11-01', type: 'Income', amountFils: 123_456_789_00, way: 'cash', category: 'Sales', notes: '' }] }));
    const width = /<col min="2" max="2" width="(\d+)"/.exec(big.get('xl/worksheets/sheet1.xml')!)![1];
    expect(+width).toBeGreaterThanOrEqual(20);
  });
});
