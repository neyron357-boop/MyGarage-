import { db, nextNumber, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import { formatDocNumber } from '../domain/invoice';
import type { Payment } from '../domain/types';
import { debtPaymentParts, loadDebtJobs } from './debts';
import { AppError } from './errors';
import { logEvent } from './orders';

/*
 * How an operation was cancelled before v0.23: marked cancelled and, if it was cash, reversed in the cash box — the
 * pairs («Расход −180», «Корректировка +180») stay in the cash box until deleted. No screen cancels any more (an
 * operation is deleted or changed — services/entries.ts); the data this left is still on the phones, and the tests
 * make it with these.
 */

const receiptYear = () => Number(dubaiDate().slice(0, 4));

/**
 * Cancel an entry made by mistake. Nothing is deleted: the entry is marked cancelled and leaves the
 * book; if it was cash, the cash book gets the opposite movement, so the cash in the box still adds up.
 */
export async function voidIncome(id: string): Promise<void> {
  // A debt payment gives back to each job what it paid on it.
  if ((await db.incomes.get(id))?.category === 'debt') return voidDebtPayment(id);
  await db.transaction('rw', db.incomes, db.cashMovements, async () => {
    const i = await db.incomes.get(id);
    if (!i || i.voidedAt) return;
    const now = nowIso();
    await db.incomes.update(id, { voidedAt: now });
    if (i.method === 'cash') {
      await db.cashMovements.add({ id: uid(), at: now, direction: 'out', amountFils: i.amountFils, reason: 'adjustment', incomeId: id, note: i.note });
    }
  });
}

export async function voidExpense(id: string): Promise<void> {
  await db.transaction('rw', db.expenses, db.cashMovements, db.creditPayments, async () => {
    const e = await db.expenses.get(id);
    if (!e || e.voidedAt) return;
    // On credit with money already paid towards it: those payments are cancelled first (each moved money).
    if (e.method === 'credit' && (await db.creditPayments.where('expenseId').equals(id).toArray()).some((p) => !p.voidedAt)) throw new AppError('err.creditPaid');
    const now = nowIso();
    await db.expenses.update(id, { voidedAt: now });
    if (e.method === 'cash') {
      await db.cashMovements.add({ id: uid(), at: now, direction: 'in', amountFils: e.amountFils, reason: 'adjustment', expenseId: id, note: e.vendor ?? e.note });
    }
  });
}

/**
 * A "debt payment" entered by mistake. Nothing is deleted: the income is marked cancelled (cash — the opposite
 * movement in the cash book), and each job gets back what it was paid — a refund that carries the same income's
 * id, so the job owes it again. A debt signed for the job is open again.
 */
export async function voidDebtPayment(incomeId: string): Promise<void> {
  const touched = new Set<string>();
  await db.transaction('rw', [db.incomes, db.cashMovements, db.payments, db.orders, db.counters, db.events], async () => {
    const i = await db.incomes.get(incomeId);
    if (!i || i.voidedAt) return;
    const now = nowIso();
    await db.incomes.update(incomeId, { voidedAt: now });
    if (i.method === 'cash') await db.cashMovements.add({ id: uid(), at: now, direction: 'out', amountFils: i.amountFils, reason: 'adjustment', incomeId, note: i.note });
    for (const part of await debtPaymentParts(incomeId)) {
      const order = await db.orders.get(part.orderId);
      if (!order) continue;
      const n = await nextNumber(`receipt-${receiptYear()}`);
      const p: Payment = {
        id: uid(),
        orderId: part.orderId,
        customerId: order.customerId,
        kind: 'refund',
        method: i.method,
        amountFils: part.amountFils,
        receiptNumber: formatDocNumber('RC', receiptYear(), n),
        receivedAt: now,
        incomeId,
      };
      await db.payments.add(p);
      await logEvent(part.orderId, 'payment', { kind: p.kind, method: p.method, amount: p.amountFils, receipt: p.receiptNumber, debt: true, cancelled: true });
      touched.add(part.orderId);
    }
  });
  if (!touched.size) return;
  const owing = new Set((await loadDebtJobs()).map((d) => d.order.id));
  for (const orderId of touched) {
    if (!owing.has(orderId)) continue;
    const paid = (await db.debts.where('orderId').equals(orderId).toArray()).filter((d) => d.status === 'paid').sort((a, b) => b.signedAt.localeCompare(a.signedAt))[0];
    if (paid) await db.debts.update(paid.id, { status: 'open' });
  }
}

/** A payment of a credit entered by mistake: marked cancelled (cash — the opposite movement), the debt is owed again. */
export async function voidCreditPayment(id: string): Promise<void> {
  await db.transaction('rw', db.creditPayments, db.cashMovements, async () => {
    const p = await db.creditPayments.get(id);
    if (!p || p.voidedAt) return;
    const now = nowIso();
    await db.creditPayments.update(id, { voidedAt: now });
    if (p.method === 'cash') await db.cashMovements.add({ id: uid(), at: now, direction: 'in', amountFils: p.amountFils, reason: 'adjustment', creditPaymentId: id, note: p.note });
  });
}

