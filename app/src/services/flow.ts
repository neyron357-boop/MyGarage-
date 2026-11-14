import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { flowStage, jobPhase, nothingToBill, stepToward, type Phase } from '../domain/flow';
import { discountBase, discountLines, grossOf } from '../domain/discount';
import { activeInvoice, canAmendInvoice } from '../domain/invoice';
import { byPosition, canReprice, isAwaitingClient, itemAmounts, unitGrossPrice } from '../domain/items';
import { canCloseUnpaid, canReopen, checkTransition, partsReady, reopenStage } from '../domain/stages';
import type { DecisionVia, OrderItem, SendVia, Stage } from '../domain/types';
import { syncDiscount } from './discount';
import { AppError } from './errors';
import { agreeNewPrice, recordDecisions, removeItem, restoreItem, sendVersion, updateItem, withdrawItems } from './estimate';
import { issueCreditNote } from './money';
import { bundleAmountDue, changeStage, loadOrderBundle, logEvent, stageContext, type OrderBundle } from './orders';

/**
 * The lazy flow: one-tap actions on a job ("agreed", "refused", "drop this line") that also keep its
 * stage in step — the manager never moves a job by hand.
 */

/** Where the job stands now: the one thing to do with it. */
export function phaseOf(b: OrderBundle): Phase {
  return jobPhase({ order: b.order, items: b.items, invoices: b.invoices, dueFils: bundleAmountDue(b) });
}

async function hop(orderId: string, to: Stage): Promise<boolean> {
  try {
    await changeStage(orderId, to);
    return true;
  } catch (e) {
    if (e instanceof AppError) return false;
    throw e;
  }
}

/** Put the job on the stage its lines, answers and parts call for (in several hops if needed). */
export async function syncStage(orderId: string): Promise<void> {
  for (let n = 0; n < 5; n++) {
    const b = await loadOrderBundle(orderId);
    if (!b) return;
    const want = flowStage(b.order.stage, phaseOf(b), partsReady(b.items));
    if (!want) return;
    if (await hop(orderId, want)) continue;
    const via = stepToward(b.order.stage, want);
    if (!via || !(await hop(orderId, via))) return;
  }
}

const viaOf = (sent: SendVia): DecisionVia => (sent === 'in_person' ? 'in_person' : sent === 'phone' ? 'phone' : 'messenger');

async function answer(items: OrderItem[], decision: 'approve' | 'decline'): Promise<void> {
  const byVersion = new Map<string, OrderItem[]>();
  for (const i of items) if (i.lastVersionId) byVersion.set(i.lastVersionId, [...(byVersion.get(i.lastVersionId) ?? []), i]);
  for (const [versionId, list] of byVersion) {
    const v = await db.versions.get(versionId);
    await recordDecisions(versionId, list.map((i) => ({ itemId: i.id, decision })), v ? viaOf(v.sentVia) : 'in_person');
  }
}

/** The customer's answer on lines that wait for it. */
export async function answerLines(itemIds: string[], decision: 'approve' | 'decline'): Promise<void> {
  const items = (await db.items.bulkGet(itemIds)).filter((i): i is OrderItem => !!i && isAwaitingClient(i));
  if (!items.length) return;
  await answer(items, decision);
  await syncStage(items[0].orderId);
}

/**
 * "The customer agrees": every line not agreed yet becomes agreed — those waiting for an answer, and
 * those never sent (told in person, recorded as a version like the quick invoice does).
 */
export async function approveAll(orderId: string): Promise<void> {
  const items = await db.items.where('orderId').equals(orderId).toArray();
  await answer(items.filter(isAwaitingClient), 'approve');
  if (items.some((i) => i.approvalState === 'draft')) {
    const v = await sendVersion(orderId, { via: 'in_person' });
    await recordDecisions(v.id, v.items.map((s) => ({ itemId: s.itemId, decision: 'approve' as const })), 'in_person');
  }
  await syncStage(orderId);
}

