import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { buildMoneyWorkbook, excelSerial, fromExcelSerial, readMoneyWorkbook, sheetBalances, type MoneySheet } from '../domain/moneySheet';
import { unzip } from '../domain/zip';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { payCredit } from './debts';
import { addExpense, closeCashDay } from './money';
import { exportMoneySheet, importMoneyPlan, moneySheetOfBook, planMoneyImport } from './moneySheet';
import { ensureSeed } from './seed';

const cat = async (code: string) => (await db.expenseCategories.where('code').equals(code).first())!.id;

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

// The first rows of the garage's own sheet (10–11 July), as the manager typed them.
const SHEET: MoneySheet = {
  cashStartFils: 8500,
  cardStartFils: 0,
  rows: [
    { date: '2026-07-08', type: 'Income', amountFils: 20000, payment: 'Cash', category: 'Repair Labor', notes: 'Toyota Hiace alternator change' },
    { date: '2026-07-08', type: 'Expense', amountFils: 1300, payment: 'Card', category: 'Tools & Equipment', notes: 'cottons for garage' },
    { date: '2026-07-08', type: 'Income', amountFils: 115000, payment: 'Card', category: 'Repair Labor', notes: 'for mitsubishi lancer 14124' },
    { date: '2026-07-09', type: 'Income', amountFils: 1000, payment: 'Cash', category: 'Sales', notes: 'fw40' },
    { date: '2026-07-09', type: 'Expense', amountFils: 28000, payment: 'Cash', category: 'Parts Purchases', notes: 'alternator used original' },
    { date: '2026-07-09', type: 'Expense', amountFils: 1000, payment: 'Cash', category: 'Groceries', notes: 'food' },
  ],
};

describe('the money sheet and day closings (v0.23.1)', () => {
  it('a day closing’s difference does not take the row that explains it; the difference rows the app wrote are left out', async () => {
    await setOpeningBalances(100_000, 0);
    // The day was counted 20 short: a parts purchase never typed.
    await closeCashDay(98_000, 'short 20');
    const today = (await loadLedger()).entries.find((e) => e.source === 'closing')!.date;
    const sheet: MoneySheet = {
      cashStartFils: 100_000,
      cardStartFils: 0,
      rows: [
        { date: today, type: 'Expense', amountFils: 2_000, payment: 'Cash', category: 'Parts Purchases', notes: 'bolts' },
        { date: today, type: 'Expense', amountFils: 2_000, payment: 'Cash', category: 'Other', notes: 'Day closing difference' },
      ],
    };
    const plan = await planMoneyImport(buildMoneyWorkbook(sheet));
    expect(plan.rows.map((r) => r.notes)).toEqual(['bolts']);
    expect(plan.existing).toBe(1);
  });
});

