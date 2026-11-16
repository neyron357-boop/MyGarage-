import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate, onDubaiDay, shiftDay } from '../domain/dates';
import { withEntries } from '../domain/ledger';
import { jobProfit } from '../domain/profit';
import { addDebtPayment, companyDebtOf, loadCompanyDebts, loadDebtJobs, payCredit } from './debts';
import { removeEntry, restoreEntry, updateEntry } from './entries';
import { addItem } from './estimate';
import { approveAll, closeUnpaid, leaveOnDebt } from './flow';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { voidExpense } from './legacyVoid';
import { addCashMovement, addExpense, addPayment, cashState, closeCashDay, createDebt, paySalary, quickInvoice } from './money';
import { bundleAmountDue, changeStage, checkIn, loadOrderBundle } from './orders';
import { payOutsource, setOutsource } from './parts';
import { addProofs } from './proofs';
import { ensureSeed } from './seed';

/*
 * v0.23 — every operation of the money book is deleted or changed (the user's call). The case that asked for it: an
 * expense of 180 for a recovery, typed in cash and cancelled twice (two pairs in the cash box: «Расход −180»,
 * «Корректировка +180»), which really was 10 from the cash box and 170 on credit from Ahmad.
 */

const cat = async (code: string) => (await db.expenseCategories.where('code').equals(code).first())!.id;
const signature = () => new Blob(['sig'], { type: 'image/png' });
const due = async (orderId: string) => bundleAmountDue((await loadOrderBundle(orderId))!);
/** The cash as the book and as the cash box count it — they always agree. */
const cash = async () => {
  const [book, box] = await Promise.all([loadLedger(), cashState()]);
  expect(book.cash).toBe(box.expected);
  return book.cash;
};

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

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  await setOpeningBalances(100_000, 0);
});

describe('the user’s case: a recovery of 180 — 10 from the cash box, 170 on credit', () => {
  it('the pairs an old cancellation left go as one (either row), the cash stays; the credit and its payment get their day', async () => {
    const parts = await cat('parts');
    for (let n = 0; n < 2; n++) {
      const e = await addExpense({ date: '2026-11-07', categoryId: parts, amountFils: 18_000, vatFils: 0, method: 'cash', note: 'FOR RECOVERY' });
      await voidExpense(e.id);
    }
    expect(await cash()).toBe(100_000);
    let st = await cashState();
    expect(st.lines).toHaveLength(4);
    const book = await loadLedger();
    const rows = withEntries(st.lines, book.entries);
    // In the cash box they open as cancelled movements: the book left them out.
    expect(rows.every((r) => r.entry.cancelled && r.entry.source === 'movement')).toBe(true);
    // One pair by its reversal, the other by the expense's own movement.
    const reversal = rows.find((r) => r.m.reason === 'adjustment')!;
    await removeEntry({ source: 'movement', id: reversal.m.id });
    st = await cashState();
    expect(st.lines).toHaveLength(2);
    const own = st.lines.find((l) => l.m.reason === 'expense')!;
    await removeEntry({ source: 'movement', id: own.m.id });
    expect((await cashState()).lines).toHaveLength(0);
    expect(await db.expenses.count()).toBe(0);
    expect(await cash()).toBe(100_000);

    // As it really was: 180 on credit from Ahmad, 10 of it paid in cash — typed today, then moved to the 11th.
    const credit = await addExpense({ date: '2026-11-11', categoryId: parts, amountFils: 18_000, vatFils: 0, vendor: 'AHMAD', method: 'credit', note: 'RECOVERY' });
    const paid = await payCredit(credit.id, { amountFils: 1_000, method: 'cash', date: '2026-11-16' });
    expect(paid.date).toBe('2026-11-16');
    await updateEntry({ source: 'credit', id: paid.id }, { date: '2026-11-11' });
    expect((await db.creditPayments.get(paid.id))!.date).toBe('2026-11-11');
    expect((await cashState()).lines.map((l) => l.date)).toEqual(['2026-11-11']);
    expect((await loadLedger()).entries.map((e) => [e.source, e.date, e.amountFils])).toEqual([['credit', '2026-11-11', 1_000]]);
    expect(await cash()).toBe(99_000);
    expect((await companyDebtOf(credit.id))!.leftFils).toBe(17_000);

    // The debt typed twice: the second one deleted — and back with «Отменить», and deleted again.
    const twice = await addExpense({ date: '2026-11-11', categoryId: parts, amountFils: 17_000, vatFils: 0, vendor: 'AHMAD', method: 'credit', note: 'RECOVERY' });
    expect(await loadCompanyDebts()).toHaveLength(2);
    const removed = await removeEntry({ source: 'expense', id: twice.id });
    expect((await loadCompanyDebts()).map((d) => d.expense.id)).toEqual([credit.id]);
    await restoreEntry(removed);
    expect(await loadCompanyDebts()).toHaveLength(2);
    await removeEntry({ source: 'expense', id: twice.id });
    expect(await loadCompanyDebts()).toHaveLength(1);
    expect(await cash()).toBe(99_000);
  });

  it('an old cash expense becomes credit (the cash comes back), then is partly paid on its own day', async () => {
    const e = await addExpense({ date: '2026-11-11', categoryId: await cat('parts'), amountFils: 18_000, vatFils: 0, vendor: 'AHMAD', method: 'cash' });
    expect(await cash()).toBe(82_000);
    await updateEntry({ source: 'expense', id: e.id }, { method: 'credit' });
    expect((await cashState()).lines).toHaveLength(0);
    expect(await cash()).toBe(100_000);
    await payCredit(e.id, { amountFils: 1_000, method: 'cash', date: '2026-11-11' });
    expect(await cash()).toBe(99_000);
    expect((await loadCompanyDebts())[0].leftFils).toBe(17_000);
  });
});

