import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import type { OrderItem, ProcurementStatus, Supplier, SupplierReturn } from '../domain/types';
import { AppError } from './errors';
import { addMedia } from './media';
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
