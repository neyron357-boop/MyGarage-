import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { activeInvoice } from '../domain/invoice';
import { chosenLines, freshOptionLines, liveOptions } from '../domain/quoteOptions';
import type { QuoteOption } from '../domain/types';
import { AppError } from './errors';
import { setUnconfirmed, syncStage } from './flow';
import { logEvent } from './orders';

/*
 * The quote's options of a job (v0.90, the owner's note #72; the rules — domain/quoteOptions.ts): kept on the job
 * (`Order.quoteOptions`), changed only here. Its lines stay as they are until the customer chooses one.
 */

async function change(orderId: string, edit: (options: QuoteOption[]) => QuoteOption[]): Promise<QuoteOption[]> {
  return db.transaction('rw', db.orders, db.items, db.invoices, async () => {
    const [order, items, invoices] = await Promise.all([db.orders.get(orderId), db.items.where('orderId').equals(orderId).toArray(), db.invoices.where('orderId').equals(orderId).toArray()]);
    if (!order) throw new AppError('err.notFound');
    if (activeInvoice(invoices)) throw new AppError('err.invoiceExists');
    const next = edit(liveOptions(items, order.quoteOptions));
    await db.orders.update(orderId, { quoteOptions: next });
    return next;
  });
}

/** A new option: the last one's lines (the first — the job's lines that count now). */
export async function addQuoteOption(orderId: string): Promise<QuoteOption> {
  const items = await db.items.where('orderId').equals(orderId).toArray();
  let made: QuoteOption | undefined;
  await change(orderId, (all) => {
    made = { id: uid(), name: '', itemIds: freshOptionLines(items, all), createdAt: nowIso() };
    return [...all, made];
  });
  return made!;
}

/** A line in the option or out of it. */
export async function toggleOptionLine(orderId: string, optionId: string, itemId: string): Promise<void> {
  await change(orderId, (all) => all.map((o) => (o.id !== optionId ? o : { ...o, itemIds: o.itemIds.includes(itemId) ? o.itemIds.filter((x) => x !== itemId) : [...o.itemIds, itemId] })));
}

export async function renameQuoteOption(orderId: string, optionId: string, name: string): Promise<void> {
  await change(orderId, (all) => all.map((o) => (o.id === optionId ? { ...o, name: name.trim().slice(0, 40) } : o)));
}

export async function removeQuoteOption(orderId: string, optionId: string): Promise<void> {
  await change(orderId, (all) => all.filter((o) => o.id !== optionId));
}

/** Gone to the customer (after «Отправить» really sent them). */
export async function markOptionsSent(orderId: string, ids: string[]): Promise<void> {
  const at = nowIso();
  await change(orderId, (all) => all.map((o) => (ids.includes(o.id) ? { ...o, sentAt: at } : o)));
  await logEvent(orderId, 'quote_options_sent', { options: ids.length });
}

/**
 * The customer chose this option: its lines are the job's (confirmed), the job's other drafts «не подтверждена» (v0.88 —
 * on the job, out of every total, a swipe brings each back). Then the job goes on as any: «Отправить» or «Согласовано».
 */
export async function chooseQuoteOption(orderId: string, optionId: string): Promise<void> {
  const [order, items] = await Promise.all([db.orders.get(orderId), db.items.where('orderId').equals(orderId).toArray()]);
  const option = liveOptions(items, order?.quoteOptions).find((o) => o.id === optionId);
  if (!order || !option) throw new AppError('err.notFound');
  const { confirm, unconfirm } = chosenLines(items, option);
  if (confirm.length) await setUnconfirmed(confirm, false);
  if (unconfirm.length) await setUnconfirmed(unconfirm, true);
  const at = nowIso();
  await change(orderId, (all) => all.map((o) => (o.id === optionId ? { ...o, chosenAt: at } : { ...o, chosenAt: undefined })));
  await logEvent(orderId, 'quote_option_chosen', { option: optionId });
  await syncStage(orderId);
}

/** The options as they were (the «Отменить» of a removed one). */
export async function putQuoteOptions(orderId: string, options: QuoteOption[]): Promise<void> {
  await change(orderId, () => options);
}