describe('deleting an operation takes it whole; «Отменить» puts it all back', () => {
  it('an expense on credit: its payments and their cash go with it', async () => {
    const e = await addExpense({ date: '2026-11-10', categoryId: await cat('parts'), amountFils: 50_000, vatFils: 0, method: 'credit' });
    await payCredit(e.id, { amountFils: 20_000, method: 'cash' });
    await payCredit(e.id, { amountFils: 10_000, method: 'card' });
    expect(await cash()).toBe(80_000);
    const removed = await removeEntry({ source: 'expense', id: e.id });
    expect(await db.creditPayments.count()).toBe(0);
    expect(await db.cashMovements.count()).toBe(0);
    expect(await cash()).toBe(100_000);
    await restoreEntry(removed);
    expect(await db.creditPayments.count()).toBe(2);
    expect(await cash()).toBe(80_000);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(20_000);
  });

  it('its photos, its salary payment and a contractor line paid from it go with an expense', async () => {
    const emp = (await db.employees.toArray())[0] ?? { id: uid() };
    if (!(await db.employees.get(emp.id))) await db.employees.add({ id: emp.id, name: 'Ali', role: 'mechanic', monthlySalaryFils: 300_000, active: true });
    await paySalary({ employeeId: emp.id, month: '2026-11', kind: 'advance', amountFils: 20_000, method: 'cash' });
    const salary = (await db.salaryPayments.toArray())[0];
    const photo = (await addProofs({ source: 'expense', id: salary.expenseId! }, [new Blob(['x'], { type: 'image/jpeg' })]))[0];
    expect(await db.mediaBlobs.get(photo.id)).toBeTruthy();
    const removed = await removeEntry({ source: 'expense', id: salary.expenseId! });
    expect(await db.salaryPayments.count()).toBe(0);
    expect(await db.media.get(photo.id)).toBeUndefined();
    expect(await db.mediaBlobs.get(photo.id)).toBeUndefined();
    await restoreEntry(removed);
    expect(await db.salaryPayments.count()).toBe(1);
    expect(await db.mediaBlobs.get(photo.id)).toBeTruthy();

    const o = await invoicedJob(300);
    const paint = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Paint', unitPriceFils: 50_000 });
    await db.items.update(paint.id, { costPriceFils: 30_000 });
    await setOutsource(paint.id, { state: 'back' });
    await payOutsource(paint.id, 'cash');
    const paidBy = (await db.items.get(paint.id))!.outsource!.expenseId!;
    const gone = await removeEntry({ source: 'expense', id: paidBy });
    expect((await db.items.get(paint.id))!.outsource).toMatchObject({ state: 'back' });
    expect((await db.items.get(paint.id))!.outsource!.expenseId).toBeUndefined();
    await restoreEntry(gone);
    expect((await db.items.get(paint.id))!.outsource!.expenseId).toBe(paidBy);
  });

  it("a job's payment deleted: the job owes again and its signed debt is open again", async () => {
    const o = await invoicedJob(600);
    await leaveOnDebt(o.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const p = await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 60_000 });
    expect((await loadOrderBundle(o.id))!.order.stage).toBe('closed');
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('paid');
    const removed = await removeEntry({ source: 'payment', id: p.id });
    expect(await due(o.id)).toBe(60_000);
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('open');
    expect((await loadDebtJobs()).map((d) => d.order.id)).toEqual([o.id]);
    expect(await cash()).toBe(100_000);
    await restoreEntry(removed);
    expect(await due(o.id)).toBe(0);
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('paid');
    expect(await cash()).toBe(160_000);
  });

  it("a customer's debt payment: the income, its cash and its jobs' payments go together", async () => {
    const a = await invoicedJob(600);
    await leaveOnDebt(a.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const b = await invoicedJob(400, a.customerId);
    await createDebt(b.id, 40_000, '2026-12-15', signature());
    await changeStage(b.id, 'closed');
    const { income } = await addDebtPayment({ customerId: a.customerId, amountFils: 100_000, method: 'cash' });
    expect([await due(a.id), await due(b.id)]).toEqual([0, 0]);
    // Its day moves its jobs' payments too; its sum stays (delete it and take it again).
    await updateEntry({ source: 'income', id: income.id }, { date: '2026-11-10' });
    expect((await db.payments.where('incomeId').equals(income.id).toArray()).map((p) => dubaiDate(p.receivedAt))).toEqual(['2026-11-10', '2026-11-10']);
    await expect(updateEntry({ source: 'income', id: income.id }, { amountFils: 90_000 })).rejects.toMatchObject({ code: 'err.debtPaymentAmount' });
    // Deleted from one of its jobs' payments: the whole income goes.
    const part = (await db.payments.where('incomeId').equals(income.id).first())!;
    const removed = await removeEntry({ source: 'payment', id: part.id });
    expect(await db.incomes.count()).toBe(0);
    expect(await db.payments.where('incomeId').equals(income.id).count()).toBe(0);
    expect([await due(a.id), await due(b.id)]).toEqual([60_000, 40_000]);
    expect((await db.debts.toArray()).map((d) => d.status)).toEqual(['open', 'open']);
    expect(await cash()).toBe(100_000);
    await restoreEntry(removed);
    expect([await due(a.id), await due(b.id)]).toEqual([0, 0]);
    expect(await cash()).toBe(200_000);
  });
});

