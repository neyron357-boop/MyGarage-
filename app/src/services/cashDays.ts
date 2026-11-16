import { db } from '../db/db';
import { nonCashTotals } from '../domain/cash';
import { dubaiDate, nowIso } from '../domain/dates';
import type { CashClosing, Payment } from '../domain/types';

/*
 * Which day closing counted an operation (v0.23.1) — the cash counted then already held, or missed, its money:
 * - typed on its own day: the first closing made after it was typed (two counts of one day keep their order);
 * - typed on a later day, or moved to an earlier one: that day's own count — the last closing made on that day, else
 *   the first one made after it. Its time of day is not known, and is not guessed from the clock it was typed at;
 * - dated today but typed on another day (moved to today): not counted yet — as one typed now.
 * None — the cash box is still open for it.
 *
 * A cash movement keeps the closing it belongs to (`closingId`): an operation typed for a day already counted goes
 * into that day's closing (in the open cash box it would be counted twice — the count had it already); so does one
 * moved there or become cash again. A closing's figures always follow what it holds: its movements, and the job
 * payments by card or transfer it counted. The count stays; its difference moves.
 */

const byTime = (a: CashClosing, b: CashClosing) => a.closedAt.localeCompare(b.closedAt);

/** The closing (id) that counted an operation of `day` typed at `typedAt`; `sorted` by the time they were made. */
export function countedBy(day: string, typedAt: string, sorted: CashClosing[], now = nowIso()): string | undefined {
  if (dubaiDate(typedAt) === day) return sorted.find((c) => c.closedAt > typedAt)?.id;
  if (day >= dubaiDate(now)) return sorted.find((c) => c.closedAt > now)?.id;
  let last: CashClosing | undefined;
  for (const c of sorted) {
    const d = dubaiDate(c.closedAt);
    if (d === day) last = c;
    else if (d > day) return (last ?? c).id;
  }
  return last?.id;
}

/** The closing that counted an operation of `day` typed at `typedAt` (undefined — not counted yet). */
export async function closingFor(day: string, typedAt: string): Promise<string | undefined> {
  return countedBy(day, typedAt, (await db.cashClosings.toArray()).sort(byTime));
}

/** A job payment's day and when it was typed (one from before v0.23.1 — at the moment it was received). */
export const paymentDay = (p: Pick<Payment, 'receivedAt' | 'typedAt'>) => ({ day: dubaiDate(p.receivedAt), typedAt: p.typedAt ?? p.receivedAt });

/** The closing that counted a job's payment (its card total, or its cash movement). */
export async function closingOfPayment(p: Pick<Payment, 'receivedAt' | 'typedAt'>): Promise<string | undefined> {
  const d = paymentDay(p);
  return closingFor(d.day, d.typedAt);
}

/**
 * A closing's figures from what it holds now — its movements; the job payments by card and transfer it counted — the
 * counted cash stays, the difference moves. Returns the closing as it was, if any figure changed. (Call inside a
 * transaction over cashClosings, cashMovements and payments.)
 */
export async function recountClosing(id: string): Promise<CashClosing | undefined> {
  const sorted = (await db.cashClosings.toArray()).sort(byTime);
  const c = sorted.find((x) => x.id === id);
  if (!c) return undefined;
  let cashInFils = 0;
  let cashOutFils = 0;
  for (const m of await db.cashMovements.where('closingId').equals(id).toArray()) {
    if (m.direction === 'in') cashInFils += m.amountFils;
    else cashOutFils += m.amountFils;
  }
  const now = nowIso();
  const counted = (await db.payments.filter((p) => p.method !== 'cash').toArray()).filter((p) => {
    const d = paymentDay(p);
    return countedBy(d.day, d.typedAt, sorted, now) === id;
  });
  const nonCash = nonCashTotals(counted);
  const expectedFils = c.openingFils + cashInFils - cashOutFils;
  const next = { cashInFils, cashOutFils, expectedFils, diffFils: c.actualFils - expectedFils, cardTotalFils: nonCash.card, transferTotalFils: nonCash.transfer };
  if ((Object.keys(next) as (keyof typeof next)[]).every((k) => c[k] === next[k])) return undefined;
  await db.cashClosings.update(id, next);
  return c;
}

/**
 * An operation typed for an earlier day (a job paid, money in or out, a credit paid): its cash movement goes into the
 * closing that counted that day, and that closing's figures follow (a card payment — its card total). Nothing when the
 * day is not counted yet.
 */
export async function placeInDay(day: string, typedAt: string, movementId?: string): Promise<void> {
  await db.transaction('rw', db.cashMovements, db.cashClosings, db.payments, async () => {
    const cid = await closingFor(day, typedAt);
    if (!cid) return;
    if (movementId) await db.cashMovements.update(movementId, { closingId: cid });
    await recountClosing(cid);
  });
}
