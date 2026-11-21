import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { moved } from '../domain/ledger';
import { computeReport } from '../domain/reports';
import { addDebtPayment, companyDebtOf, debtPaymentHistory, loadCompanyDebts, loadCreditors, loadCustomerMonths, loadDebtJobs, loadDebtors, loadHistoryDebts, payCredit, paySupplier } from './debts';
import { customerAccount, customerStatement, loadDebtPayments } from './account';
import { statementOf } from '../domain/account';
import { removeEntry, restoreEntry } from './entries';
import { voidCreditPayment, voidExpense, voidIncome } from './legacyVoid';
import { addItem } from './estimate';
import { approveAll, leaveOnDebt } from './flow';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { addExpense, addPayment, cashState, createDebt, quickInvoice } from './money';
import { owedChoices, owedOf, setOwedTo, updateLender } from './lenders';
import { moneySheetOfBook } from './moneySheet';
import { bundleAmountDue, changeStage, checkIn, loadOrderBundle } from './orders';
import { ensureSeed } from './seed';

const signature = () => new Blob(['sig'], { type: 'image/png' });
const cat = async (code: string) => (await db.expenseCategories.where('code').equals(code).first())!.id;
const due = async (orderId: string) => bundleAmountDue((await loadOrderBundle(orderId))!);
const cash = async () => ({ book: (await loadLedger()).cash, box: (await cashState()).expected });

/** A job of `customerId` (a new customer when none) with one line of `aed` (no VAT), invoiced. */
async function invoicedJob(aed: number, customerId?: string) {
  const o = await checkIn({
    plate: { emirate: 'DXB', code: 'K', number: String(Math.floor(Math.random() * 90000) + 10000) },
    make: 'Toyota',
    model: 'Camry',
    customerId,
    name: customerId ? '' : 'Saeed',
    phone: customerId ? '' : '050 765 4321',
    docLanguage: 'en',
    complaint: '',
    arrivedNow: true,
  });
  await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Repair', unitPriceFils: aed * 100, vatRateBp: 0 });
  await approveAll(o.id);
  await quickInvoice(o.id);
  return o;
}

/**
 * The check before handing over (the task): one customer, two jobs gone with debts of 600 and 400 AED — one handed
 * over on credit, one closed with a signed debt.
 */
