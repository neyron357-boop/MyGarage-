import { db } from '../db/db';
import { activeInvoice } from '../domain/invoice';
import { lastChange } from '../domain/flow';
import type { Customer } from '../domain/types';
import { loadDebtors } from './debts';
import { bundleAmountDue, loadRowBundles, type OrderBundle } from './orders';

/*
 * A chat's «＋» for its customer (v0.80, «быстрые действия касательно этого клиента: быстро отправить смету или инвойс,
 * быстро создать новый заказ…»): which of the customer's jobs a document can go from, and what they owe. Read when the
 * «＋» is pressed — nothing of it is kept.
 */

/** How many jobs the quick actions offer: the job of this screen and the newest others. */
const MAX_JOBS = 4;

export interface ChatJobs {
  customer?: Customer;
  /** The job of the screen the chat is on first, then the open ones and those still owed for — the newest first. */
  jobs: OrderBundle[];
  /** What the customer owes in all (their statement can go): 0 — nothing. */
  owesFils: number;
}

/** A company's own group chat (`Customer.waGroup`, v0.79): whose group it is. */
export async function customerOfGroup(chatId: string): Promise<Customer | undefined> {
  return db.customers.filter((c) => c.waGroup?.chat === chatId).first();
}

export async function chatJobs(customerId: string | undefined, jobId?: string): Promise<ChatJobs> {
  const focus = jobId ? await db.orders.get(jobId) : undefined;
  const id = customerId ?? focus?.customerId;
  if (!id) return { jobs: [], owesFils: 0 };
  const [customer, orders, debtors] = await Promise.all([db.customers.get(id), db.orders.where('customerId').equals(id).toArray(), loadDebtors()]);
  const bundles = (await loadRowBundles(orders.filter((o) => o.stage !== 'cancelled' || o.id === jobId))).filter((b): b is OrderBundle => !!b);
  // Worth a document: still open, its invoice still owed, or the job this chat is on.
  const worth = bundles.filter((b) => b.order.id === jobId || !['closed', 'cancelled'].includes(b.order.stage) || (!!activeInvoice(b.invoices) && bundleAmountDue(b) > 0));
  const at = new Map(worth.map((b) => [b.order.id, lastChange(b)]));
  worth.sort((a, b) => (a.order.id === jobId ? -1 : b.order.id === jobId ? 1 : (at.get(b.order.id) ?? '').localeCompare(at.get(a.order.id) ?? '')));
  return { customer, jobs: worth.slice(0, MAX_JOBS), owesFils: debtors.find((d) => d.customer.id === id)?.totalFils ?? 0 };
}