describe('the money sheet (Money Tracker workbook)', () => {
  it('is written as the original workbook and read back as it was', async () => {
    expect(excelSerial('2026-07-08')).toBe(46211);
    expect(fromExcelSerial(46211)).toBe('2026-07-08');
    const b = sheetBalances(SHEET);
    expect(b.cash.map((x) => x / 100)).toEqual([285, 285, 285, 295, 15, 5]);
    expect(b.card.map((x) => x / 100)).toEqual([0, 0, 1150, 1150, 1150, 1150]);
    expect([b.cashIn, b.cashOut, b.cardIn, b.cardOut].map((x) => x / 100)).toEqual([210, 290, 1150, 13]);

    const bytes = buildMoneyWorkbook(SHEET);
    const files = await unzip(bytes);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['xl/worksheets/sheet1.xml', 'xl/tables/table1.xml', 'xl/styles.xml', 'xl/comments1.xml']));
    const sheet = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
    expect(sheet).toContain('<pane ySplit="6.0" topLeftCell="A7" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<c r="B4" s="6"><f>ROUND(A4+C4-D4,2)</f><v>5</v></c>');
    expect(sheet).toContain('<c r="F12" s="14"><f t="shared" si="1"/><v>5</v></c>');
    // The card has no balance (v0.17): its totals in and out only, no start, no running column; the notes in G.
    const strings = new TextDecoder().decode(files.get('xl/sharedStrings.xml'));
    expect(strings).not.toMatch(/Card Start|Card Balance/);
    expect(strings).toContain('<t>Card In</t>');
    expect(sheet).toMatch(/<c r="E4" s="7"><f>ROUND\(SUMIFS[^<]*Income[^<]*Card[^<]*\)<\/f><v>1150<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="F4" s="7"><f>[^<]*Expense[^<]*Card[^<]*<\/f><v>13<\/v><\/c><\/row>/);
    expect(sheet).not.toMatch(/<c r="H\d+"/);
    expect(sheet).toMatch(/<c r="G7" s="16" t="s">/);
    const table = new TextDecoder().decode(files.get('xl/tables/table1.xml'));
    expect(table).toContain('ref="A6:G1508" displayName="MoneyLog"');
    expect(table).toContain('<tableColumns count="7">');
    expect(new TextDecoder().decode(files.get('xl/comments1.xml')).match(/<comment /g)).toHaveLength(1);
    expect(new TextDecoder().decode(files.get('xl/drawings/vmlDrawing1.vml')).match(/<v:shape /g)).toHaveLength(1);

    const back = await readMoneyWorkbook(bytes);
    expect(back.rows).toEqual(SHEET.rows);
    expect([back.cashStartFils, back.cardStartFils, back.skipped]).toEqual([8500, 0, 0]);
  });

  it('takes the book out and back in without doubling anything', async () => {
    await setOpeningBalances(8500, 0);
    await addIncome({ date: '2026-07-10', category: 'service', amountFils: 20000, method: 'cash', note: 'Toyota Hiace alternator change' });
    await addExpense({ date: '2026-07-10', categoryId: await cat('tools'), amountFils: 1300, vatFils: 0, method: 'card', note: 'cottons for garage' });
    await addIncome({ date: '2026-07-11', category: 'sales', amountFils: 1000, method: 'cash', note: 'fw40' });
    const sheet = await moneySheetOfBook();
    expect(sheet.rows.map((r) => [r.type, r.payment, r.category, r.amountFils])).toEqual([
      ['Income', 'Cash', 'Repair Labor', 20000],
      ['Expense', 'Card', 'Tools & Equipment', 1300],
      ['Income', 'Cash', 'Sales', 1000],
    ]);
    const plan = await planMoneyImport(buildMoneyWorkbook(sheet));
    expect([plan.rows.length, plan.existing, plan.opening]).toEqual([0, 3, false]);
  });

  it('fills an empty book from the sheet, once', async () => {
    const plan = await planMoneyImport(buildMoneyWorkbook(SHEET));
    expect([plan.incomes, plan.expenses, plan.existing, plan.opening]).toEqual([3, 3, 0, true]);
    expect(await importMoneyPlan(plan)).toBe(6);
    const book = await loadLedger();
    expect([book.cash, book.card, book.cashStartFils]).toEqual([500, 115000, 8500]);
    const food = (await db.expenses.toArray()).find((e) => e.amountFils === 1000)!;
    expect(food.note).toBe('Groceries: food');
    expect((await planMoneyImport(buildMoneyWorkbook(SHEET))).rows).toHaveLength(0);
  });
});