async function twoDebts() {
  await setOpeningBalances(100_000, 0);
  const a = await invoicedJob(600);
  await leaveOnDebt(a.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
  const b = await invoicedJob(400, a.customerId);
  await createDebt(b.id, 40_000, '2026-12-15', signature());
  await changeStage(b.id, 'closed');
  return { a, b, customerId: a.customerId };
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe("customers' debts", () => {
  it('one card per customer with both cars; a cash debt payment of 250: the cash +250, both places show 750', async () => {
    const { a, b, customerId } = await twoDebts();
    expect((await loadOrderBundle(b.id))!.order.stage).toBe('closed');
    let cards = await loadDebtors();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ totalFils: 100_000 });
    expect(cards[0].cars.map((c) => c.totalFils)).toEqual([60_000, 40_000]);

    const before = await cash();
    const { parts, restFils } = await addDebtPayment({ customerId, amountFils: 25_000, method: 'cash' });
    // The oldest debt first; nothing left over.
    expect({ parts, restFils }).toEqual({ parts: [{ orderId: a.id, amountFils: 25_000 }], restFils: 0 });
    const after = await cash();
    expect(after.book - before.book).toBe(25_000);
    expect(after.box - before.box).toBe(25_000);
    // One movement of money for the payment, one line of the book (the income, not the job's payment as well).
    expect((await db.cashMovements.filter((m) => m.reason === 'debt_payment').toArray()).length).toBe(1);
    expect((await loadLedger()).entries.filter((e) => e.source === 'payment' || e.category === 'debt').map((e) => [e.source, e.amountFils])).toEqual([['income', 25_000]]);
    // The board's "Debts" and "Money → Debts" read the same cards: 750 left, on the job itself too.
    cards = await loadDebtors();
    expect(cards[0].totalFils).toBe(75_000);
    expect(await due(a.id)).toBe(35_000);
    expect(await due(b.id)).toBe(40_000);
    // The job keeps the payment as its own (receipt, journal).
    const pay = (await loadOrderBundle(a.id))!.payments.find((p) => p.incomeId);
    expect(pay).toMatchObject({ amountFils: 25_000, method: 'cash', kind: 'payment' });
    expect(pay!.receiptNumber).toMatch(/^RC-/);
  });

  it('a job picked is paid first; paid in full it is closed and its debt paid — back in the archive', async () => {
    const { a, b, customerId } = await twoDebts();
    await addDebtPayment({ customerId, orderId: b.id, amountFils: 45_000, method: 'card' });
    expect(await due(b.id)).toBe(0);
    expect(await due(a.id)).toBe(55_000);
    const bb = (await loadOrderBundle(b.id))!;
    expect({ stage: bb.order.stage, debts: bb.debts.map((d) => d.status) }).toEqual({ stage: 'closed', debts: ['paid'] });
    // Paid: no longer a debt (the archive shows a closed job with nothing due).
    expect((await loadDebtJobs()).map((j) => j.order.id)).toEqual([a.id]);
    // The handed-over job paid off closes by itself.
    await addDebtPayment({ customerId, amountFils: 55_000, method: 'cash' });
    const aa = (await loadOrderBundle(a.id))!;
    expect({ stage: aa.order.stage, debts: aa.debts.map((d) => d.status) }).toEqual({ stage: 'closed', debts: ['paid'] });
    expect(await loadDebtors()).toEqual([]);
  });

  it('without a customer, or more than is owed: the rest is money in with no debt to it', async () => {
    const { a, b, customerId } = await twoDebts();
    const before = await cash();
    const free = await addDebtPayment({ amountFils: 10_000, method: 'cash', note: 'paid at the gate' });
    expect(free).toMatchObject({ parts: [], restFils: 10_000 });
    expect((await loadDebtors())[0].totalFils).toBe(100_000);
    const over = await addDebtPayment({ customerId, amountFils: 120_000, method: 'cash' });
    expect(over.parts).toEqual([
      { orderId: a.id, amountFils: 60_000 },
      { orderId: b.id, amountFils: 40_000 },
    ]);
    expect(over.restFils).toBe(20_000);
    expect(await loadDebtors()).toEqual([]);
    expect((await cash()).book - before.book).toBe(130_000);
    // The report counts what went to the jobs as their invoices' money; only what no debt took is income of its own.
    const [orders, invoices, items, expenses, payments, closings, incomes] = await Promise.all([db.orders.toArray(), db.invoices.toArray(), db.items.toArray(), db.expenses.toArray(), db.payments.toArray(), db.cashClosings.toArray(), db.incomes.toArray()]);
    const r = computeReport({ from: '2000-01-01', to: '2100-01-01', orders, invoices, items, expenses, payments, closings, incomes });
    expect(r.otherIncome).toBe(30_000);
    expect(r.payments.cash).toBe(100_000);
    // The money sheet: a debt payment is money for repairs, with its customer.
    const sheet = await moneySheetOfBook();
    expect(sheet.rows.filter((row) => row.notes.startsWith('Debt payment')).map((row) => [row.category, row.amountFils])).toEqual([
      ['Repair Labor', 10_000],
      ['Repair Labor', 120_000],
    ]);
  });

  it('a debt payment by mistake is cancelled: the cash goes back, the jobs owe again, the debts are open again', async () => {
    const { a, b, customerId } = await twoDebts();
    const before = await cash();
    const { income } = await addDebtPayment({ customerId, amountFils: 100_000, method: 'cash' });
    expect(await loadDebtors()).toEqual([]);
    await voidIncome(income.id);
    expect((await cash()).book).toBe(before.book);
    expect((await cash()).box).toBe(before.box);
    expect(await due(a.id)).toBe(60_000);
    expect(await due(b.id)).toBe(40_000);
    expect((await loadDebtors())[0].totalFils).toBe(100_000);
    expect((await loadOrderBundle(b.id))!.debts.map((d) => d.status)).toEqual(['open']);
    // The book has neither the payment nor its jobs' refunds as lines.
    expect((await loadLedger()).entries.some((e) => e.source === 'payment')).toBe(false);
  });

  it('a debt payment entered from the income sheet is the same thing', async () => {
    const { customerId } = await twoDebts();
    await addIncome({ category: 'debt', amountFils: 25_000, method: 'transfer', customerId });
    expect((await loadDebtors())[0].totalFils).toBe(75_000);
  });
});

