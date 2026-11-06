import { db, uid } from '../db/db';
import { addDays, nowIso } from '../domain/dates';
import {
  canMarkDone,
  decisionPatch,
  isAwaitingDisassembly,
  itemAmounts,
  itemRangeGross,
  itemTitle,
  noCallLimitRemaining,
  resolveBlockB,
  summarize,
} from '../domain/items';
import type {
  Block,
  DecisionKind,
  DecisionVia,
  EstimateVersion,
  OrderItem,
  SendVia,
  SnapshotItem,
  VersionKind,
} from '../domain/types';
import { AppError } from './errors';
import { logEvent, tryStage } from './orders';
import { getSettings } from './settings';

export type NewItem = Partial<OrderItem> & Pick<OrderItem, 'kind' | 'block'>;

const LOCKED_FIELDS: (keyof OrderItem)[] = ['kind', 'block', 'qty', 'unitPriceFils', 'priceMinFils', 'priceMaxFils', 'titleRu', 'titleEn', 'customerSupplied', 'vatRateBp'];

export async function addItem(orderId: string, input: NewItem): Promise<OrderItem> {
  const settings = await getSettings();
  const now = nowIso();
  const item: OrderItem = {
    qty: 1,
    unit: 'pcs',
    unitPriceFils: 0,
    vatRateBp: settings.vatRateBp,
    done: false,
    ...input,
    id: uid(),
    orderId,
    approvalState: 'draft',
    procurementStatus: input.kind === 'part' && !input.customerSupplied ? input.procurementStatus ?? 'needed' : undefined,
    createdAt: now,
  };
  if (!item.titleRu?.trim() && !item.titleEn?.trim()) throw new AppError('err.titleRequired');
  await db.transaction('rw', db.items, db.events, async () => {
    await db.items.add(item);
    await logEvent(orderId, 'item_added', { itemId: item.id, title: item.titleRu || item.titleEn, block: item.block });
  });
  return item;
}

export async function addTemplate(orderId: string, templateId: string, block: Block = 'A'): Promise<OrderItem[]> {
  const t = await db.jobTemplates.get(templateId);
  if (!t) throw new AppError('err.notFound');
  const out: OrderItem[] = [];
  for (const ti of t.items) {
    out.push(await addItem(orderId, { ...ti, block: block === 'A' ? ti.block : block, templateId }));
  }
  return out;
}

export async function updateItem(id: string, patch: Partial<OrderItem>): Promise<void> {
  const item = await db.items.get(id);
  if (!item) throw new AppError('err.notFound');
  if (item.approvalState !== 'draft' && LOCKED_FIELDS.some((f) => f in patch && patch[f] !== item[f])) {
    throw new AppError('err.itemSent');
  }
  await db.items.update(id, patch);
}

export async function removeItem(id: string): Promise<void> {
  const item = await db.items.get(id);
  if (!item) return;
  if (item.approvalState !== 'draft') throw new AppError('err.itemSent');
  await db.items.delete(id);
}

function snapshotItem(i: OrderItem, lang: 'ru' | 'en'): SnapshotItem {
  const a = itemAmounts(i);
  const r = itemRangeGross(i);
  return {
    itemId: i.id,
    kind: i.kind,
    block: i.block,
    title: itemTitle(i, lang),
    qty: i.qty,
    unit: i.unit,
    net: a.net,
    vat: a.vat,
    gross: a.gross,
    minGross: i.block === 'B' && !i.bNeeded ? r.min : undefined,
    maxGross: i.block === 'B' && !i.bNeeded ? r.max : undefined,
    urgency: i.urgency,
    ifNotDone: (lang === 'ru' ? i.ifNotDoneRu || i.ifNotDoneEn : i.ifNotDoneEn || i.ifNotDoneRu) || undefined,
    customerSupplied: i.customerSupplied,
  };
}

export interface SendOptions {
  via: SendVia;
  reason?: string;
  kind?: VersionKind;
}

/** Freeze all draft items into a new estimate version (v1, v2...) and mark them as waiting for the customer. */
export async function sendVersion(orderId: string, opts: SendOptions): Promise<EstimateVersion> {
  const [order, settings] = await Promise.all([db.orders.get(orderId), getSettings()]);
  if (!order) throw new AppError('err.notFound');
  const all = await db.items.where('orderId').equals(orderId).toArray();
  const drafts = all.filter((i) => i.approvalState === 'draft');
  if (drafts.length === 0) throw new AppError('err.nothingToSend');
  const prev = await db.versions.where('orderId').equals(orderId).count();
  const lang = order.docLanguage;
  const sum = summarize(drafts);
  const now = nowIso();
  const version: EstimateVersion = {
    id: uid(),
    orderId,
    number: prev + 1,
    kind: opts.kind ?? (prev === 0 ? 'initial' : 'supplement'),
    reason: opts.reason?.trim() || undefined,
    language: lang,
    items: drafts.map((i) => snapshotItem(i, lang)),
    fixedGross: sum.fixedGross,
    maxGross: sum.maxGross,
    recommendedGross: sum.recommendedGross,
    mediaIds: [...new Set(drafts.flatMap((i) => i.mediaIds ?? []))],
    status: 'sent',
    validUntil: addDays(now, settings.estimateValidityDays),
    sentAt: now,
    sentVia: opts.via,
  };
  await db.transaction('rw', db.versions, db.items, db.events, async () => {
    await db.versions.add(version);
    for (const i of drafts) {
      await db.items.update(i.id, {
        approvalState: 'pending',
        lastVersionId: version.id,
        introducedInVersionId: i.introducedInVersionId ?? version.id,
      });
    }
    await logEvent(orderId, 'version_sent', { number: version.number, via: opts.via, fixed: version.fixedGross, max: version.maxGross });
  });
  if (order.stage === 'diagnostics') await tryStage(orderId, 'awaiting_approval');
  return version;
}