describe('the money sheet and the credits (v0.61, the user: «тот, кто заплатил в долг, должен отображаться… в таблице при экспорте»)', () => {
  it('a credit is a row «Credit» naming whom it is owed to, in no balance; out and back in, nothing doubles; a typed one comes in owed to that person', async () => {
    await setOpeningBalances(10_000, 0);
    await addExpense({ date: '2026-11-10', categoryId: await cat('parts'), amountFils: 30_000, vatFils: 0, vendor: 'Al Noor Auto', method: 'credit', note: 'pads', owedTo: { kind: 'new', name: 'Ahmed' } });
    await addExpense({ date: '2026-11-11', categoryId: await cat('parts'), amountFils: 2_000, vatFils: 0, method: 'cash', note: 'bolts' });
    const sheet = await moneySheetOfBook();
    expect(sheet.rows.map((r) => [r.payment, r.amountFils, r.notes])).toEqual([
      ['Credit', 30_000, 'Owed to Ahmed — Al Noor Auto · pads'],
      ['Cash', 2_000, 'bolts'],
    ]);
    // In no balance and no total: the cash after the credit is the start, the cash out — the bolts only.
    const b = sheetBalances(sheet);
    expect([b.cash, b.cashOut, b.cardOut]).toEqual([[10_000, 8_000], 2_000, 0]);
    const bytes = buildMoneyWorkbook(sheet);
    const xml = new TextDecoder().decode((await unzip(bytes)).get('xl/worksheets/sheet1.xml'));
    expect(xml).toContain('<c r="F7" s="14" t="str"><f t="shared" ref="F7:F');
    expect((await readMoneyWorkbook(bytes)).rows.map((r) => r.payment)).toEqual(['Credit', 'Cash']);
    expect((await planMoneyImport(bytes)).rows).toHaveLength(0);

    // Typed into the sheet by hand: a credit to Ahmed again (the same man), and one to a new one.
    const typed: MoneySheet = {
      cashStartFils: 10_000,
      cardStartFils: 0,
      rows: [
        { date: '2026-11-12', type: 'Expense', amountFils: 4_000, payment: 'Credit', category: 'Parts Purchases', notes: 'Owed to ahmed — oil' },
        { date: '2026-11-12', type: 'Expense', amountFils: 6_000, payment: 'Credit', category: 'Parts Purchases', notes: 'Owed to Rashid' },
      ],
    };
    expect(await importMoneyPlan(await planMoneyImport(buildMoneyWorkbook(typed)))).toBe(2);
    const lenders = await db.lenders.toArray();
    expect(lenders.map((l) => l.name).sort()).toEqual(['Ahmed', 'Rashid']);
    const oil = (await db.expenses.toArray()).find((e) => e.amountFils === 4_000)!;
    expect([oil.method, oil.note, lenders.find((l) => l.id === oil.lenderId)?.name]).toEqual(['credit', 'oil', 'Ahmed']);
  });
});

describe('the export by ways (the owner: «журнал по листам — общий и по способу: карта, перевод, в кредит»)', () => {
  it('Transactions holds the whole book and reads back as it; a sheet per way — the transfer apart from the card; the credit with what is left; imports as nothing new', async () => {
    await setOpeningBalances(10_000, 0);
    await addIncome({ date: '2026-11-10', category: 'service', amountFils: 50_000, method: 'cash', note: 'alternator' });
    await addIncome({ date: '2026-11-10', category: 'service', amountFils: 120_000, method: 'transfer', note: 'fleet' });
    await addExpense({ date: '2026-11-11', categoryId: await cat('tools'), amountFils: 1_500, vatFils: 0, method: 'card', note: 'gloves' });
    const credit = await addExpense({ date: '2026-11-11', categoryId: await cat('parts'), amountFils: 30_000, vatFils: 0, vendor: 'Al Noor Auto', method: 'credit', note: 'pads', owedTo: { kind: 'new', name: 'Ahmed' } });
    await payCredit(credit.id, { amountFils: 10_000, method: 'cash', date: '2026-11-12' });

    const file = await exportMoneySheet();
    expect(file.name).toMatch(/^Money Tracker — \d{4}-\d{2}-\d{2}\.xlsx$/);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const back = await readMoneyWorkbook(bytes);
    expect(back.rows).toEqual((await moneySheetOfBook()).rows);
    expect(back.rows.map((r) => r.payment)).toEqual(['Cash', 'Card', 'Card', 'Credit', 'Cash']);
    expect(back.cashStartFils).toBe(10_000);

    const files = await unzip(bytes);
    const dec = new TextDecoder();
    const names = [...dec.decode(files.get('xl/workbook.xml')).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Transactions', 'Cash', 'Card', 'Transfer', 'Credit', 'By month']);
    const strings = dec.decode(files.get('xl/sharedStrings.xml'));
    expect(strings).toContain('<t>Transfer</t>');
    // The Credit sheet: taken 300, paid back 100, still owed 200.
    const creditSheet = dec.decode(files.get('xl/worksheets/sheet5.xml'));
    expect(['A5', 'B5', 'C5'].map((r) => new RegExp(`<c r="${r}"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]*)</v>`).exec(creditSheet)?.[1])).toEqual(['300', '100', '200']);
    // Out and back in: nothing new.
    const plan = await planMoneyImport(bytes);
    expect([plan.rows.length, plan.existing, plan.skipped]).toEqual([0, 5, 0]);
  });
});
