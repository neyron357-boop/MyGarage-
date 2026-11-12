import { db, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import type { OrderItem, Outsource, PayMethod, ProcurementStatus, Supplier, SupplierReturn } from '../domain/types';
import { readFirstSheet } from '../domain/moneySheet';
import { parseCsv, sameSupplier, suppliersFromRows, type SupplierRow } from '../domain/supplierSheet';
import { AppError } from './errors';
import { addMedia, deleteMedia } from './media';
import { addExpense } from './money';
import { logEvent } from './orders';

export async function saveSupplier(input: Partial<Supplier> & { name: string }): Promise<Supplier> {
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  if (input.id) {
    await db.suppliers.update(input.id, input);
    return (await db.suppliers.get(input.id))!;
  }
  const s: Supplier = { ...input, name: input.name.trim(), id: uid(), createdAt: nowIso() };
  await db.suppliers.add(s);
  return s;
}

/**
 * A supplier list of one's own (Excel or CSV, any columns): new ones are added, those already here
 * (same phone, or same name) are left as they are.
 */
export async function importSuppliers(file: Blob): Promise<{ added: number; skipped: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let rows: string[][];
  try {
    rows = zip ? await readFirstSheet(bytes) : parseCsv(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError('err.notSupplierList');
  }
  const found = suppliersFromRows(rows);
  if (!found.length) throw new AppError('err.notSupplierList');
  const have = await db.suppliers.toArray();
  let added = 0;
  const now = nowIso();
  const fresh: Supplier[] = [];
  for (const s of found) {
    if ([...have, ...fresh].some((h) => sameSupplier(h, s))) continue;
    const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== '')) as SupplierRow;
    fresh.push({ ...clean, id: uid(), createdAt: now });
    added++;
  }
  if (fresh.length) await db.suppliers.bulkAdd(fresh);
  return { added, skipped: found.length - added };
}

/** A supplier's business card, front and back. */
export async function setSupplierCard(supplierId: string, keep: string[], files: Blob[]): Promise<void> {
  const s = await db.suppliers.get(supplierId);
  if (!s) throw new AppError('err.notFound');
  const added: string[] = [];
  for (const file of files) added.push((await addMedia({ ownerType: 'supplier', ownerId: supplierId, slot: 'card', file })).id);
  const before = s.cardMediaIds ?? [];
  const next = [...keep.filter((id) => before.includes(id)), ...added];
  await db.suppliers.update(supplierId, { cardMediaIds: next.length ? next : undefined });
  for (const id of before.filter((x) => !next.includes(x))) await deleteMedia(id).catch(() => undefined);
}

export interface ProcurementUpdate {
  status: ProcurementStatus;
  supplierId?: string;
  costPriceFils?: number;
  purchaseVatFils?: number;
  expectedAt?: string;
  receipt?: Blob;
  paidCash?: boolean;
}

export async function setProcurement(itemId: string, u: ProcurementUpdate): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item || item.kind !== 'part') throw new AppError('err.notFound');
  const now = nowIso();
  const patch: Partial<OrderItem> = { procurementStatus: u.status };
  if (u.supplierId !== undefined) patch.supplierId = u.supplierId || undefined;
  if (u.costPriceFils !== undefined) patch.costPriceFils = u.costPriceFils;
  if (u.purchaseVatFils !== undefined) patch.purchaseVatFils = u.purchaseVatFils;
  if (u.expectedAt !== undefined) patch.expectedAt = u.expectedAt || undefined;
  if (u.status === 'ordered' && !item.orderedAt) patch.orderedAt = now;
  if (u.status === 'received') patch.receivedAt = now;
  if (u.receipt) {
    const m = await addMedia({ ownerType: 'item', ownerId: itemId, slot: 'receipt', file: u.receipt });
    patch.receiptMediaId = m.id;
  }
  await db.transaction('rw', db.items, db.cashMovements, db.events, async () => {
    await db.items.update(itemId, patch);
    if (u.status === 'received' && u.paidCash) {
      const cost = Math.round((u.costPriceFils ?? item.costPriceFils ?? 0) * item.qty) + (u.purchaseVatFils ?? item.purchaseVatFils ?? 0);
      if (cost > 0) {
        await db.cashMovements.add({
          id: uid(),
          at: now,
          direction: 'out',
          amountFils: cost,
          reason: 'parts_purchase',
          orderId: item.orderId,
          note: item.titleRu || item.titleEn,
        });
      }
    }
    await logEvent(item.orderId, 'procurement', { itemId, status: u.status });
  });
}

