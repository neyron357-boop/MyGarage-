import { db, uid } from '../db/db';
import { binOf, draftLike, withoutRemoved, withRemoved } from '../domain/bin';
import type { BoardStatus } from '../domain/boardStatus';
import { nowIso } from '../domain/dates';
import { flowStage, isToSend, jobPhase, nothingToBill, stepToward, type Phase } from '../domain/flow';
import { discountBase, discountLines, grossOf } from '../domain/discount';
import { activeInvoice, canAmendInvoice } from '../domain/invoice';
import { byPosition, canReprice, isAwaitingClient, itemAmounts, unitGrossPrice } from '../domain/items';
import { canCloseUnpaid, canReopen, checkTransition, partsReady, reopenStage } from '../domain/stages';
import type { DecisionVia, OrderItem, SendVia, Stage } from '../domain/types';
import { syncDiscount } from './discount';
import { syncLabourNames } from './labourName';
import { isCharge } from './labourLine';
import { AppError } from './errors';
import { assertJobOpen } from './monthLock';
import { agreeNewPrice, recordDecisions, removeItem, restoreItem, sendVersion, setDone, updateItem, withdrawItems } from './estimate';
import { createDebt, issueCreditNote } from './money';
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

/** Where a car can leave from with an invoice: the workshop's stages (the invoice makes "ready" reachable from each). */
const LEAVES_FROM: Stage[] = ['intake', 'diagnostics', 'awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check', 'ready'];

/** The car can leave now with the money owed (the payment sheet's "On credit"): invoiced, money due, still at the garage, no debt signed yet. */
export function canLeaveOnDebt(b: OrderBundle): boolean {
  return !!activeInvoice(b.invoices) && bundleAmountDue(b) > 0 && LEAVES_FROM.includes(b.order.stage) && !b.debts.some((d) => d.status === 'open');
}

/**
 * The car leaves now, the money comes later: the customer signs the debt here and the job is gone with money
 * due ("debt", red on the board) until it is paid — the payment that clears it closes the job and the debt
 * (services/money.ts). A debt signed earlier is taken as it is.
 */
export async function leaveOnDebt(orderId: string, debt?: { amountFils: number; dueDate: string; signature: Blob }): Promise<void> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  if (!activeInvoice(b.invoices) || bundleAmountDue(b) <= 0 || !LEAVES_FROM.includes(b.order.stage)) throw new AppError('stageErr.notAllowed');
  const signed = b.debts.some((d) => d.status === 'open');
  if (!signed && !debt) throw new AppError('sign.required');
  if (!signed && debt) await createDebt(orderId, debt.amountFils, debt.dueDate, debt.signature);
  if (b.order.stage !== 'ready') await changeStage(orderId, 'ready');
  await changeStage(orderId, 'delivered');
}

