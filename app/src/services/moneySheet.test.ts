import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { buildMoneyWorkbook, excelSerial, fromExcelSerial, readMoneyWorkbook, sheetBalances, type MoneySheet } from '../domain/moneySheet';
import { unzip } from '../domain/zip';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { addExpense } from './money';
import { importMoneyPlan, moneySheetOfBook, planMoneyImport } from './moneySheet';
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
    expect(new TextDecoder().decode(files.get('xl/tables/table1.xml'))).toContain('ref="A6:H1508" displayName="MoneyLog"');

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