export interface DecisionInput {
  itemId: string;
  decision: DecisionKind;
}

/** Record the customer's answer for items of a version. */
export async function recordDecisions(versionId: string, decisions: DecisionInput[], via: DecisionVia, note?: string): Promise<void> {
  const version = await db.versions.get(versionId);
  if (!version) throw new AppError('err.notFound');
  const now = nowIso();
  await db.transaction('rw', db.items, db.decisions, db.versions, db.events, async () => {
    for (const d of decisions) {
      const item = await db.items.get(d.itemId);
      if (!item || item.approvalState !== 'pending') continue;
      await db.items.update(item.id, decisionPatch(item, d.decision));
      await db.decisions.add({ id: uid(), versionId, itemId: item.id, orderId: version.orderId, decision: d.decision, via, decidedAt: now, note });
    }
    const items = await db.items.bulkGet(version.items.map((s) => s.itemId));
    const open = items.filter((i) => i && i.approvalState === 'pending' && !isAwaitingDisassembly(i));
    if (open.length === 0 && version.status === 'sent') await db.versions.update(versionId, { status: 'answered', answeredAt: now });
    await logEvent(version.orderId, 'decision', {
      version: version.number,
      via,
      note,
      approved: decisions.filter((d) => d.decision === 'approve').length,
      declined: decisions.filter((d) => d.decision === 'decline').length,
    });
  });
}

export async function limitRemaining(orderId: string): Promise<{ limit: number; remaining: number }> {
  const [intake, items, decisions] = await Promise.all([
    db.inspections.where('orderId').equals(orderId).filter((i) => i.kind === 'intake').first(),
    db.items.where('orderId').equals(orderId).toArray(),
    db.decisions.where('orderId').equals(orderId).toArray(),
  ]);
  const limit = intake?.conditions?.noCallLimitFils ?? 0;
  return { limit, remaining: noCallLimitRemaining(limit, items, decisions) };
}

/** Approve all draft items within the customer's no-call limit (signed in the intake act). */
export async function approveByLimit(orderId: string, reason?: string): Promise<EstimateVersion> {
  const drafts = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => i.approvalState === 'draft');
  const total = drafts.reduce((s, i) => s + itemAmounts(i).gross, 0);
  const { remaining } = await limitRemaining(orderId);
  if (drafts.length === 0) throw new AppError('err.nothingToSend');
  if (total > remaining) throw new AppError('err.overLimit');
  const v = await sendVersion(orderId, { via: 'limit', reason, kind: 'supplement' });
  await recordDecisions(v.id, drafts.map((d) => ({ itemId: d.id, decision: 'approve' as const })), 'limit');
  return v;
}

/** After disassembly: is the block B item needed and at what net price? */
export async function resolveB(itemId: string, needed: boolean, actualNetFils: number) {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  const outcome = resolveBlockB(item, needed, actualNetFils);
  await db.transaction('rw', db.items, db.decisions, db.events, async () => {
    await db.items.update(itemId, outcome.patch);
    if (outcome.kind === 'auto_approved' && item.lastVersionId) {
      await db.decisions.add({
        id: uid(),
        versionId: item.lastVersionId,
        itemId,
        orderId: item.orderId,
        decision: 'approve',
        via: 'b_preapproved',
        decidedAt: nowIso(),
      });
    }
    await logEvent(item.orderId, 'b_resolved', { itemId, needed, outcome: outcome.kind, actualNetFils });
  });
  return outcome.kind;
}

export async function setDone(itemId: string, done: boolean): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  if (done && !canMarkDone(item)) throw new AppError('err.notApproved');
  const patch: Partial<OrderItem> = { done, doneAt: done ? nowIso() : undefined };
  if (item.kind === 'part' && !item.customerSupplied && done) patch.procurementStatus = 'installed';
  await db.transaction('rw', db.items, db.events, async () => {
    await db.items.update(itemId, patch);
    await logEvent(item.orderId, done ? 'done' : 'undone', { itemId, title: item.titleRu || item.titleEn });
  });
}