/**
 * "The customer refused": lines that wait are declined, lines never sent are dropped. With nothing
 * left to charge for the job is closed at once — the car just leaves; otherwise what was agreed
 * before is invoiced as usual.
 */
export async function refuseAll(orderId: string): Promise<'closed' | 'open'> {
  const items = await db.items.where('orderId').equals(orderId).toArray();
  if (activeInvoice(await db.invoices.where('orderId').equals(orderId).toArray())) throw new AppError('err.invoiceExists');
  await answer(items.filter(isAwaitingClient), 'decline');
  for (const i of items) if (i.approvalState === 'draft') await db.items.delete(i.id);
  const left = await db.items.where('orderId').equals(orderId).toArray();
  if (!nothingToBill(left)) {
    await syncDiscount(orderId);
    await syncStage(orderId);
    return 'open';
  }
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, { outcome: 'repair_declined', updatedAt: nowIso() });
    await logEvent(orderId, 'repair_declined', {});
  });
  await changeStage(orderId, 'closed');
  return 'closed';
}

/**
 * The car leaves and the manager takes no money for it — no payment, no debt, nothing in his cash or
 * money book. Either the customer settled with the garage's owner directly (`via: 'owner'` — the manager
 * does not know how; the revenue is still the garage's), or the money will not come at all (warranty,
 * goodwill). What was due is noted on the job (`waived`, with the amount, in the journal too), a signed
 * debt is written off; the invoice, payments and lines stay as they are. Reopening the job brings the
 * amount back.
 */
export async function closeUnpaid(orderId: string, via?: 'owner'): Promise<void> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  const due = bundleAmountDue(b);
  if (!canCloseUnpaid(b.order.stage, due)) throw new AppError('stageErr.notAllowed');
  const now = nowIso();
  const waived = via ? { at: now, fils: due, via } : { at: now, fils: due };
  const check = checkTransition(b.order.stage, 'closed', { ...stageContext(b), order: { ...b.order, waived }, amountDueFils: 0 });
  if (!check.ok) throw new AppError(check.reason);
  await db.transaction('rw', db.orders, db.debts, db.events, async () => {
    await db.orders.update(orderId, { waived, updatedAt: now });
    for (const d of b.debts) if (d.status === 'open') await db.debts.update(d.id, { status: 'written_off' });
    await logEvent(orderId, via === 'owner' ? 'closed_owner' : 'closed_unpaid', { fils: due });
  });
  await changeStage(orderId, 'closed');
}

/**
 * A new price for a line the customer has seen: per unit, with VAT — as the job shows it (kept to the
 * fils, "VAT in the price"). Waiting for the answer: the quote that went out no longer holds, so the line
 * is taken back — a draft at the new price, to send again. Agreed: the customer was told in person, and
 * the price goes in as a version of its own (`agreeNewPrice`). The journal keeps the old and the new
 * price. Returns what the line is now; null — the same price, nothing changed.
 */
export async function repriceLine(itemId: string, unitGrossFils: number): Promise<'draft' | 'agreed' | null> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  if (!canReprice(item)) throw new AppError('err.itemSent');
  if (!(unitGrossFils > 0)) throw new AppError('err.amountRequired');
  const [items, invoices] = await Promise.all([db.items.where('orderId').equals(item.orderId).toArray(), db.invoices.where('orderId').equals(item.orderId).toArray()]);
  if (activeInvoice(invoices)) throw new AppError('err.invoiceExists');
  const price = unitGrossPrice(item, unitGrossFils);
  const from = itemAmounts(item).gross;
  const to = itemAmounts({ ...item, ...price }).gross;
  if (to === from) return null;
  const waiting = item.approvalState === 'pending';
  // A discount given as an amount stays as it is: the lines must still be worth more than it.
  const next = items.map((i): OrderItem => (i.id === itemId ? { ...i, ...price, approvalState: waiting ? 'draft' : i.approvalState } : i));
  if (grossOf(discountBase(next)) + grossOf(discountLines(next)) < 0) throw new AppError('err.discountTooBig');
  if (waiting) {
    await withdrawItems([itemId]);
    await updateItem(itemId, price);
  } else {
    await agreeNewPrice(item, price);
  }
  await logEvent(item.orderId, 'price_changed', { itemId, title: item.titleRu || item.titleEn, from, to });
  await syncDiscount(item.orderId);
  await syncStage(item.orderId);
  return waiting ? 'draft' : 'agreed';
}