describe('changing an operation: day, sum, way, note', () => {
  it('a cash expense: a new sum carries its VAT share and moves the cash; card — out of the cash box; credit — owed', async () => {
    const e = await addExpense({ date: '2026-11-10', categoryId: await cat('consumables'), amountFils: 10_500, vatFils: 500, method: 'cash', vendor: 'ACE' });
    await updateEntry({ source: 'expense', id: e.id }, { amountFils: 21_000, date: '2026-11-09', note: 'gloves' });
    expect(await db.expenses.get(e.id)).toMatchObject({ amountFils: 21_000, vatFils: 1_000, date: '2026-11-09', note: 'gloves' });
    expect((await cashState()).lines.map((l) => [l.date, l.m.amountFils])).toEqual([['2026-11-09', 21_000]]);
    expect(await cash()).toBe(79_000);
    await updateEntry({ source: 'expense', id: e.id }, { method: 'card' });
    expect(await db.cashMovements.count()).toBe(0);
    expect(await cash()).toBe(100_000);
    await updateEntry({ source: 'expense', id: e.id }, { method: 'cash' });
    expect(await cash()).toBe(79_000);
    await updateEntry({ source: 'expense', id: e.id }, { method: 'credit' });
    expect(await cash()).toBe(100_000);
    await payCredit(e.id, { amountFils: 5_000, method: 'cash' });
    await expect(updateEntry({ source: 'expense', id: e.id }, { method: 'cash' })).rejects.toMatchObject({ code: 'err.creditPaid' });
    await expect(updateEntry({ source: 'expense', id: e.id }, { amountFils: 4_000 })).rejects.toMatchObject({ code: 'err.belowPaid' });
    const c = (await db.creditPayments.toArray())[0];
    await expect(updateEntry({ source: 'credit', id: c.id }, { amountFils: 22_000 })).rejects.toMatchObject({ code: 'err.creditOver' });
    await updateEntry({ source: 'credit', id: c.id }, { amountFils: 6_000, method: 'transfer' });
    expect(await cash()).toBe(100_000);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(15_000);
  });

  it("a job's payment: its day places it in the cash box, a smaller sum opens the debt, the full one settles it", async () => {
    const o = await invoicedJob(600);
    await leaveOnDebt(o.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const p = await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 60_000 });
    await updateEntry({ source: 'payment', id: p.id }, { date: '2026-11-10' });
    const moved = (await db.payments.get(p.id))!;
    expect(moved.receivedAt).toBe(onDubaiDay(p.receivedAt, '2026-11-10'));
    expect((await cashState()).lines.map((l) => l.date)).toEqual(['2026-11-10']);
    await updateEntry({ source: 'payment', id: p.id }, { amountFils: 30_000 });
    expect(await due(o.id)).toBe(30_000);
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('open');
    await updateEntry({ source: 'payment', id: p.id }, { amountFils: 60_000 });
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('paid');
    await updateEntry({ source: 'payment', id: p.id }, { method: 'card', note: 'slip 77' });
    expect(await db.payments.get(p.id)).toMatchObject({ method: 'card', reference: 'slip 77' });
    expect(await db.cashMovements.count()).toBe(0);
    expect(await cash()).toBe(100_000);
  });

  it('a job paid for an earlier day stands on that day', async () => {
    const o = await invoicedJob(200);
    const p = await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 20_000, date: '2026-11-03' });
    expect(dubaiDate(p.receivedAt)).toBe('2026-11-03');
    expect((await cashState()).lines.map((l) => l.date)).toEqual(['2026-11-03']);
  });

  it('money in of its own: its day, sum and way', async () => {
    const i = await addIncome({ category: 'sales', amountFils: 5_000, method: 'cash', note: 'oil' });
    await updateEntry({ source: 'income', id: i.id }, { amountFils: 6_000, date: '2026-11-02' });
    expect(await db.incomes.get(i.id)).toMatchObject({ amountFils: 6_000, date: '2026-11-02' });
    expect(await cash()).toBe(106_000);
    await updateEntry({ source: 'income', id: i.id }, { method: 'transfer' });
    expect(await cash()).toBe(100_000);
    await expect(updateEntry({ source: 'income', id: i.id }, { method: 'credit' })).rejects.toMatchObject({ code: 'err.notFound' });
  });

  it('a movement of the cash box of its own: day, sum, a note it needs', async () => {
    await addCashMovement({ direction: 'out', amountFils: 3_000, reason: 'collection', note: 'owner' });
    const m = (await db.cashMovements.toArray())[0];
    await updateEntry({ source: 'movement', id: m.id }, { amountFils: 4_000, date: '2026-11-10' });
    expect(dubaiDate((await db.cashMovements.get(m.id))!.at)).toBe('2026-11-10');
    expect(await cash()).toBe(96_000);
    await expect(updateEntry({ source: 'movement', id: m.id }, { note: ' ' })).rejects.toMatchObject({ code: 'err.reasonRequired' });
    const removed = await removeEntry({ source: 'movement', id: m.id });
    expect(await cash()).toBe(100_000);
    await restoreEntry(removed);
    expect(await cash()).toBe(96_000);
  });

  it('a cancelled operation is only deleted', async () => {
    const e = await addExpense({ date: '2026-11-10', categoryId: await cat('parts'), amountFils: 1_000, vatFils: 0, method: 'cash' });
    await voidExpense(e.id);
    await expect(updateEntry({ source: 'expense', id: e.id }, { amountFils: 2_000 })).rejects.toMatchObject({ code: 'err.notFound' });
    const m = (await db.cashMovements.toArray())[0];
    await expect(updateEntry({ source: 'movement', id: m.id }, { amountFils: 2_000 })).rejects.toMatchObject({ code: 'err.notFound' });
  });
});