/** A booked car has come: it is in, and — as at check-in — goes straight on to diagnostics. */
export async function carArrived(orderId: string): Promise<void> {
  // Here now: no more a request (v0.70) — in work, unless put elsewhere by hand.
  const o = await db.orders.get(orderId);
  if (o?.boardTab === 'request') await db.orders.update(orderId, { boardTab: undefined });
  await changeStage(orderId, 'intake');
  await syncStage(orderId);
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
  // (Not the unconfirmed ones — v0.88: they stay as they are.)
  if (items.some(isToSend)) {
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
  // A month closed (v0.69): what its jobs owe is not written off.
  await assertJobOpen(orderId);
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

/**
 * A line's quantity put right (v0.70: «LEFT & RIGHT» × 1 — the name asks for two, domain/sides.ts): a draft simply; one
 * waiting for the answer — taken back to a draft with it; an agreed one — agreed again in person at the new sum (as a new
 * price is, `agreeNewPrice`). Not after the invoice.
 */
export async function setLineQty(itemId: string, qty: number): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  if (!(qty > 0)) throw new AppError('err.amountRequired');
  if (qty === item.qty) return;
  if (activeInvoice(await db.invoices.where('orderId').equals(item.orderId).toArray())) throw new AppError('err.invoiceExists');
  if (item.approvalState === 'draft') await updateItem(itemId, { qty });
  else if (item.approvalState === 'pending') {
    await withdrawItems([itemId]);
    await updateItem(itemId, { qty });
  } else if (item.approvalState === 'approved') await agreeNewPrice(item, { qty });
  else throw new AppError('err.itemSent');
  await logEvent(item.orderId, 'updated', { fields: ['qty'], itemId, from: item.qty, to: qty });
  await syncDiscount(item.orderId);
  await syncStage(item.orderId);
}

/** Its price is for all its name asks for (v0.70): the line is not asked about again (until its name asks for more). */
export async function noteLineQty(itemId: string, count: number): Promise<void> {
  if (!(await db.items.get(itemId))) throw new AppError('err.notFound');
  await db.items.update(itemId, { qtyNoted: count });
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

/** A line done (or not after all): a part fitted counts as there, so the job waiting for its parts goes on. */
export async function lineDone(itemId: string, done: boolean): Promise<void> {
  await setDone(itemId, done);
  const item = await db.items.get(itemId);
  if (item) await syncStage(item.orderId);
}

/**
 * Lines waiting for the customer's answer taken back: drafts again (to change them and tell again), or —
 * with `cancel` — off the job (kept in the history as cancelled). The discount and the stage follow what
 * is left: with the rest agreed, the work goes on.
 */
export async function takeBack(itemIds: string[], opts: { cancel?: boolean } = {}): Promise<void> {
  const first = itemIds.length ? await db.items.get(itemIds[0]) : undefined;
  if (!first || !(await withdrawItems(itemIds, opts))) return;
  await syncDiscount(first.orderId);
  await syncLabourNames(first.orderId);
  await syncStage(first.orderId);
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
  // Into the job's bin, as they were (v0.68): to bring back or to see their prices later. Its labour charge taken off by
  // hand (v0.90, #70) — the app does not add one again to this job.
  const labourOff = items.some(isCharge);
  if (removed.length || labourOff) {
    const order = await db.orders.get(orderId);
    if (order) await db.orders.update(orderId, { ...(removed.length ? { removedLines: withRemoved(order, removed, nowIso()) } : {}), ...(labourOff ? { labourOff: true as const } : {}) });
  }
  const waiting = items.filter((x) => x.approvalState === 'pending').map((x) => x.id);
  if (waiting.length) await withdrawItems(waiting, { cancel: true });
  for (const i of items.filter((x) => x.approvalState === 'approved')) await dropLine(i.id);
  await syncDiscount(orderId);
  await syncLabourNames(orderId);
  await syncStage(orderId);
  return removed;
}

/**
 * Lines marked not confirmed yet — or confirmed (v0.88, the owner: «сделать так, чтобы можно было отмечать позиции как
 * неподтверждённые и они чтобы не попадали в смету или инвойс пока»): drafts only. While unconfirmed a line stays on the
 * job (its price, its supplier's answers, its photo) and is out of «Отправить», «Согласовано», «Готово» and every total;
 * confirmed — a draft as any other, it goes with the next quote. Not after the invoice (as any line's change).
 */
export async function setUnconfirmed(itemIds: string[], on: boolean): Promise<void> {
  const items = (await db.items.bulkGet(itemIds)).filter((i): i is OrderItem => !!i && i.approvalState === 'draft' && i.kind !== 'discount' && !!i.unconfirmed !== on);
  if (!items.length) return;
  const orderId = items[0].orderId;
  if (activeInvoice(await db.invoices.where('orderId').equals(orderId).toArray())) throw new AppError('err.invoiceExists');
  await db.transaction('rw', db.items, db.events, async () => {
    for (const i of items) await db.items.update(i.id, { unconfirmed: on ? true : undefined });
    await logEvent(orderId, on ? 'lines_unconfirmed' : 'lines_confirmed', { n: items.length });
  });
  await syncDiscount(orderId);
  await syncLabourNames(orderId);
  await syncStage(orderId);
}

/** "Undo" for removeLines: the drafts come back (out of the bin). */
export async function restoreLines(items: OrderItem[]): Promise<void> {
  if (!items.length) return;
  for (const i of items) await restoreItem(i);
  const order = await db.orders.get(items[0].orderId);
  if (order?.removedLines) await db.orders.update(order.id, { removedLines: withoutRemoved(order, items.map((i) => i.id)) });
  await syncDiscount(items[0].orderId);
  await syncLabourNames(items[0].orderId);
  await syncStage(items[0].orderId);
}

/**
 * Lines back from the job's bin (v0.68), drafts again: a deleted one as itself (its photos, its number, its price), a
 * cancelled or refused one as a new line like it (it stays in the history, out of the bin); a job closed (refused) is
 * reopened first (v0.70). Not after the invoice —
 * as lines are not removed then. Returns how many came back.
 */
export async function restoreFromBin(orderId: string, ids: string[]): Promise<number> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  if (activeInvoice(await db.invoices.where('orderId').equals(orderId).toArray())) throw new AppError('err.invoiceExists');
  const wanted = new Set(ids);
  const back = binOf(order, await db.items.where('orderId').equals(orderId).toArray()).filter((l) => wanted.has(l.id));
  if (!back.length) return 0;
  // A job closed or cancelled — refused, say (v0.70, «восстановить отменённые»): back on the board first, the lines on it.
  if (order.stage === 'closed' || order.stage === 'cancelled') await reopenJob(orderId);
  const job = (await db.orders.get(orderId)) ?? order;
  const now = nowIso();
  await db.transaction('rw', db.orders, db.items, async () => {
    for (const l of back)
      if (l.how === 'deleted') await db.items.put({ ...l.item, approvalState: 'draft' });
      else {
        await db.items.add(draftLike(l.item, uid(), now));
        await db.items.update(l.id, { restoredAt: now });
      }
    const deleted = back.filter((l) => l.how === 'deleted').map((l) => l.id);
    if (deleted.length) await db.orders.update(orderId, { removedLines: withoutRemoved(job, deleted) });
  });
  await syncDiscount(orderId);
  await syncLabourNames(orderId);
  await syncStage(orderId);
  return back.length;
}

/**
 * A closed (or cancelled) job back on the board: the car came back, or "Hand over" was tapped by
 * mistake. Its documents and money stay as they are; it goes back to "ready" when invoiced, else to
 * the workshop, and its lines move it on from there. The journal keeps the reopening.
 * History carried over from Eaglecart goes on as a job of the app: from now on it counts (what it owes,
 * its invoice), and the parts of its done lines are taken as fitted.
 */
export async function reopenJob(orderId: string): Promise<void> {
  await assertJobOpen(orderId);
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
      // Back on the board by its step (v0.70), not in the tab it was put in before it closed.
      boardTab: undefined,
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
 * added, moved, and "Done" issues the new invoice. Payments made count towards it. While the job is open
 * (`canAmendInvoice`): a car gone on credit stays handed over (v0.34) — its debt is what the new invoice leaves.
 */
export async function amendInvoice(orderId: string): Promise<void> {
  await assertJobOpen(orderId);
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  const inv = activeInvoice(b.invoices);
  if (!inv) throw new AppError('err.notFound');
  if (!canAmendInvoice(b.order.stage, b.invoices)) throw new AppError('stageErr.notAllowed');
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

/**
 * Jobs put in a tab of the board by the manager (v0.70, domain/boardStatus.ts): in work, waiting, a request. Only a place
 * on the board — the job's step, documents and money are not touched.
 */
export async function setBoardStatus(orderIds: string[], status: BoardStatus): Promise<number> {
  let n = 0;
  await db.transaction('rw', db.orders, db.events, async () => {
    for (const id of orderIds) {
      const order = await db.orders.get(id);
      if (!order || order.boardTab === status) continue;
      await db.orders.update(id, { boardTab: status, updatedAt: nowIso() });
      await logEvent(id, 'updated', { fields: ['boardTab'], to: status });
      n++;
    }
  });
  return n;
}

/** Parts of the job that are not bought yet. */
export function partsToFind(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => i.kind === 'part' && !i.customerSupplied && ['draft', 'pending', 'approved'].includes(i.approvalState) && (i.procurementStatus ?? 'needed') === 'needed');
}