describe('the garage on credit', () => {
  it('1 000 on credit: the cash stays, the garage owes 1 000; 300 paid in cash: the cash −300, 700 left', async () => {
    await setOpeningBalances(500_000, 0);
    const before = await cash();
    const e = await addExpense({ date: '2026-11-14', categoryId: await cat('parts'), amountFils: 100_000, vatFils: 0, vendor: 'Al Futtaim Parts', method: 'credit' });
    expect(await cash()).toEqual(before);
    // A line of the book all the same (v0.58), of its own purse: no balance moved, what is owed on it.
    expect((await loadLedger()).entries.find((x) => x.id === e.id)).toMatchObject({ source: 'expense', kind: 'out', purse: 'credit', method: 'credit', amountFils: 100_000, leftFils: 100_000 });
    expect((await loadCompanyDebts()).map((d) => [d.expense.id, d.leftFils])).toEqual([[e.id, 100_000]]);

    await payCredit(e.id, { amountFils: 30_000, method: 'cash' });
    const after = await cash();
    expect(before.book - after.book).toBe(30_000);
    expect(before.box - after.box).toBe(30_000);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(70_000);
    expect((await loadLedger()).entries.find((x) => x.id === e.id)!.leftFils).toBe(70_000);
    // The book: the payment, on its day and by its way; the cash box: its movement.
    const line = (await loadLedger()).entries.find((x) => x.source === 'credit')!;
    expect(line).toMatchObject({ kind: 'out', purse: 'cash', amountFils: 30_000, category: 'credit_payment', credit: { expenseId: e.id } });
    expect((await db.cashMovements.filter((m) => m.reason === 'credit_payment').toArray()).length).toBe(1);
    // The expense is counted once — 1 000, not 1 300.
    const [orders, invoices, items, expenses, payments, closings, incomes] = await Promise.all([db.orders.toArray(), db.invoices.toArray(), db.items.toArray(), db.expenses.toArray(), db.payments.toArray(), db.cashClosings.toArray(), db.incomes.toArray()]);
    expect(computeReport({ from: '2000-01-01', to: '2100-01-01', orders, invoices, items, expenses, payments, closings, incomes }).expensesGross).toBe(100_000);
    // The money sheet: the credit itself (v0.61: Payment «Credit», whom it is owed to — the seller, named once), and the
    // payment — the expense it pays off.
    expect((await moneySheetOfBook()).rows.map((r) => [r.type, r.payment, r.category, r.amountFils, r.notes])).toEqual([
      ['Expense', 'Credit', 'Parts Purchases', 100_000, 'Owed to Al Futtaim Parts'],
      ['Expense', 'Cash', 'Parts Purchases', 30_000, 'Credit paid to Al Futtaim Parts'],
    ]);

    // Not more than is left; paid off — no longer owed.
    await expect(payCredit(e.id, { amountFils: 80_000, method: 'card' })).rejects.toMatchObject({ code: 'err.creditOver' });
    await expect(voidExpense(e.id)).rejects.toMatchObject({ code: 'err.creditPaid' });
    await payCredit(e.id, { amountFils: 70_000, method: 'transfer' });
    expect(await loadCompanyDebts()).toEqual([]);
    expect((await loadLedger()).entries.find((x) => x.id === e.id)!.leftFils).toBe(0);
    expect((await cash()).book).toBe(after.book); // a transfer does not touch the cash
  });

  it('a payment of a credit by mistake is cancelled: the cash comes back, the debt is owed again', async () => {
    await setOpeningBalances(500_000, 0);
    const before = await cash();
    const e = await addExpense({ date: '2026-11-14', categoryId: await cat('parts'), amountFils: 100_000, vatFils: 0, method: 'credit' });
    const p = await payCredit(e.id, { amountFils: 30_000, method: 'cash' });
    await voidCreditPayment(p.id);
    expect(await cash()).toEqual(before);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(100_000);
    expect((await loadLedger()).entries.some((x) => x.source === 'credit')).toBe(false);
    // With nothing paid it can be cancelled itself.
    await voidExpense(e.id);
    expect(await loadCompanyDebts()).toEqual([]);
  });
});

describe('an expense paid in parts (v0.58, the user: «часть наличными, а часть в кредит остаётся»)', () => {
  it('150 — 100 in cash, the rest on credit: two expenses, the cash −100, 50 owed; the book, the sheet and the report agree', async () => {
    await setOpeningBalances(500_000, 0);
    const before = await cash();
    const receipt = new File([new Uint8Array(4000).fill(7)], 'r.jpg', { type: 'image/jpeg' });
    const first = await addExpense({
      date: dubaiDate(),
      categoryId: await cat('parts'),
      amountFils: 15_000,
      vatFils: 714,
      vendor: 'NAKASH',
      method: 'cash',
      note: 'BRAKES',
      receipt,
      parts: [
        { method: 'cash', amountFils: 10_000 },
        { method: 'credit', amountFils: 5_000 },
      ],
    });
    const parts = await db.expenses.where('date').equals(dubaiDate()).toArray();
    expect(parts.map((p) => [p.method, p.amountFils, p.vatFils, p.vendor, p.note, p.splitId]).sort()).toEqual([
      ['cash', 10_000, 476, 'NAKASH', 'BRAKES', first.id],
      ['credit', 5_000, 238, 'NAKASH', 'BRAKES', first.id],
    ]);
    // The receipt with each part (each an operation of its own).
    expect(parts.every((p) => !!p.receiptMediaId)).toBe(true);
    expect(await cash()).toEqual({ book: before.book - 10_000, box: before.box - 10_000 });
    const credit = parts.find((p) => p.method === 'credit')!;
    expect((await loadCompanyDebts()).map((d) => [d.expense.id, d.leftFils])).toEqual([[credit.id, 5_000]]);
    // The book: both lines; the day's sum — the money that moved.
    const lines = (await loadLedger()).entries.filter((e) => e.date === dubaiDate());
    expect(lines.map((e) => [e.purse, e.amountFils, e.leftFils]).sort()).toEqual([
      ['cash', 10_000, undefined],
      ['credit', 5_000, 5_000],
    ]);
    expect(lines.filter(moved).reduce((s, e) => s - e.amountFils, 0)).toBe(-10_000);
    // The money sheet: the money that moved, and the credit part (v0.61: «Credit» — in no balance); the report: the
    // whole purchase, once.
    expect((await moneySheetOfBook()).rows.map((r) => [r.payment, r.amountFils]).sort()).toEqual([
      ['Cash', 10_000],
      ['Credit', 5_000],
    ]);
    const [orders, invoices, items, expenses, payments, closings, incomes] = await Promise.all([db.orders.toArray(), db.invoices.toArray(), db.items.toArray(), db.expenses.toArray(), db.payments.toArray(), db.cashClosings.toArray(), db.incomes.toArray()]);
    expect(computeReport({ from: '2000-01-01', to: '2100-01-01', orders, invoices, items, expenses, payments, closings, incomes }).expensesGross).toBe(15_000);
    // A part is an operation of its own: deleted — the other stays.
    await removeEntry({ source: 'expense', id: first.id });
    expect((await db.expenses.toArray()).map((e) => e.id)).toEqual([credit.id]);
    expect(await cash()).toEqual(before);
  });

  it('parts that do not add up, or one way twice — refused, nothing written', async () => {
    const base = { date: dubaiDate(), categoryId: await cat('parts'), amountFils: 15_000, vatFils: 0, method: 'cash' as const };
    await expect(addExpense({ ...base, parts: [{ method: 'cash', amountFils: 10_000 }, { method: 'credit', amountFils: 4_000 }] })).rejects.toMatchObject({ code: 'err.partsSum' });
    await expect(addExpense({ ...base, parts: [{ method: 'cash', amountFils: 10_000 }, { method: 'cash', amountFils: 5_000 }] })).rejects.toMatchObject({ code: 'err.partsSum' });
    expect(await db.expenses.count()).toBe(0);
    expect(await db.cashMovements.count()).toBe(0);
  });
});