describe('closed days', () => {
  it("a movement of a counted day that goes moves that day's difference; a closing deleted gives its movements to the next", async () => {
    await setOpeningBalances(10_000, 0);
    const first = await addIncome({ category: 'sales', amountFils: 5_000, method: 'cash' });
    const c1 = await closeCashDay(15_000);
    await addIncome({ category: 'sales', amountFils: 2_000, method: 'cash' });
    const c2 = await closeCashDay(17_000);
    expect(await cash()).toBe(17_000);
    // The count stays: without the sale the first day was 5 000 over.
    const removed = await removeEntry({ source: 'income', id: first.id });
    expect(await db.cashClosings.get(c1.id)).toMatchObject({ cashInFils: 0, expectedFils: 10_000, actualFils: 15_000, diffFils: 5_000 });
    expect(await cash()).toBe(17_000);
    await restoreEntry(removed);
    expect(await db.cashClosings.get(c1.id)).toMatchObject({ cashInFils: 5_000, diffFils: 0 });
    // The first closing deleted: the second counted both days.
    const gone = await removeEntry({ source: 'closing', id: c1.id });
    expect(await db.cashClosings.get(c2.id)).toMatchObject({ openingFils: 10_000, cashInFils: 7_000, expectedFils: 17_000, diffFils: 0 });
    expect(await db.cashMovements.where('closingId').equals(c2.id).count()).toBe(2);
    expect(await cash()).toBe(17_000);
    await restoreEntry(gone);
    expect(await db.cashClosings.count()).toBe(2);
    expect(await db.cashMovements.where('closingId').equals(c1.id).count()).toBe(1);
    expect(await cash()).toBe(17_000);
  });
});