/** An agreed line that will not be done after all (the customer changed their mind, no part): off the job. */
export async function dropLine(itemId: string): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  if (item.approvalState !== 'approved') throw new AppError('err.itemSent');
  if (activeInvoice(await db.invoices.where('orderId').equals(item.orderId).toArray())) throw new AppError('err.invoiceExists');
  await db.transaction('rw', db.items, db.events, async () => {
    await db.items.update(itemId, { approvalState: 'cancelled', done: false, doneAt: undefined });
    await logEvent(item.orderId, 'items_removed', { count: 1, titles: item.titleRu || item.titleEn });
  });
  await syncDiscount(item.orderId);
  await syncStage(item.orderId);
}

/**
 * Several lines off the job at once (picked on the job screen): drafts are deleted and returned for
 * "Undo"; lines the customer was told are withdrawn (still waiting for the answer) or dropped
 * (agreed) — recorded as cancelled, the quotes sent stay as they were.
 */
export async function removeLines(itemIds: string[]): Promise<OrderItem[]> {
  const items = (await db.items.bulkGet(itemIds)).filter((i): i is OrderItem => !!i && i.kind !== 'discount');
  if (!items.length) return [];
  const orderId = items[0].orderId;
  if (activeInvoice(await db.invoices.where('orderId').equals(orderId).toArray())) throw new AppError('err.invoiceExists');
  const removed: OrderItem[] = [];
  for (const i of items.filter((x) => x.approvalState === 'draft')) {
    const r = await removeItem(i.id);
    if (r) removed.push(r);
  }
  const waiting = items.filter((x) => x.approvalState === 'pending').map((x) => x.id);
  if (waiting.length) await withdrawItems(waiting, { cancel: true });
  for (const i of items.filter((x) => x.approvalState === 'approved')) await dropLine(i.id);
  await syncDiscount(orderId);
  await syncStage(orderId);
  return removed;
}

/** "Undo" for removeLines: the drafts come back. */
export async function restoreLines(items: OrderItem[]): Promise<void> {
  if (!items.length) return;
  for (const i of items) await restoreItem(i);
  await syncDiscount(items[0].orderId);
  await syncStage(items[0].orderId);
}

/**
 * A closed (or cancelled) job back on the board: the car came back, or "Hand over" was tapped by
 * mistake. Its documents and money stay as they are; it goes back to "ready" when invoiced, else to
 * the workshop, and its lines move it on from there. The journal keeps the reopening.
 * History carried over from Eaglecart goes on as a job of the app: from now on it counts (what it owes,
 * its invoice), and the parts of its done lines are taken as fitted.
 */
export async function reopenJob(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  if (!canReopen(order)) throw new AppError('stageErr.notAllowed');
  const invoiced = !!activeInvoice(await db.invoices.where('orderId').equals(orderId).toArray());
  const to = reopenStage(order, invoiced);
  const now = nowIso();
  const history = !!order.imported?.history;
  await db.transaction('rw', db.orders, db.items, db.events, async () => {
    if (history) {
      const items = await db.items.where('orderId').equals(orderId).toArray();
      for (const i of items) if (i.kind === 'part' && i.done && (i.procurementStatus ?? 'needed') === 'needed') await db.items.update(i.id, { procurementStatus: 'installed' });
    }
    await db.orders.update(orderId, {
      ...(history && order.imported ? { imported: { ...order.imported, history: false } } : {}),
      stage: to,
      stageChangedAt: now,
      updatedAt: now,
      outcome: 'in_progress',
      archivedAt: undefined,
      // Closed without payment by mistake: what it owes counts again.
      waived: undefined,
      closedAt: undefined,
      deliveredAt: undefined,
      cancelReason: undefined,
    });
    await logEvent(orderId, 'reopened', { from: order.stage, to });
  });
  await syncStage(orderId);
}

