import { db } from '../db/db';
import { lockedMonthOf, monthLocked, withMonthLock, type Month } from '../domain/monthLock';
import type { Customer } from '../domain/types';
import { AppError } from './errors';

/*
 * Closed months of a customer's account (v0.69; the rule — domain/monthLock.ts). Closing and opening a month, and the
 * checks the services that change a job make first: `assertJobOpen` — a job gone in a closed month is not changed;
 * `assertDayOpen` — nothing new goes on a day of a closed month (a job typed in later, an invoice).
 */

/** Close a month of the customer's account, or open it again. */
export async function setMonthLocked(customerId: string, month: Month, locked: boolean): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError('err.notFound');
  await db.transaction('rw', db.customers, async () => {
    const c = await db.customers.get(customerId);
    if (!c) throw new AppError('err.notFound');
    await db.customers.update(customerId, { lockedMonths: withMonthLock(c, month, locked) });
  });
}

/** A job of a closed month: not changed (its lines after the invoice, a discount, deleted, reopened, moved, written off). */
export async function assertJobOpen(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) return;
  const [invoices, customer] = await Promise.all([db.invoices.where('orderId').equals(orderId).toArray(), db.customers.get(order.customerId)]);
  if (lockedMonthOf(order, invoices, customer)) throw new AppError('err.monthLocked');
}

/** Nothing new on a day of the customer's closed month (YYYY-MM-DD). */
export function assertDayOpen(customer: Pick<Customer, 'lockedMonths'> | undefined, day: string): void {
  if (monthLocked(customer, day.slice(0, 7))) throw new AppError('err.monthLocked');
}
