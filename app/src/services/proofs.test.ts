import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { withEntries, type LedgerSource } from '../domain/ledger';
import type { CashMovement } from '../domain/types';
import { addIncome, loadLedger, voidExpense } from './ledger';
import { addCashMovement, addExpense, addPayment, cashState } from './money';
import { checkIn } from './orders';
import { addProofs, proofIndex, proofsOf, removeProof, takesProofs } from './proofs';
import { ensureSeed } from './seed';

const photo = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n])], { type: 'image/jpeg' });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('proofs of money', () => {
  it('keeps photos with any money out, the receipt first, without touching the entry', async () => {
    const cat = (await db.expenseCategories.toArray())[0];
    const exp = await addExpense({ date: '2026-11-06', categoryId: cat.id, amountFils: 2646, vatFils: 0, method: 'cash', note: 'Oil filter', receipt: photo(1) });
    await addCashMovement({ direction: 'out', amountFils: 5000, reason: 'parts_purchase', note: 'Oil filter' });
    const book = await loadLedger();
    const expense = book.entries.find((e) => e.id === exp.id)!;
    const movement = book.entries.find((e) => e.source === 'movement')!;
    expect(takesProofs(expense)).toBe(true);
    expect(takesProofs(movement)).toBe(true);

    const before = await db.expenses.get(exp.id);
    await addProofs(expense, [photo(2), photo(3)]);
    await addProofs(movement, [photo(4)]);
    expect(await db.expenses.get(exp.id)).toEqual(before);

    const list = await proofsOf(exp.id);
    expect(list.map((m) => m.slot)).toEqual(['receipt', 'proof', 'proof']);
    expect(list[0].id).toBe(exp.receiptMediaId);
    expect((await proofsOf(movement.id)).map((m) => m.ownerType)).toEqual(['movement']);
    expect(await proofIndex(book.entries.map((e) => e.id))).toEqual(new Map([[exp.id, exp.receiptMediaId], [movement.id, (await proofsOf(movement.id))[0].id]]));

    // A wrong photo goes; the receipt the expense points to stays.
    await removeProof(list[1].id);
    expect((await proofsOf(exp.id)).length).toBe(2);
    await expect(removeProof(exp.receiptMediaId!)).rejects.toThrow();
  });

  it('keeps photos with money in too — a job’s payment, an income — not with a day closing', async () => {
    expect(['payment', 'income', 'expense', 'movement', 'closing'].map((source) => takesProofs({ source: source as LedgerSource }))).toEqual([true, true, true, true, false]);
    await expect(addProofs({ id: 'x', source: 'closing' }, [photo(1)])).rejects.toThrow();
    const income = await addIncome({ date: '2026-11-10', category: 'sales', amountFils: 1500, method: 'cash', note: 'WD-40' });
    const [m] = await addProofs({ id: income.id, source: 'income' }, [photo(5)]);
    expect([m.ownerType, m.slot]).toEqual(['income', 'proof']);
    expect((await proofsOf(income.id)).map((x) => x.id)).toEqual([m.id]);
  });

  it('opens each line of the cash box as its line of the book, with the photos kept there', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'T', number: '40512' }, make: 'Toyota', model: 'Hiace', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const pay = await addPayment(o.id, { kind: 'prepayment', method: 'cash', amountFils: 24675 });
    const cat = (await db.expenseCategories.toArray())[0];
    const exp = await addExpense({ date: dubaiDate(), categoryId: cat.id, amountFils: 2646, vatFils: 0, method: 'cash', vendor: 'Al Maroof', note: 'Oil filter' });
    const inc = await addIncome({ date: dubaiDate(), category: 'sales', amountFils: 1000, method: 'cash', note: 'WD-40' });
    await addCashMovement({ direction: 'out', amountFils: 9072, reason: 'parts_purchase', note: 'Engine oil 5W-30' });
    // A mistaken expense, cancelled: its money out and the reversal stay in the box, the book leaves them out.
    const wrong = await addExpense({ date: dubaiDate(), categoryId: cat.id, amountFils: 500, vatFils: 0, method: 'cash', note: 'typo' });
    await voidExpense(wrong.id);

    const lines = withEntries((await cashState()).lines, (await loadLedger()).entries);
    const of = (pick: (m: CashMovement) => boolean) => lines.find((l) => pick(l.m))!.entry;
    expect(of((m) => m.paymentId === pay.id)).toMatchObject({ source: 'payment', id: pay.id, kind: 'in', orderId: o.id, vehicleId: o.vehicleId });
    expect(of((m) => m.expenseId === exp.id && m.direction === 'out')).toMatchObject({ source: 'expense', id: exp.id, vendor: 'Al Maroof' });
    expect(of((m) => m.incomeId === inc.id)).toMatchObject({ source: 'income', id: inc.id, category: 'sales' });
    const parts = of((m) => m.reason === 'parts_purchase');
    expect(parts).toMatchObject({ source: 'movement', kind: 'out', category: 'parts_purchase', note: 'Engine oil 5W-30' });
    const reversal = lines.filter((l) => l.m.expenseId === wrong.id);
    expect(reversal.map((l) => [l.entry.source, l.entry.id === l.m.id, l.entry.cashAfter === l.after])).toEqual([
      ['movement', true, true],
      ['movement', true, true],
    ]);

    // A photo added from the cash box is the one the book shows, and back.
    await addProofs(of((m) => m.paymentId === pay.id), [photo(6)]);
    await addProofs(parts, [photo(7)]);
    const index = await proofIndex(lines.map((l) => l.entry.id));
    expect([...index.keys()].sort()).toEqual([pay.id, parts.id].sort());
    expect((await proofsOf(pay.id)).map((m) => m.ownerType)).toEqual(['payment']);
  });
});
