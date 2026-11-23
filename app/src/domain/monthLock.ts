import { dubaiDate } from './dates';
import { activeInvoice } from './invoice';
import type { Customer, Invoice, Order } from './types';

/*
 * Closed months of a customer's account (v0.69, the user: «возможность добавить замок на месяцы, которых нельзя
 * редактировать… это важно для финанса»). A month is closed per customer (`Customer.lockedMonths`): its account as it
 * stands — what was invoiced, what each job came to — is what was agreed with the customer. While it is closed a job on
 * the account in that month (its car gone; the month — its invoice's day, as the account and the statement count it)
 * is not changed: no lines after the invoice, no discount, not deleted, not reopened, not moved to another day, not
 * written off; and nothing new goes into that month — no job typed in on one of its days, no invoice issued on one.
 * Payments are not changes of the month: they come in as always. Pure.
 */

/** YYYY-MM */
export type Month = string;

/** The month a job stands on its customer's account: its invoice's day, else the day its car left, else its own. */
export function jobMonth(order: Pick<Order, 'deliveredAt' | 'closedAt' | 'createdAt'>, invoices: Invoice[]): Month {
  return dubaiDate(activeInvoice(invoices)?.issuedAt ?? order.deliveredAt ?? order.closedAt ?? order.createdAt).slice(0, 7);
}

/** Is this month of the customer's account closed. */
export const monthLocked = (customer: Pick<Customer, 'lockedMonths'> | undefined, month: Month): boolean => !!customer?.lockedMonths?.includes(month);

/** A job on the account (its car gone) in a closed month — the month, else nothing. */
export function lockedMonthOf(order: Pick<Order, 'stage' | 'deliveredAt' | 'closedAt' | 'createdAt'>, invoices: Invoice[], customer: Pick<Customer, 'lockedMonths'> | undefined): Month | undefined {
  if (order.stage !== 'delivered' && order.stage !== 'closed') return undefined;
  const month = jobMonth(order, invoices);
  return monthLocked(customer, month) ? month : undefined;
}

/** The customer's closed months with this one closed or opened: one each, in order. */
export function withMonthLock(customer: Pick<Customer, 'lockedMonths'>, month: Month, locked: boolean): string[] | undefined {
  const set = new Set(customer.lockedMonths ?? []);
  if (locked) set.add(month);
  else set.delete(month);
  const list = [...set].sort();
  return list.length ? list : undefined;
}