/** The seller's return terms, said when the part is bought: until which day it can go back, or no returns. */
export async function setReturnTerms(itemId: string, terms: { returnBy?: string; noReturn?: boolean }): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  await db.transaction('rw', db.items, db.events, async () => {
    await db.items.update(itemId, { returnBy: terms.returnBy || undefined, noReturn: terms.noReturn || undefined });
    await logEvent(item.orderId, 'return_terms', { itemId, returnBy: terms.returnBy, noReturn: !!terms.noReturn });
  });
}

/** Several ordered, some came: how many are here. All of them — the part is here. */
export async function setReceivedQty(itemId: string, n: number): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item || item.kind !== 'part') throw new AppError('err.notFound');
  const qty = Math.max(0, Math.min(n, item.qty));
  if (qty >= item.qty) {
    await db.items.update(itemId, { receivedQty: undefined });
    await setProcurement(itemId, { status: 'received' });
    return;
  }
  await db.items.update(itemId, { receivedQty: qty || undefined });
  if (item.procurementStatus === 'received' || !item.procurementStatus || item.procurementStatus === 'needed') await setProcurement(itemId, { status: 'ordered' });
}

/** Proof of what the seller agreed to (a photo of the receipt, a screenshot of the chat). */
export async function addDealProof(itemId: string, files: Blob[]): Promise<void> {
  for (const file of files) await addMedia({ ownerType: 'item', ownerId: itemId, slot: 'deal', file });
}

/**
 * Work done outside (a paint shop, machining, alignment, a mobile electrician): who has it, when it is
 * due back, where it stands. The price agreed with them is the line's cost.
 */
export async function setOutsource(itemId: string, o: Outsource | undefined): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  const now = nowIso();
  const next: Outsource | undefined = o && {
    ...o,
    sentAt: o.state !== 'todo' ? o.sentAt ?? item.outsource?.sentAt ?? now : undefined,
    backAt: o.state === 'back' ? o.backAt ?? item.outsource?.backAt ?? now : undefined,
  };
  await db.transaction('rw', db.items, db.events, async () => {
    await db.items.update(itemId, { outsource: next });
    if (next?.state !== item.outsource?.state) await logEvent(item.orderId, 'outsource', { itemId, state: next?.state ?? 'none', supplierId: next?.supplierId });
  });
}

/** Pay the contractor for the work done outside: an expense of the job in the money book. */
export async function payOutsource(itemId: string, method: PayMethod): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item?.outsource) throw new AppError('err.notFound');
  if (item.outsource.expenseId) return;
  const amount = Math.round((item.costPriceFils ?? 0) * (item.qty || 1));
  if (!(amount > 0)) throw new AppError('err.amountRequired');
  const cat = await subcontractCategory();
  const who = item.outsource.supplierId ? (await db.suppliers.get(item.outsource.supplierId))?.name : undefined;
  const e = await addExpense({ date: dubaiDate(), categoryId: cat, amountFils: amount, vatFils: 0, vendor: who, method, orderId: item.orderId, note: item.titleEn || item.titleRu });
  await db.items.update(itemId, { outsource: { ...item.outsource, expenseId: e.id } });
}

/** The money book's category for contractors (added on installs from before it existed). */
async function subcontractCategory(): Promise<string> {
  const had = await db.expenseCategories.where('code').equals('subcontract').first();
  if (had) return had.id;
  const id = uid();
  await db.expenseCategories.add({ id, code: 'subcontract', nameRu: 'Подрядчики', nameEn: 'Subcontractors', monthlyLimitFils: 0, active: true });
  return id;
}

export async function createReturn(itemId: string, input: Pick<SupplierReturn, 'reason' | 'expectedRefundFils' | 'refundType'>): Promise<SupplierReturn> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  const r: SupplierReturn = { ...input, id: uid(), itemId, orderId: item.orderId, supplierId: item.supplierId, status: 'open', createdAt: nowIso() };
  await db.transaction('rw', db.supplierReturns, db.items, db.events, async () => {
    await db.supplierReturns.add(r);
    await db.items.update(itemId, { procurementStatus: 'returned' });
    await logEvent(item.orderId, 'supplier_return', { itemId, reason: input.reason });
  });
  return r;
}

export async function closeReturn(id: string, cashRefund: boolean): Promise<void> {
  const r = await db.supplierReturns.get(id);
  if (!r || r.status === 'closed') return;
  const now = nowIso();
  await db.transaction('rw', db.supplierReturns, db.cashMovements, async () => {
    await db.supplierReturns.update(id, { status: 'closed', closedAt: now });
    if (cashRefund && r.refundType === 'money' && r.expectedRefundFils > 0) {
      await db.cashMovements.add({ id: uid(), at: now, direction: 'in', amountFils: r.expectedRefundFils, reason: 'supplier_refund', orderId: r.orderId });
    }
  });
}