describe('the invoices from before the app among a customer\u2019s debts (v0.47)', () => {
  /** A company with two invoices from before the app (May 300, June 200) and a job of this app owing 600. */
  async function company() {
    await setOpeningBalances(100_000, 0);
    const job = await invoicedJob(600);
    await leaveOnDebt(job.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const customerId = job.customerId;
    const hist = (id: string, date: string, totalFils: number) => ({ id, customerId, vehicleId: job.vehicleId, orderId: undefined, template: 'B', numberKind: 'job', number: id, date, plateRaw: 'W 1', plate: 'W-1', vehicleText: 'Toyota Camry', lines: [], netFils: totalFils, vatFils: 0, totalFils, source: { file: 'x.pdf', sha256: 'x', page: 1 }, importedAt: '' });
    await db.historyInvoices.bulkPut([hist('hi-may', '2026-05-02', 30_000), hist('hi-jun', '2026-06-03', 20_000)] as never);
    return { job, customerId };
  }

  it('they are its debt, the oldest first: a debt payment of 400 pays May and half of June, not the job; deleted — owed again; «Отменить» — paid again', async () => {
    const { job, customerId } = await company();
    const card = async () => (await loadDebtors()).find((d) => d.customer.id === customerId)!;
    expect((await card()).totalFils).toBe(110_000);
    expect((await card()).history.map((m) => [m.month, m.dueFils])).toEqual([
      ['2026-05', 30_000],
      ['2026-06', 20_000],
    ]);
    const before = (await cash()).box;
    const { income, parts, historyParts, restFils } = await addDebtPayment({ amountFils: 40_000, method: 'cash', customerId });
    expect(parts).toEqual([]);
    expect(historyParts).toEqual([
      { invoiceId: 'hi-may', amountFils: 30_000 },
      { invoiceId: 'hi-jun', amountFils: 10_000 },
    ]);
    expect(restFils).toBe(0);
    // One movement of money, the whole sum; the job still owes all of it.
    expect((await cash()).box).toBe(before + 40_000);
    expect(await due(job.id)).toBe(60_000);
    expect((await card()).totalFils).toBe(70_000);
    expect((await card()).history.map((m) => [m.month, m.dueFils])).toEqual([['2026-06', 10_000]]);
    expect(await debtPaymentHistory(income.id)).toEqual([
      { month: '2026-05', invoices: 1, amountFils: 30_000 },
      { month: '2026-06', invoices: 1, amountFils: 10_000 },
    ]);
    // In the owner's report the part set against them is money in of its own (they were never revenue here).
    const [orders, invoices, items, expenses, payments, closings, incomes] = await Promise.all([db.orders.toArray(), db.invoices.toArray(), db.items.toArray(), db.expenses.toArray(), db.payments.toArray(), db.cashClosings.toArray(), db.incomes.toArray()]);
    expect(computeReport({ from: '2000-01-01', to: '2100-01-01', orders, invoices, items, expenses, payments, closings, incomes }).otherIncome).toBe(40_000);
    // The rest of a payment past them goes to the job.
    const second = await addDebtPayment({ amountFils: 30_000, method: 'card', customerId });
    expect(second.historyParts).toEqual([{ invoiceId: 'hi-jun', amountFils: 10_000 }]);
    expect(second.parts).toEqual([{ orderId: job.id, amountFils: 20_000 }]);
    expect((await card()).totalFils).toBe(40_000);
    // The first payment deleted: May and June owe again; brought back — paid again.
    const removed = await removeEntry({ source: 'income', id: income.id });
    expect((await card()).totalFils).toBe(80_000);
    expect((await loadHistoryDebts(customerId))[0].dues.map((d) => [d.invoiceId, d.dueFils])).toEqual([
      ['hi-may', 30_000],
      ['hi-jun', 10_000],
    ]);
    await restoreEntry(removed);
    expect((await card()).totalFils).toBe(40_000);
    expect((await cash()).box).toBe(before + 40_000);
  });

  it('a customer who owes only them is a card of its own; paid in full it is gone', async () => {
    const { job, customerId } = await company();
    await addDebtPayment({ amountFils: 60_000, method: 'cash', customerId, orderId: job.id });
    expect((await loadDebtors()).find((d) => d.customer.id === customerId)).toMatchObject({ totalFils: 50_000, cars: [] });
    await addDebtPayment({ amountFils: 50_000, method: 'transfer', customerId });
    expect((await loadDebtors()).find((d) => d.customer.id === customerId)).toBeUndefined();
  });
});

describe('a seller the garage owes (v0.50.2)', () => {
  it('its two credits are one card; one sum to it goes to the oldest first, each part a payment of its own; more than owed — refused', async () => {
    await setOpeningBalances(500_000, 0);
    const parts = await cat('parts');
    const newer = await addExpense({ date: '2026-11-17', categoryId: parts, amountFils: 9_450, vatFils: 450, vendor: 'Al Maroof Auto Spare Parts Trading LLC', method: 'credit' });
    const older = await addExpense({ date: '2026-11-16', categoryId: parts, amountFils: 6_825, vatFils: 325, vendor: 'AL MAROOF AUTO SPARE PARTS TRADING L.L.C', method: 'credit' });
    await addExpense({ date: '2026-11-15', categoryId: parts, amountFils: 5_000, vatFils: 0, method: 'credit' });
    const { creditors, loose } = await loadCreditors();
    expect(creditors.map((c) => [c.credits.map((d) => d.expense.id), c.leftFils])).toEqual([[[older.id, newer.id], 16_275]]);
    expect(loose).toHaveLength(1);
    const before = await cash();
    await expect(paySupplier([older.id, newer.id], { amountFils: 20_000, method: 'cash' })).rejects.toMatchObject({ code: 'err.creditOver' });
    const paid = await paySupplier([older.id, newer.id], { amountFils: 10_000, method: 'cash' });
    expect(paid.map((p) => [p.expenseId, p.amountFils])).toEqual([
      [older.id, 6_825],
      [newer.id, 3_175],
    ]);
    expect((await companyDebtOf(older.id))!.leftFils).toBe(0);
    expect((await companyDebtOf(newer.id))!.leftFils).toBe(6_275);
    expect(await cash()).toEqual({ book: before.book - 10_000, box: before.box - 10_000 });
    expect((await loadCreditors()).creditors[0].credits.map((d) => d.expense.id)).toEqual([newer.id]);
  });
});

describe('whom the garage owes (v0.61, the user: «заказали запчасть, а заплатил не мы, а кто-то другой в долг»)', () => {
  it('a person who paid three times, on different days for different things, is one card; the seller of his parts is not owed', async () => {
    await setOpeningBalances(500_000, 0);
    const parts = await cat('parts');
    // Ahmed paid Al Noor for the pads; then the oil for us; then (named the same way, another phone not given) the tyres.
    const a = await addExpense({ date: '2026-11-10', categoryId: parts, amountFils: 30_000, vatFils: 0, vendor: 'Al Noor Auto', method: 'credit', owedTo: { kind: 'new', name: 'Ahmed', phone: '050 111 2233' } });
    const b = await addExpense({ date: '2026-11-12', categoryId: await cat('consumables'), amountFils: 12_000, vatFils: 0, method: 'credit', owedTo: { kind: 'new', name: ' ahmed ' } });
    const lenders = await db.lenders.toArray();
    expect(lenders.map((l) => [l.name, l.phone])).toEqual([['Ahmed', '+971501112233']]);
    const c = await addExpense({ date: '2026-11-14', categoryId: parts, amountFils: 50_000, vatFils: 0, vendor: 'Tyre Shop', method: 'credit', owedTo: { kind: 'lender', id: lenders[0].id, name: 'Ahmed' } });
    // The shop gave its own goods on credit: owed to the seller, as before.
    const shop = await addExpense({ date: '2026-11-13', categoryId: parts, amountFils: 7_000, vatFils: 0, vendor: 'Al Noor Auto', method: 'credit', owedTo: { kind: 'seller', name: 'Al Noor Auto' } });
    expect((await db.expenses.get(a.id))!.lenderId).toBe(lenders[0].id);
    expect((await db.expenses.get(shop.id))!.lenderId).toBeUndefined();

    const { creditors, loose } = await loadCreditors();
    expect(loose).toEqual([]);
    expect(creditors.map((x) => [x.name, x.lender?.id, x.phone, x.credits.map((d) => d.expense.id), x.leftFils])).toEqual([
      ['Ahmed', lenders[0].id, '+971501112233', [a.id, b.id, c.id], 92_000],
      ['Al Noor Auto', undefined, undefined, [shop.id], 7_000],
    ]);
    // Paid back 30 000 at once: his oldest goes first and is paid off — it stays on his card, among the paid ones.
    await paySupplier(creditors[0].credits.map((d) => d.expense.id), { amountFils: 30_000, method: 'cash' });
    const after = (await loadCreditors()).creditors.find((x) => x.lender)!;
    expect([after.credits.map((d) => d.expense.id), after.settled.map((d) => d.expense.id), after.leftFils]).toEqual([[b.id, c.id], [a.id], 62_000]);

    // The book names him on the credits and on the payment; the money sheet too.
    const book = (await loadLedger()).entries;
    expect(book.filter((e) => e.owedTo === 'Ahmed').map((e) => [e.source, e.amountFils]).sort()).toEqual([
      ['credit', 30_000],
      ['expense', 12_000],
      ['expense', 30_000],
      ['expense', 50_000],
    ]);
    const rows = (await moneySheetOfBook()).rows;
    expect(rows.filter((r) => r.payment === 'Credit').map((r) => [r.amountFils, r.notes])).toEqual([
      [30_000, 'Owed to Ahmed — Al Noor Auto'],
      [12_000, 'Owed to Ahmed'],
      [7_000, 'Owed to Al Noor Auto'],
      [50_000, 'Owed to Ahmed — Tyre Shop'],
    ]);
    expect(rows.find((r) => r.payment === 'Cash' && r.amountFils === 30_000)!.notes).toBe('Credit paid to Ahmed: Al Noor Auto');
  });

  it('a part paid by us, the rest by a person: only the credit part is owed to him', async () => {
    await setOpeningBalances(500_000, 0);
    const first = await addExpense({
      date: dubaiDate(),
      categoryId: await cat('parts'),
      amountFils: 15_000,
      vatFils: 0,
      vendor: 'NAKASH',
      method: 'cash',
      parts: [
        { method: 'cash', amountFils: 10_000 },
        { method: 'credit', amountFils: 5_000 },
      ],
      owedTo: { kind: 'new', name: 'Rashid' },
    });
    const list = await db.expenses.filter((e) => e.splitId === first.id).toArray();
    const rashid = (await db.lenders.toArray())[0];
    expect(list.map((e) => [e.method, e.vendor, e.lenderId]).sort()).toEqual([
      ['cash', 'NAKASH', undefined],
      ['credit', 'NAKASH', rashid.id],
    ]);
    expect((await loadCreditors()).creditors.map((c) => [c.name, c.leftFils])).toEqual([['Rashid', 5_000]]);
  });

  it('an old credit with nobody named gets one later; a person’s name and phone change everywhere', async () => {
    const e = await addExpense({ date: '2026-11-15', categoryId: await cat('parts'), amountFils: 5_000, vatFils: 0, method: 'credit' });
    expect((await loadCreditors()).loose.map((d) => d.expense.id)).toEqual([e.id]);
    expect((await owedOf(e.id))!.to).toBeUndefined();
    await setOwedTo(e.id, { kind: 'new', name: 'Omar' });
    expect((await owedOf(e.id))!.to!.name).toBe('Omar');
    const omar = (await db.lenders.toArray())[0];
    await updateLender(omar.id, { name: 'Omar Khan', phone: '055 999 8877' });
    expect((await loadCreditors()).creditors.map((c) => [c.name, c.phone])).toEqual([['Omar Khan', '+971559998877']]);
    expect((await loadLedger()).entries.find((x) => x.id === e.id)!.owedTo).toBe('Omar Khan');
    // Owed to a supplier of the base instead: the expense's seller is it, no person any more.
    const s = uid();
    await db.suppliers.add({ id: s, name: 'Gulf Star Trading', phone: '', createdAt: '2026-11-01T00:00:00.000Z' } as never);
    await setOwedTo(e.id, { kind: 'supplier', id: s, name: 'Gulf Star Trading' });
    const now = (await db.expenses.get(e.id))!;
    expect([now.lenderId, now.supplierId, now.vendor]).toEqual([undefined, s, 'Gulf Star Trading']);
    expect((await loadCreditors()).creditors.map((c) => c.name)).toEqual(['Gulf Star Trading']);
    // The chips: whom the garage owed lately, one each — Omar, added after that credit was taken, first.
    expect((await owedChoices()).map((p) => [p.kind, p.name])).toEqual([
      ['lender', 'Omar Khan'],
      ['supplier', 'Gulf Star Trading'],
    ]);
  });
});

describe('debts paid by month (v0.62, the user: «оплаты долгов компаний и клиентов по месяцам, выбор месяца и оплата»)', () => {
  /** A company with invoices from before the app (April 150, May 300, June 200) and a job of this app owing 600. */
  async function company() {
    await setOpeningBalances(100_000, 0);
    const job = await invoicedJob(600);
    await leaveOnDebt(job.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const customerId = job.customerId;
    const hist = (id: string, date: string, totalFils: number) => ({ id, customerId, vehicleId: job.vehicleId, orderId: undefined, template: 'B', numberKind: 'job', number: id, date, plateRaw: 'W 1', plate: 'W-1', vehicleText: 'Toyota Camry', lines: [], netFils: totalFils, vatFils: 0, totalFils, source: { file: 'x.pdf', sha256: 'x', page: 1 }, importedAt: '' });
    await db.historyInvoices.bulkPut([hist('hi-apr', '2026-04-08', 15_000), hist('hi-may', '2026-05-02', 30_000), hist('hi-jun', '2026-06-03', 20_000)] as never);
    return { job, customerId };
  }
  const now = () => dubaiDate().slice(0, 7);

  it('June picked is paid, the older months still owe; the job’s month paid through money in — the job is closed; a month paid shows as paid', async () => {
    const { job, customerId } = await company();
    const card = async () => (await loadDebtors()).find((d) => d.customer.id === customerId);
    expect((await card())!.months.map((m) => [m.month, m.dueFils])).toEqual([
      ['2026-04', 15_000],
      ['2026-05', 30_000],
      ['2026-06', 20_000],
      [now(), 60_000],
    ]);
    const june = await addDebtPayment({ amountFils: 20_000, method: 'transfer', customerId, months: ['2026-06'] });
    expect([june.historyParts, june.parts, june.restFils]).toEqual([[{ invoiceId: 'hi-jun', amountFils: 20_000 }], [], 0]);
    expect((await card())!.months.map((m) => [m.month, m.dueFils])).toEqual([
      ['2026-04', 15_000],
      ['2026-05', 30_000],
      [now(), 60_000],
    ]);
    // The job's month, from the money sheet («Приход» → «Оплата долга»): the job is paid off and closed — off the debts.
    await addIncome({ category: 'debt', amountFils: 60_000, method: 'cash', customerId, months: [now()] });
    expect(await due(job.id)).toBe(0);
    expect((await db.orders.get(job.id))!.stage).toBe('closed');
    expect((await card())!.months.map((m) => m.month)).toEqual(['2026-04', '2026-05']);
    // Every month of its papers: June and this month paid, April and May owing.
    expect(await loadCustomerMonths(customerId)).toEqual([
      { month: '2026-04', totalFils: 15_000, dueFils: 15_000, count: 1 },
      { month: '2026-05', totalFils: 30_000, dueFils: 30_000, count: 1 },
      { month: '2026-06', totalFils: 20_000, dueFils: 0, count: 1 },
      { month: now(), totalFils: 60_000, dueFils: 0, count: 1 },
    ]);
  });

  it('more than the month picked owes: the rest goes to the oldest; a month half paid says what is left of it', async () => {
    const { customerId } = await company();
    const may = await addDebtPayment({ amountFils: 40_000, method: 'cash', customerId, months: ['2026-05'] });
    expect(may.historyParts).toEqual([
      { invoiceId: 'hi-may', amountFils: 30_000 },
      { invoiceId: 'hi-apr', amountFils: 10_000 },
    ]);
    expect((await loadCustomerMonths(customerId)).slice(0, 2)).toEqual([
      { month: '2026-04', totalFils: 15_000, dueFils: 5_000, count: 1 },
      { month: '2026-05', totalFils: 30_000, dueFils: 0, count: 1 },
    ]);
  });

  it('a seller’s month picked: its credits paid, the older month untouched', async () => {
    await setOpeningBalances(500_000, 0);
    const parts = await cat('parts');
    const oct = await addExpense({ date: '2026-10-30', categoryId: parts, amountFils: 7_000, vatFils: 0, vendor: 'Gulf Star', method: 'credit' });
    const nov = await addExpense({ date: '2026-11-02', categoryId: parts, amountFils: 5_000, vatFils: 0, vendor: 'Gulf Star', method: 'credit' });
    await paySupplier([oct.id, nov.id], { amountFils: 5_000, method: 'cash', first: [nov.id] });
    expect([(await companyDebtOf(oct.id))!.leftFils, (await companyDebtOf(nov.id))!.leftFils]).toEqual([7_000, 0]);
  });
});

describe('the account, its statement and the payments of debts (v0.62.2, «таблица платежей… с выбором периода»; «прозрачный отчёт для клиента»)', () => {
  /** A company: April 150, May 300, June 200 from before the app; a job left on debt for 600; a job paid at the hand-over. */
  async function company() {
    await setOpeningBalances(100_000, 0);
    const job = await invoicedJob(600);
    await leaveOnDebt(job.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const customerId = job.customerId;
    const paidAtOnce = await invoicedJob(250, customerId);
    await addPayment(paidAtOnce.id, { kind: 'payment', method: 'card', amountFils: 25_000 });
    await changeStage(paidAtOnce.id, 'closed');
    const hist = (id: string, date: string, totalFils: number) => ({ id, customerId, vehicleId: job.vehicleId, orderId: undefined, template: 'B', numberKind: 'job', number: id, date, plateRaw: 'W 1', plate: 'W-1', vehicleText: 'Toyota Camry', lines: [], netFils: totalFils, vatFils: 0, totalFils, source: { file: 'x.pdf', sha256: 'x', page: 1 }, importedAt: '' });
    await db.historyInvoices.bulkPut([hist('hi-apr', '2026-04-08', 15_000), hist('hi-may', '2026-05-02', 30_000), hist('hi-jun', '2026-06-03', 20_000)] as never);
    return { job, paidAtOnce, customerId };
  }
  const today = () => dubaiDate();

  it('the account: every invoice and every payment set against them; a statement adds up to the fils', async () => {
    const { job, customerId } = await company();
    await addDebtPayment({ amountFils: 50_000, method: 'transfer', customerId, months: ['2026-05', '2026-06'], date: '2026-06-20' });
    const account = (await customerAccount(customerId))!;
    expect(account.lines.map((l) => [l.key, l.totalFils]).sort()).toEqual(
      [
        [job.id, 60_000],
        ['h:hi-apr', 15_000],
        ['h:hi-may', 30_000],
        ['h:hi-jun', 20_000],
      ]
        .concat(account.lines.filter((l) => l.totalFils === 25_000).map((l) => [l.key, 25_000]))
        .sort(),
    );
    // May–June as they stand today: invoiced and paid off by the payment of 20/06; April and the job — the rest of the account.
    const s = statementOf(account.lines, account.payments, '2026-05-01', '2026-06-30', today());
    expect([s.invoicedFils, s.paidFils, s.dueFils, s.otherDueFils, s.totalDueFils]).toEqual([50_000, 50_000, 0, 75_000, 75_000]);
    expect(s.months.map((m) => [m.month, m.status])).toEqual([
      ['2026-05', 'paid'],
      ['2026-06', 'paid'],
    ]);
    expect(s.lines.find((l) => l.key === 'h:hi-may')?.paidOn).toBe('2026-06-20');
    // Everything up to today: the jobs too — the one paid at the hand-over is paid; the debt left is what the card says.
    const all = (await customerStatement(customerId, '2000-01-01', today()))!.statement;
    expect(all.invoicedFils - all.paidFils).toBe(all.dueFils);
    expect(all.dueFils).toBe((await loadDebtors()).find((d) => d.customer.id === customerId)!.totalFils);
    expect([all.dueFils, all.otherDueFils]).toEqual([75_000, 0]);
    expect(all.lines.filter((l) => l.status === 'paid')).toHaveLength(3);
  });

  it('v0.63: April paid today is paid for April — its statement and «Платежи» by invoices; one invoice of a month picked and paid', async () => {
    const { customerId } = await company();
    // Paid today, the one invoice of April picked (not the oldest by chance — May's is picked over it next).
    const april = await addDebtPayment({ amountFils: 15_000, method: 'transfer', customerId, keys: ['h:hi-apr'] });
    expect(april.historyParts).toEqual([{ invoiceId: 'hi-apr', amountFils: 15_000 }]);
    const june = await addDebtPayment({ amountFils: 20_000, method: 'cash', customerId, keys: ['h:hi-jun'] });
    expect(june.historyParts).toEqual([{ invoiceId: 'hi-jun', amountFils: 20_000 }]);
    // April's statement today: PAID, with the payment made today.
    const s = (await customerStatement(customerId, '2026-04-01', '2026-04-30'))!.statement;
    expect([s.invoicedFils, s.paidFils, s.dueFils, s.lines[0].status, s.lines[0].paidOn, s.payments.map((p) => [p.date, p.amountFils])]).toEqual([15_000, 15_000, 0, 'paid', today(), [[today(), 15_000]]]);
    // «Платежи» for April by invoices: that payment; by payment day — none in April.
    const byInvoice = await loadDebtPayments('owed', '2026-04-01', '2026-04-30', 'invoice');
    expect(byInvoice.rows.map((r) => [r.date, r.amountFils, r.months, r.leftFils])).toEqual([[today(), 15_000, ['2026-04'], 0]]);
    expect(byInvoice.owners.find((o) => o.key === customerId)).toMatchObject({ paidFils: 15_000, leftFils: 0 });
    expect((await loadDebtPayments('owed', '2026-04-01', '2026-04-30', 'payment')).rows).toEqual([]);
    // May by invoices: nothing paid of it yet, all of it left.
    expect((await loadDebtPayments('owed', '2026-05-01', '2026-05-31', 'invoice')).owners.find((o) => o.key === customerId)).toMatchObject({ paidFils: 0, leftFils: 30_000 });
  });

  it('«Платежи»: the debts paid in a period — not the one paid at the hand-over; what each paid and what was left after it; the operation to open', async () => {
    const { customerId } = await company();
    await addDebtPayment({ amountFils: 50_000, method: 'transfer', customerId, months: ['2026-05', '2026-06'], date: '2026-06-20' });
    await addDebtPayment({ amountFils: 20_000, method: 'cash', customerId });
    const year = await loadDebtPayments('owed', '2026-01-01', today());
    expect(year.rows.map((r) => [r.date, r.amountFils, r.months, r.leftFils])).toEqual([
      [today(), 20_000, ['2026-04', today().slice(0, 7)], 55_000],
      ['2026-06-20', 50_000, ['2026-05', '2026-06'], 15_000],
    ]);
    expect(year.rows.every((r) => r.entry?.source === 'income')).toBe(true);
    expect(year.owners.find((o) => o.key === customerId)).toMatchObject({ paidFils: 70_000, count: 2, leftFils: 55_000 });
    // June only.
    expect((await loadDebtPayments('owed', '2026-06-01', '2026-06-30')).rows.map((r) => r.amountFils)).toEqual([50_000]);
  });

  it('the garage’s side: what was paid to a seller, and what was left after it', async () => {
    await setOpeningBalances(500_000, 0);
    const parts = await cat('parts');
    const oct = await addExpense({ date: '2026-10-30', categoryId: parts, amountFils: 7_000, vatFils: 0, vendor: 'Gulf Star', method: 'credit' });
    const nov = await addExpense({ date: '2026-11-02', categoryId: parts, amountFils: 5_000, vatFils: 0, vendor: 'Gulf Star', method: 'credit' });
    await paySupplier([oct.id, nov.id], { amountFils: 5_000, method: 'cash', date: '2026-11-10', first: [nov.id] });
    const v = await loadDebtPayments('owe', '2026-11-01', '2026-11-30');
    expect(v.rows.map((r) => [r.amountFils, r.months, r.leftFils, r.entry?.source])).toEqual([[5_000, ['2026-11'], 7_000, 'credit']]);
    expect(v.owners.map((o) => [o.name, o.paidFils, o.leftFils])).toEqual([['Gulf Star', 5_000, 7_000]]);
  });
});