describe('after the review: «Отменить» over a newer change, the day an operation belongs to, jobs that follow', () => {
  const yesterday = () => shiftDay(dubaiDate(), -1);

  it('«Отменить» of an older deletion: the closing is counted from what it holds now, not put back as it was', async () => {
    const a = await addIncome({ category: 'sales', amountFils: 5_000, method: 'cash' });
    const b = await addIncome({ category: 'sales', amountFils: 2_000, method: 'cash' });
    const c = await closeCashDay(107_000);
    const ra = await removeEntry({ source: 'income', id: a.id });
    const rb = await removeEntry({ source: 'income', id: b.id });
    await restoreEntry(ra);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 5_000, expectedFils: 105_000, diffFils: 2_000 });
    expect(await cash()).toBe(107_000);
    await restoreEntry(rb);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 7_000, diffFils: 0 });
    expect(await cash()).toBe(107_000);
  });

  it('«Отменить» brings nothing back without what it hangs on: a credit payment whose debt went since stays gone', async () => {
    const e = await addExpense({ date: dubaiDate(), categoryId: await cat('parts'), amountFils: 50_000, vatFils: 0, method: 'credit' });
    const p = await payCredit(e.id, { amountFils: 1_000, method: 'cash' });
    const rp = await removeEntry({ source: 'credit', id: p.id });
    await removeEntry({ source: 'expense', id: e.id });
    await restoreEntry(rp);
    expect(await db.creditPayments.count()).toBe(0);
    expect(await db.cashMovements.count()).toBe(0);
    expect(await cash()).toBe(100_000);
  });

  it('a closing deleted, then a movement of its day deleted: «Отменить» of the closing counts only what is left', async () => {
    const e = await addExpense({ date: dubaiDate(), categoryId: await cat('parts'), amountFils: 18_000, vatFils: 0, method: 'cash' });
    const c = await closeCashDay(82_000);
    const rc = await removeEntry({ source: 'closing', id: c.id });
    await removeEntry({ source: 'expense', id: e.id });
    await restoreEntry(rc);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashOutFils: 0, expectedFils: 100_000, actualFils: 82_000, diffFils: -18_000 });
    expect(await db.cashMovements.count()).toBe(0);
    expect(await cash()).toBe(82_000);
  });

  it('a closing deleted and the day closed again: «Отменить» does not bring the old closing back into the new row', async () => {
    await addIncome({ category: 'sales', amountFils: 5_000, method: 'cash' });
    const c = await closeCashDay(105_000);
    const rc = await removeEntry({ source: 'closing', id: c.id });
    const again = await closeCashDay(104_000, 'short 10');
    await restoreEntry(rc);
    expect(await db.cashClosings.get(c.id)).toBeUndefined();
    expect(await db.cashClosings.get(again.id)).toMatchObject({ openingFils: 100_000, cashInFils: 5_000, diffFils: -1_000 });
    expect(await cash()).toBe(104_000);
  });

  it('an expense deleted, the day counted, then «Отменить»: the expense goes into that count, not into the open cash box', async () => {
    const e = await addExpense({ date: dubaiDate(), categoryId: await cat('parts'), amountFils: 18_000, vatFils: 0, method: 'cash' });
    const removed = await removeEntry({ source: 'expense', id: e.id });
    // Counted: the 180 really left the box.
    const c = await closeCashDay(82_000, 'the expense deleted by mistake');
    expect(c.diffFils).toBe(-18_000);
    await restoreEntry(removed);
    expect((await db.cashMovements.toArray()).map((m) => m.closingId)).toEqual([c.id]);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashOutFils: 18_000, diffFils: 0 });
    expect(await cash()).toBe(82_000);
  });

  it('cash → card → cash on a counted day: the money is counted once, the day as it was', async () => {
    const o = await invoicedJob(600);
    const p = await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 60_000 });
    const c = await closeCashDay(160_000);
    await updateEntry({ source: 'payment', id: p.id }, { method: 'card' });
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 0, diffFils: 60_000, cardTotalFils: 60_000 });
    await updateEntry({ source: 'payment', id: p.id }, { method: 'cash' });
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 60_000, diffFils: 0, cardTotalFils: 0 });
    expect((await cashState()).lines).toHaveLength(0);
    expect(await cash()).toBe(160_000);
  });

  it('the user’s case on a counted day: 170 in cash becomes 180 on credit, 10 paid in cash that day — the count holds', async () => {
    const e = await addExpense({ date: yesterday(), categoryId: await cat('parts'), amountFils: 17_000, vatFils: 0, method: 'cash', vendor: 'AHMAD' });
    // Counted: only 10 had left the box — the day was 160 over.
    const c = await closeCashDay(99_000, 'only 10 left the box');
    expect(c.diffFils).toBe(16_000);
    await updateEntry({ source: 'expense', id: e.id }, { method: 'credit', amountFils: 18_000 });
    await payCredit(e.id, { amountFils: 1_000, method: 'cash', date: yesterday() });
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashOutFils: 1_000, expectedFils: 99_000, diffFils: 0 });
    expect((await cashState()).lines).toHaveLength(0);
    expect(await cash()).toBe(99_000);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(17_000);
  });

  it('typed later for a counted day, or moved into one: the movement goes to that day’s closing', async () => {
    const c = await closeCashDay(100_000);
    const i = await addIncome({ date: yesterday(), category: 'sales', amountFils: 3_000, method: 'cash' });
    expect((await db.cashMovements.toArray())[0].closingId).toBe(c.id);
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 3_000, diffFils: -3_000 });
    expect(await cash()).toBe(100_000);
    await updateEntry({ source: 'income', id: i.id }, { date: dubaiDate() });
    expect((await db.cashMovements.toArray())[0].closingId).toBeUndefined();
    expect(await db.cashClosings.get(c.id)).toMatchObject({ cashInFils: 0, diffFils: 0 });
    expect(await cash()).toBe(103_000);
    // A job paid by card for that day: in that day’s card total.
    const o = await invoicedJob(200);
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 20_000, date: yesterday() });
    expect((await db.cashClosings.get(c.id))!.cardTotalFils).toBe(20_000);
  });

  it('a refund deleted leaves the job paid in full: its debt is paid and the car gone is closed', async () => {
    const o = await invoicedJob(600);
    await leaveOnDebt(o.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const refund = await addPayment(o.id, { kind: 'refund', method: 'cash', amountFils: 10_000 });
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 60_000 });
    expect(await due(o.id)).toBe(10_000);
    await removeEntry({ source: 'payment', id: refund.id });
    expect(await due(o.id)).toBe(0);
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('paid');
    expect((await loadOrderBundle(o.id))!.order.stage).toBe('closed');
  });

  it('closed without payment: what was let go follows the payments (a prepayment deleted — all of it)', async () => {
    const o = await invoicedJob(1_000);
    const pre = await addPayment(o.id, { kind: 'prepayment', method: 'cash', amountFils: 30_000 });
    await closeUnpaid(o.id);
    expect((await loadOrderBundle(o.id))!.order.waived!.fils).toBe(70_000);
    const removed = await removeEntry({ source: 'payment', id: pre.id });
    let b = (await loadOrderBundle(o.id))!;
    expect(b.order.waived!.fils).toBe(100_000);
    expect(jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses: [] }).revenue).toBe(0);
    await restoreEntry(removed);
    b = (await loadOrderBundle(o.id))!;
    expect(b.order.waived!.fils).toBe(70_000);
    expect(await due(o.id)).toBe(0);
  });

  it('a contractor’s payment changed in the book: the line’s cost and the job’s profit follow', async () => {
    const o = await invoicedJob(300);
    const paint = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Paint', unitPriceFils: 50_000 });
    await db.items.update(paint.id, { costPriceFils: 30_000 });
    await setOutsource(paint.id, { state: 'back' });
    await payOutsource(paint.id, 'cash');
    const paidBy = (await db.items.get(paint.id))!.outsource!.expenseId!;
    await updateEntry({ source: 'expense', id: paidBy }, { amountFils: 25_000 });
    expect((await db.items.get(paint.id))!.costPriceFils).toBe(25_000);
    const b = (await loadOrderBundle(o.id))!;
    const expenses = await db.expenses.where('orderId').equals(o.id).toArray();
    expect(jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses })).toMatchObject({ outside: 25_000, expenses: 0 });
  });

  it('a deleted card payment leaves its day’s card total', async () => {
    const o = await invoicedJob(600);
    const p = await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 60_000 });
    const c = await closeCashDay(100_000);
    expect(c.cardTotalFils).toBe(60_000);
    await removeEntry({ source: 'payment', id: p.id });
    expect((await db.cashClosings.get(c.id))!.cardTotalFils).toBe(0);
  });
});