/**
 * The job's lines in a new order (moved by hand): `ids` — the lines as they now stand. The listed lines take
 * the places they had among all the job's lines (refused, cancelled and discount lines keep theirs), and
 * every line gets its place, so a line added later goes to the end. The quote and the invoice list them so.
 * Not once the invoice is out (`amendInvoice` first): it lists them as they were.
 */
export async function reorderLines(orderId: string, ids: string[]): Promise<void> {
  await db.transaction('rw', db.items, db.invoices, async () => {
    if (activeInvoice(await db.invoices.where('orderId').equals(orderId).toArray())) throw new AppError('err.invoiceExists');
    const all = (await db.items.where('orderId').equals(orderId).toArray()).sort(byPosition);
    const listed = new Set(ids);
    const queue = ids.filter((id) => all.some((i) => i.id === id));
    const next = all.map((i) => (listed.has(i.id) ? queue.shift()! : i.id));
    for (let k = 0; k < next.length; k++) if (all.find((i) => i.id === next[k])?.position !== k) await db.items.update(next[k], { position: k });
  });
}

/**
 * An agreed line to change whole (its name, how many, the price): it goes back to a draft and is agreed
 * again like a new line — the answers given before stay in the history. Not once the invoice is out.
 */
export async function reviseLine(itemId: string): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  if (item.approvalState !== 'approved' || item.kind === 'discount') throw new AppError('err.itemSent');
  if (activeInvoice(await db.invoices.where('orderId').equals(item.orderId).toArray())) throw new AppError('err.invoiceExists');
  await db.transaction('rw', db.items, db.events, async () => {
    await db.items.update(itemId, { approvalState: 'draft', done: false, doneAt: undefined });
    await logEvent(item.orderId, 'item_revised', { itemId, title: item.titleRu || item.titleEn });
  });
  await syncStage(item.orderId);
}

/**
 * Lines to change once the invoice is out (a line forgotten, a price, a name, the order): an issued invoice
 * never changes, so it is cancelled by a credit note and the job is back at work — its lines can be changed,
 * added, moved, and "Done" issues the new invoice. Payments made count towards it. While the car is in the
 * garage and no debt is signed for the invoice (`canAmendInvoice`).
 */
export async function amendInvoice(orderId: string): Promise<void> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  const inv = activeInvoice(b.invoices);
  if (!inv) throw new AppError('err.notFound');
  if (b.debts.some((d) => d.status === 'open')) throw new AppError('err.amendDebt');
  if (!canAmendInvoice(b.order.stage, b.invoices, b.debts)) throw new AppError('stageErr.notAllowed');
  await issueCreditNote(inv.id, 'Invoice corrected');
  if (b.order.stage === 'quality_check' || b.order.stage === 'ready') await changeStage(orderId, 'in_progress', 'Invoice corrected');
  await syncStage(orderId);
}

/**
 * Off the board and back (a swipe on the board): only a mark — the job keeps its stage, documents and
 * money, a debt still shows under Money. Reopening a closed job brings it back on the board too.
 */
export async function archiveJob(orderId: string, archived: boolean): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  if (!!order.archivedAt === archived) return;
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, { archivedAt: archived ? nowIso() : undefined });
    await logEvent(orderId, archived ? 'archived' : 'unarchived', {});
  });
}

/** Parts of the job that are not bought yet. */
export function partsToFind(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => i.kind === 'part' && !i.customerSupplied && ['draft', 'pending', 'approved'].includes(i.approvalState) && (i.procurementStatus ?? 'needed') === 'needed');
}
