import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { periodTotals } from '../domain/ledger';
import { buildMoneyWorkbook, readMoneyWorkbook, sheetBalances } from '../domain/moneySheet';
import { computeReport } from '../domain/reports';
import { addDebtPayment, loadCompanyDebts, loadDebtors } from './debts';
import { updateEntry } from './entries';
import { addItem } from './estimate';
import { approveAll, leaveOnDebt } from './flow';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { addExpense, addPayment, cashState, closeCashDay, quickInvoice } from './money';
import { importMoneyPlan, moneySheetOfBook, planMoneyImport } from './moneySheet';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

/*
 * v0.27 — the user: «в расходах добавить тип расхода … оплата не из кассы, это значит другими деньгами оплата. но это не
 * долг. иногда владелец за свои деньги оплачивает» and «иногда приходы от клиентов не попадают в кассу а сам владелец
 * получает». The way `outside`: an expense or money in all the same (the report, the job's profit), but no cash moves,
 * no card total, no debt.
 */

const cat = async (code: string) => (await db.expenseCategories.where('code').equals(code).first())!.id;
const signature = () => new Blob(['sig'], { type: 'image/png' });
const report = async () => {
  const [orders, invoices, items, expenses, payments, closings, incomes] = await Promise.all([
    db.orders.toArray(),
    db.invoices.toArray(),
    db.items.toArray(),
    db.expenses.toArray(),
    db.payments.toArray(),
    db.cashClosings.toArray(),
    db.incomes.toArray(),
  ]);
  return computeReport({ from: '2000-01-01', to: '2100-01-01', orders, invoices, items, expenses, payments, closings, incomes });
};
/** The cash as the book and the cash box count it — they always agree. */
const cash = async () => {
  const [book, box] = await Promise.all([loadLedger(), cashState()]);
  expect(book.cash).toBe(box.expected);
  return book.cash;
};

async function invoicedJob(aed: number) {
  const o = await checkIn({
    plate: { emirate: 'DXB', code: 'K', number: String(Math.floor(Math.random() * 90000) + 10000) },
    make: 'Toyota',
    model: 'Camry',
    name: 'Saeed',
    phone: '050 765 4321',
    docLanguage: 'en',
    complaint: '',
    arrivedNow: true,
  });
  await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Repair', unitPriceFils: aed * 100, vatRateBp: 0 });
  await approveAll(o.id);
  await quickInvoice(o.id);
  return o;
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  await setOpeningBalances(100_000, 0);
});

