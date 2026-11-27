import { db, uid } from '../db/db';
import { itemTitle } from '../domain/items';
import { supplierOrderText, type Collect, type OrderLine } from '../domain/supplierOrder';
import type { OrderItem, PartOffer } from '../domain/types';
import { waDigits } from '../domain/whatsapp';
import { AppError } from './errors';
import { setProcurement } from './parts';
import { queueWa, type OutItem } from './waOutbox';

/*
 * «Заказать у X» (audit 27/11): the parts a supplier offered — taken in one tap. The order goes to the supplier through
 * «Проверить и отправить» (nothing leaves by itself); once it went, its lines are «заказано» at that supplier, at the
 * price they offered, expected when they are collected (`keepSentBuys`, from `sendAsked`) — not before.
 */

export interface BuyPick {
  itemId: string;
  /** The offer taken (`PartOffer.id`); none — the line as it is. */
  offerId?: string;
}

/** What an order carries to be kept on the job once it really went. */
export interface BuyNote {
  orderId: string;
  supplierId: string;
  lines: { itemId: string; costFils?: number }[];
  /** When it is expected (ISO), the pickup time said. */
  expectedAt?: string;
}

export async function orderFromSupplier(orderId: string, supplierId: string, picks: BuyPick[], collect: Collect & { expectedAt?: string }): Promise<{ queued: number }> {
  const [order, supplier] = await Promise.all([db.orders.get(orderId), db.suppliers.get(supplierId)]);
  if (!order || !supplier) throw new AppError('err.notFound');
  const phone = waDigits(supplier.phone);
  if (!phone) throw new AppError('wa.err.noSupplierNumber');
  const vehicle = await db.vehicles.get(order.vehicleId);
  const items = (await db.items.bulkGet(picks.map((p) => p.itemId))).filter((i): i is OrderItem => !!i && i.kind === 'part');
  if (!items.length) throw new AppError('wa.err.noParts');
  const offerOf = (i: OrderItem): PartOffer | undefined => {
    const id = picks.find((p) => p.itemId === i.id)?.offerId;
    return id ? i.offers?.find((o) => o.id === id) : undefined;
  };
  const lines: OrderLine[] = items.map((i) => {
    const o = offerOf(i);
    return { name: itemTitle(i, 'en'), qty: i.qty, kind: o?.kind, brand: o?.brand, costFils: o?.costFils };
  });
  const title = [vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(' ');
  const text = supplierOrderText({ title, vin: vehicle?.vin }, lines, collect);
  const buy: BuyNote = { orderId, supplierId, lines: items.map((i) => ({ itemId: i.id, costFils: offerOf(i)?.costFils })), expectedAt: collect.expectedAt };
  const item: OutItem = { key: `buy:${orderId}:${supplierId}:${uid().slice(0, 8)}`, phone, title: `#${order.number} · ${supplier.name}`, parts: [{ text }], buy };
  const [r] = await queueWa([item]);
  // Handed over already (no review on this device): kept now.
  if (r && r.state !== 'confirm') await keepSentBuys([item]);
  return { queued: items.length };
}

/** The orders among what really went: their lines «заказано» at that supplier, at the price taken, expected then. */
export async function keepSentBuys(items: OutItem[]): Promise<void> {
  for (const it of items) {
    const b = it.buy;
    if (!b) continue;
    for (const l of b.lines) {
      const now = await db.items.get(l.itemId);
      // Bought or here already (another device, by hand): left as it is.
      if (!now || now.kind !== 'part' || (now.procurementStatus && now.procurementStatus !== 'needed')) continue;
      await setProcurement(l.itemId, { status: 'ordered', supplierId: b.supplierId, ...(l.costFils ? { costPriceFils: l.costFils } : {}), ...(b.expectedAt ? { expectedAt: b.expectedAt } : {}) });
    }
  }
}