describe('the second review (v0.23.1)', () => {
  it('a closing comes back only after the closing it came after: the one before it deleted since — it stays gone', async () => {
    await addIncome({ category: 'sales', amountFils: 1_000, method: 'cash' });
    const a = await closeCashDay(101_000);
    await addIncome({ category: 'sales', amountFils: 500, method: 'cash' });
    const b = await closeCashDay(101_500);
    const c = await closeCashDay(101_500);
    const rc = await removeEntry({ source: 'closing', id: c.id });
    await removeEntry({ source: 'closing', id: b.id });
    await restoreEntry(rc);
    expect(await db.cashClosings.get(c.id)).toBeUndefined();
    expect((await db.cashClosings.toArray()).map((x) => x.id)).toEqual([a.id]);
    expect(await cash()).toBe(101_500);
    // The first one deleted and «Отменить»: back as it was.
    const rb2 = await removeEntry({ source: 'closing', id: a.id });
    expect(await cash()).toBe(101_500);
    await restoreEntry(rb2);
    expect(await db.cashClosings.get(a.id)).toBeTruthy();
    expect(await cash()).toBe(101_500);
  });

  it('«Отменить» does not bring back a payment of a credit its debt no longer takes', async () => {
    const e = await addExpense({ date: dubaiDate(), categoryId: await cat('parts'), amountFils: 10_000, vatFils: 0, method: 'credit' });
    const p = await payCredit(e.id, { amountFils: 6_000, method: 'cash' });
    const r = await removeEntry({ source: 'credit', id: p.id });
    await payCredit(e.id, { amountFils: 10_000, method: 'cash' });
    await restoreEntry(r);
    expect((await db.creditPayments.toArray()).map((x) => x.amountFils)).toEqual([10_000]);
    expect((await companyDebtOf(e.id))!.leftFils).toBe(0);
    expect(await cash()).toBe(90_000);
    // Changed to a paid way meanwhile: no payment of a credit comes back to it.
    const e2 = await addExpense({ date: dubaiDate(), categoryId: await cat('parts'), amountFils: 4_000, vatFils: 0, method: 'credit' });
    const p2 = await payCredit(e2.id, { amountFils: 4_000, method: 'cash' });
    const r2 = await removeEntry({ source: 'credit', id: p2.id });
    await updateEntry({ source: 'expense', id: e2.id }, { method: 'cash' });
    await restoreEntry(r2);
    expect(await db.creditPayments.where('expenseId').equals(e2.id).count()).toBe(0);
    expect(await cash()).toBe(86_000);
  });

  it('the payment that closed a job deleted: a debt again — «Выдана», on the board; «Отменить» closes it again', async () => {
    const o = await invoicedJob(600);
    await leaveOnDebt(o.id, { amountFils: 60_000, dueDate: '2026-12-01', signature: signature() });
    const p = await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 60_000 });
    expect((await loadOrderBundle(o.id))!.order.stage).toBe('closed');
    const removed = await removeEntry({ source: 'payment', id: p.id });
    expect((await loadOrderBundle(o.id))!.order.stage).toBe('delivered');
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('open');
    await restoreEntry(removed);
    expect((await loadOrderBundle(o.id))!.order.stage).toBe('closed');
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('paid');
    // A sum typed wrong (3 500 for 350): closed, then owing — «Выдана» again.
    await updateEntry({ source: 'payment', id: p.id }, { amountFils: 50_000 });
    expect((await loadOrderBundle(o.id))!.order.stage).toBe('delivered');
  });

  it('no day after today', async () => {
    const i = await addIncome({ category: 'sales', amountFils: 1_000, method: 'cash' });
    await expect(updateEntry({ source: 'income', id: i.id }, { date: shiftDay(dubaiDate(), 1) })).rejects.toMatchObject({ code: 'err.futureDate' });
  });
});
