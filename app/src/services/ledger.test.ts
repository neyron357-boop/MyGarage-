import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, ImmutableError, setDb, uid } from '../db/db';
import { expenseEntry, periodTotals } from '../domain/ledger';
import { computeReport } from '../domain/reports';
import { createCustomer, createVehicle } from './customers';
import { addIncome, loadLedger, moneyOf, setOpeningBalances, updateExpense, voidExpense, voidIncome } from './ledger';
import { addExpense, addPayment, cashState, closeCashDay } from './money';
import { createOrder } from './orders';
import { ensureSeed } from './seed';

const cat = async (code: string) => (await db.expenseCategories.where('code').equals(code).first())!.id;

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('money book', () => {
  it("adds up like the garage's money sheet (card expenses do not reduce the card balance)", async () => {
    await setOpeningBalances(8500, 0);
    const c = await createCustomer({ name: 'Honda owner', phone: '050 111 2222', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const civic = await createVehicle(c.id, { plate: { emirate: 'DXB', code: 'B', number: '38203' }, make: 'Honda', model: 'Civic' });
    // The rows of the sheet (10–11 July).
    await addIncome({ date: '2026-07-10', category: 'service', amountFils: 20000, method: 'cash', note: 'Toyota Hiace alternator change' });
    await addExpense({ date: '2026-07-10', categoryId: await cat('tools'), amountFils: 1300, vatFils: 0, method: 'card', note: 'cottons for garage' });
    await addIncome({ date: '2026-07-10', category: 'service', amountFils: 115000, method: 'card', note: 'for mitsubishi lancer 14124' });
    await addIncome({ date: '2026-07-10', category: 'service', amountFils: 2500, method: 'cash', note: 'bulb change' });
    await addIncome({ date: '2026-07-11', category: 'service', amountFils: 60000, method: 'cash', note: 'Toyota Corolla - shock absorbers' });
    await addIncome({ date: '2026-07-11', category: 'service', amountFils: 8000, method: 'cash', note: 'X Terra oil change labor' });
    await addIncome({ date: '2026-07-11', category: 'sales', amountFils: 1000, method: 'cash', note: 'fw40' });
    await addExpense({ date: '2026-07-11', categoryId: await cat('parts'), amountFils: 28000, vatFils: 0, method: 'cash', note: 'alternator used original', vehicleId: civic.id });

    const book = await loadLedger();
    expect(book.cash).toBe(72000);
    expect(book.card).toBe(115000);
    expect(book.entries.map((e) => [e.cashAfter / 100, e.cardAfter / 100])).toEqual([
      [285, 0],
      [285, 0],
      [285, 1150],
      [310, 1150],
      [910, 1150],
      [990, 1150],
      [1000, 1150],
      [720, 1150],
    ]);
    const t = periodTotals(book.entries, '2026-07-01', '2026-07-31');
    expect(t).toEqual({ cash: { inFils: 91500, outFils: 28000 }, card: { inFils: 115000, outFils: 1300 } });
    // The cash box agrees with the book.
    expect((await cashState()).expected).toBe(72000);
    // The parts expense is linked to the car and, through it, to its owner.
    const parts = book.entries.find((e) => e.note === 'alternator used original')!;
    expect(parts).toMatchObject({ vehicleId: civic.id, customerId: c.id });
    expect((await moneyOf({ customerId: c.id })).expenses).toHaveLength(1);
  });

  it('job payments come in by themselves; an expense for a job is linked to its car and customer', async () => {
    const c = await createCustomer({ name: 'A', phone: '050 333 4444', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const v = await createVehicle(c.id, { plate: { emirate: 'DXB', code: 'J', number: '14124' }, make: 'Mitsubishi', model: 'Lancer' });
    const o = await createOrder({ customerId: c.id, vehicleId: v.id, complaint: '', arrivedNow: true });
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 50000 });
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 10000 });
    const e = await addExpense({ date: '2026-07-12', categoryId: await cat('parts'), amountFils: 20000, vatFils: 952, method: 'card', orderId: o.id });
    expect(e).toMatchObject({ orderId: o.id, vehicleId: v.id, customerId: c.id });
    const book = await loadLedger();
    expect(book.card).toBe(50000); // the card expense is tracked but the card balance stays
    expect(book.cash).toBe(10000);
    expect(book.entries.filter((x) => x.source === 'payment').every((x) => x.orderId === o.id && x.vehicleId === v.id)).toBe(true);
    expect((await moneyOf({ orderId: o.id })).expenses.map((x) => x.id)).toEqual([e.id]);
  });

  it('a mistaken entry is cancelled, not deleted; the cash still adds up', async () => {
    await setOpeningBalances(10000, 0);
    const i = await addIncome({ category: 'sales', amountFils: 5000, method: 'cash', note: 'oil' });
    const e = await addExpense({ date: '2026-07-12', categoryId: await cat('consumables'), amountFils: 2000, vatFils: 0, method: 'cash' });
    expect((await loadLedger()).cash).toBe(13000);
    await voidIncome(i.id);
    await voidExpense(e.id);
    await voidExpense(e.id); // twice is the same as once
    const book = await loadLedger();
    expect(book.cash).toBe(10000);
    expect(book.entries).toHaveLength(0);
    expect((await cashState()).expected).toBe(10000);
    expect(await db.expenses.get(e.id)).toMatchObject({ voidedAt: expect.any(String) });
    // The money of an entry cannot be changed, what it was for can.
    await expect(db.expenses.update(e.id, { amountFils: 1 })).rejects.toBeInstanceOf(ImmutableError);
    await expect(db.expenses.delete(e.id)).rejects.toBeInstanceOf(ImmutableError);
    await updateExpense(e.id, { note: 'gloves' });
    expect((await db.expenses.get(e.id))!.note).toBe('gloves');
  });

  it('a day closing difference shows in the book; the cash box starts from the opening cash', async () => {
    await setOpeningBalances(8500, 0);
    await addIncome({ category: 'service', amountFils: 20000, method: 'cash' });
    expect((await cashState()).expected).toBe(28500);
    await closeCashDay(28000, 'short by 5');
    const book = await loadLedger();
    expect(book.cash).toBe(28000);
    expect(book.entries.at(-1)).toMatchObject({ source: 'closing', kind: 'out', amountFils: 500, cashAfter: 28000 });
    await addIncome({ category: 'sales', amountFils: 1000, method: 'cash' });
    expect((await cashState()).expected).toBe(29000);
    expect((await loadLedger()).cash).toBe(29000);
    // After a closing the cash start no longer moves the cash balance (the counted cash does).
    await setOpeningBalances(50000, 0);
    expect(await loadLedger()).toMatchObject({ cash: 29000, cashStartFils: 8500, cashStartLocked: true });
    expect((await cashState()).expected).toBe(29000);
  });

  it('other income is in the report; cancelled expenses are not', async () => {
    const i = await addIncome({ date: '2026-07-10', category: 'sales', amountFils: 1000, method: 'cash' });
    const e = await addExpense({ date: '2026-07-10', categoryId: await cat('tools'), amountFils: 3000, vatFils: 0, method: 'card' });
    await voidExpense(e.id);
    const r = computeReport({ from: '2026-07-01', to: '2026-07-31', orders: [], invoices: [], items: [], expenses: await db.expenses.toArray(), payments: [], closings: [], incomes: [i] });
    expect(r.otherIncome).toBe(1000);
    expect(r.expensesNet).toBe(0);
    expect(r.grossProfit).toBe(1000);
  });
});

describe('an expense in the book', () => {
  it('shows the vendor with the note but keeps the note as typed for editing', async () => {
    const e = await addExpense({ date: '2026-11-05', categoryId: await cat('tools'), amountFils: 12000, vatFils: 571, method: 'card', vendor: 'Ace Hardware', note: 'Bearing puller' });
    const line = expenseEntry(e);
    expect([line.note, line.vendor, line.expenseNote]).toEqual(['Ace Hardware · Bearing puller', 'Ace Hardware', 'Bearing puller']);
    await updateExpense(e.id, { note: 'Bearing puller set' });
    expect((await loadLedger()).entries.find((x) => x.id === e.id)!.note).toBe('Ace Hardware · Bearing puller set');
  });
});
