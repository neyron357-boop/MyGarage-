import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { computeReport } from '../domain/reports';
import { addDebtPayment, companyDebtOf, loadCompanyDebts, loadDebtJobs, loadDebtors, payCredit } from './debts';
import { voidCreditPayment, voidExpense, voidIncome } from './legacyVoid';
import { addItem } from './estimate';
import { approveAll, leaveOnDebt } from './flow';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { addExpense, cashState, createDebt, quickInvoice } from './money';
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
    expect((await loadLedger()).entries.some((x) => x.id === e.id)).toBe(false);
    expect((await loadCompanyDebts()).map((d) => [d.expense.id, d.leftFils])).toEqual([[e.id, 100_000]]);

    await payCredit(e.id, { amountFils: 30_000, method: 'cash' });
    const after = await cash();
    expect(before.book - after.book).toBe(30_000);
    expect(before.box - after.box).toBe(30_000);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(70_000);
    // The book: the payment, on its day and by its way; the cash box: its movement.
    const line = (await loadLedger()).entries.find((x) => x.source === 'credit')!;
    expect(line).toMatchObject({ kind: 'out', purse: 'cash', amountFils: 30_000, category: 'credit_payment', credit: { expenseId: e.id } });
    expect((await db.cashMovements.filter((m) => m.reason === 'credit_payment').toArray()).length).toBe(1);
    // The expense is counted once — 1 000, not 1 300.
    const [orders, invoices, items, expenses, payments, closings, incomes] = await Promise.all([db.orders.toArray(), db.invoices.toArray(), db.items.toArray(), db.expenses.toArray(), db.payments.toArray(), db.cashClosings.toArray(), db.incomes.toArray()]);
    expect(computeReport({ from: '2000-01-01', to: '2100-01-01', orders, invoices, items, expenses, payments, closings, incomes }).expensesGross).toBe(100_000);
    // The money sheet: the payment is the expense it pays off.
    expect((await moneySheetOfBook()).rows.map((r) => [r.type, r.category, r.amountFils, r.notes])).toEqual([['Expense', 'Parts Purchases', 30_000, 'Credit paid: Al Futtaim Parts']]);

    // Not more than is left; paid off — no longer owed.
    await expect(payCredit(e.id, { amountFils: 80_000, method: 'card' })).rejects.toMatchObject({ code: 'err.creditOver' });
    await expect(voidExpense(e.id)).rejects.toMatchObject({ code: 'err.creditPaid' });
    await payCredit(e.id, { amountFils: 70_000, method: 'transfer' });
    expect(await loadCompanyDebts()).toEqual([]);
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