describe('money past the cash box (v0.27)', () => {
  it('an expense «Не из кассы» (the owner paid it): an expense, no cash moved, no debt; a line of its own purse in the book', async () => {
    const e = await addExpense({ date: dubaiDate(), categoryId: await cat('tools'), amountFils: 35_000, vatFils: 0, vendor: 'Ace', method: 'outside' });
    expect(await cash()).toBe(100_000);
    expect(await db.cashMovements.count()).toBe(0);
    expect(await loadCompanyDebts()).toEqual([]);
    const book = await loadLedger();
    const line = book.entries.find((x) => x.id === e.id)!;
    expect([line.purse, line.kind, line.amountFils, line.cashAfter, line.cardAfter]).toEqual(['outside', 'out', 35_000, 100_000, 0]);
    const month = periodTotals(book.entries, '2000-01-01', '2100-01-01');
    expect([month.cash.outFils, month.card.outFils, month.outside.outFils]).toEqual([0, 0, 35_000]);
    expect((await report()).expensesGross).toBe(35_000);
  });

  it('money in «Владельцу» (the owner took it): income, the cash and the card totals untouched', async () => {
    await addIncome({ category: 'emil', amountFils: 50_000, method: 'outside' });
    expect(await cash()).toBe(100_000);
    const book = await loadLedger();
    expect(book.entries.map((x) => [x.purse, x.kind, x.amountFils])).toEqual([['outside', 'in', 50_000]]);
    expect(book.card).toBe(0);
    expect((await report()).otherIncome).toBe(50_000);
  });

  it('a job paid to the owner: the job is paid, nothing in the cash, nothing in the day closing’s card or transfer', async () => {
    const o = await invoicedJob(400);
    await addPayment(o.id, { kind: 'payment', method: 'outside', amountFils: 40_000 });
    expect(await cash()).toBe(100_000);
    const closing = await closeCashDay(100_000);
    expect([closing.cardTotalFils, closing.transferTotalFils, closing.diffFils]).toEqual([0, 0, 0]);
    const r = await report();
    expect([r.payments.cash, r.payments.card, r.payments.transfer, r.payments.outside]).toEqual([0, 0, 0, 40_000]);
  });

  it('a customer’s debt paid to the owner: the debt is gone, the cash stays', async () => {
    const o = await invoicedJob(600);
    await leaveOnDebt(o.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    await addDebtPayment({ customerId: o.customerId, amountFils: 60_000, method: 'outside' });
    expect(await loadDebtors()).toEqual([]);
    expect((await db.orders.get(o.id))!.stage).toBe('closed');
    expect(await cash()).toBe(100_000);
  });

  it('changed in its sheet: cash → «Не из кассы» the cash comes back; and back to cash it leaves again', async () => {
    const e = await addExpense({ date: dubaiDate(), categoryId: await cat('parts'), amountFils: 18_000, vatFils: 0, method: 'cash' });
    expect(await cash()).toBe(82_000);
    await updateEntry({ source: 'expense', id: e.id }, { method: 'outside' });
    expect(await cash()).toBe(100_000);
    expect(await db.cashMovements.count()).toBe(0);
    expect((await loadLedger()).entries.find((x) => x.id === e.id)!.purse).toBe('outside');
    await updateEntry({ source: 'expense', id: e.id }, { method: 'cash' });
    expect(await cash()).toBe(82_000);
    // Money in the same way.
    const i = await addIncome({ category: 'sales', amountFils: 5_000, method: 'cash' });
    expect(await cash()).toBe(87_000);
    await updateEntry({ source: 'income', id: i.id }, { method: 'outside' });
    expect(await cash()).toBe(82_000);
  });

  it('the money sheet: Payment «Owner» — in no balance and no total; back in as it was, and not twice', async () => {
    await addExpense({ date: '2026-11-10', categoryId: await cat('tools'), amountFils: 35_000, vatFils: 0, method: 'outside' });
    await addIncome({ date: '2026-11-10', category: 'sales', amountFils: 2_000, method: 'cash' });
    await addIncome({ date: '2026-11-10', category: 'emil', amountFils: 50_000, method: 'outside' });
    const sheet = await moneySheetOfBook();
    expect(sheet.rows.map((r) => [r.type, r.payment, r.amountFils])).toEqual([
      ['Expense', 'Owner', 35_000],
      ['Income', 'Cash', 2_000],
      ['Income', 'Owner', 50_000],
    ]);
    const b = sheetBalances(sheet);
    expect([b.cash, b.cashIn, b.cashOut, b.cardIn, b.cardOut]).toEqual([[100_000, 102_000, 102_000], 2_000, 0, 0, 0]);
    const bytes = buildMoneyWorkbook(sheet);
    expect((await readMoneyWorkbook(bytes)).rows.map((r) => r.payment)).toEqual(['Owner', 'Cash', 'Owner']);
    // The same book: nothing new.
    expect((await planMoneyImport(bytes)).rows).toEqual([]);
    // Another book: the rows come in past the cash box, as they were.
    db.close();
    setDb(new GarageDB(`test-${uid()}`));
    await ensureSeed();
    await importMoneyPlan(await planMoneyImport(bytes));
    const [expenses, incomes] = await Promise.all([db.expenses.toArray(), db.incomes.toArray()]);
    expect(expenses.map((e) => [e.method, e.amountFils])).toEqual([['outside', 35_000]]);
    expect(incomes.map((i) => [i.method, i.amountFils]).sort((x, y) => Number(x[1]) - Number(y[1]))).toEqual([
      ['cash', 2_000],
      ['outside', 50_000],
    ]);
    expect(await db.cashMovements.count()).toBe(1);
  });
});
