import { db } from '../db/db';
import { nonCashTotals } from '../domain/cash';
import { dubaiDate, onDubaiDay } from '../domain/dates';
import type { CashClosing } from '../domain/types';

/*
 * Which day closing counted a movement of the cash box (v0.23): the first one made after its operation's moment — the
 * cash counted then already held (or missed) that money. None — the cash box is still open for it.
 *
 * So an operation typed later for a day already counted goes into that day's closing: the count stays, the day's
 * difference is explained — in the open cash box it would be counted twice (the count already has it). The same for
 * an operation moved to another day, or one that became cash again. A closing's figures always follow what it holds:
 * its movements, the job payments taken by card or transfer in its time.
 */

/** The moment of an operation: its day, at the time of day it was recorded (typed on that very day — that moment). */
export const momentOf = (day: string, recordedAt: string): string => (dubaiDate(recordedAt) === day ? recordedAt : onDubaiDay(recordedAt, day));

/** The closing that counted the cash at a moment (undefined — not counted yet). */
export async function closingAt(moment: string): Promise<string | undefined> {
  let found: CashClosing | undefined;
  for (const c of await db.cashClosings.toArray()) if (c.closedAt > moment && (!found || c.closedAt < found.closedAt)) found = c;
  return found?.id;
}

/**
 * A closing's figures from what it holds now — its movements; the job payments by card and transfer between the
 * closing before it and itself — the counted cash stays, the difference moves. Returns the closing as it was, if any
 * figure changed. (Call inside a transaction over cashClosings, cashMovements and payments.)
 */
export async function recountClosing(id: string): Promise<CashClosing | undefined> {
  const c = await db.cashClosings.get(id);
  if (!c) return undefined;
  let cashInFils = 0;
  let cashOutFils = 0;
  for (const m of await db.cashMovements.where('closingId').equals(id).toArray()) {
    if (m.direction === 'in') cashInFils += m.amountFils;
    else cashOutFils += m.amountFils;
  }
  const since = (await db.cashClosings.toArray()).reduce((s, x) => (x.closedAt < c.closedAt && x.closedAt > s ? x.closedAt : s), '');
  const nonCash = nonCashTotals(await db.payments.filter((p) => p.receivedAt > since && p.receivedAt <= c.closedAt).toArray());
  const expectedFils = c.openingFils + cashInFils - cashOutFils;
  const now = { cashInFils, cashOutFils, expectedFils, diffFils: c.actualFils - expectedFils, cardTotalFils: nonCash.card, transferTotalFils: nonCash.transfer };
  if ((Object.keys(now) as (keyof typeof now)[]).every((k) => c[k] === now[k])) return undefined;
  await db.cashClosings.update(id, now);
  return c;
}

/**
 * An operation typed for an earlier day (a job paid, money in or out, a credit paid): its cash movement goes into the
 * closing that counted that day, and that closing's figures follow (a card payment — its card total). Nothing when
 * the day is not counted yet.
 */
export async function placeInDay(moment: string, movementId?: string): Promise<void> {
  await db.transaction('rw', db.cashMovements, db.cashClosings, db.payments, async () => {
    const cid = await closingAt(moment);
    if (!cid) return;
    if (movementId) await db.cashMovements.update(movementId, { closingId: cid });
    await recountClosing(cid);
  });
}
