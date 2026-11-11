import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { loadLedger } from './ledger';
import { addCashMovement, addExpense } from './money';
import { addProofs, proofIndex, proofsOf, removeProof, takesProofs } from './proofs';
import { ensureSeed } from './seed';

const photo = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n])], { type: 'image/jpeg' });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('proofs of money spent', () => {
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

  it('takes no proofs on money in or on a day closing', async () => {
    expect(takesProofs({ source: 'payment', kind: 'in' })).toBe(false);
    expect(takesProofs({ source: 'income', kind: 'in' })).toBe(false);
    expect(takesProofs({ source: 'closing', kind: 'out' })).toBe(false);
    expect(takesProofs({ source: 'payment', kind: 'out' })).toBe(true);
    await expect(addProofs({ id: 'x', source: 'income', kind: 'in' }, [photo(1)])).rejects.toThrow();
  });
});
