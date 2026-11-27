import { formatAed } from './money';
import type { OrderItem, PartOffer } from './types';

/*
 * «Заказать у X» (audit 27/11: «беру» was typed to the supplier by hand — ~15 taps and a message for each part; the
 * supplier's «ok» moved nothing). The words of the order, in English as the requests are (suppliers read English):
 * the car, the parts taken — as the supplier offered them (original, copy, used; their price) — and when they are
 * collected or that they are to be brought. No price is made up: a line without the supplier's price says none.
 */

export type OfferKind = 'oem' | 'aftermarket' | 'used' | string;

export interface OrderLine {
  name: string;
  qty: number;
  kind?: OfferKind;
  brand?: string;
  /** The supplier's price for one, without VAT (fils), as they said it. */
  costFils?: number;
}

export type Collect = { by: 'pickup'; at: string } | { by: 'deliver' };

const KIND: Record<string, string> = { oem: 'original', aftermarket: 'copy', used: 'used' };

/** The order to the supplier: the car, each part as offered, when it is collected. `at` — «today 16:00», as said. */
export function supplierOrderText(car: { title: string; vin?: string }, lines: OrderLine[], collect: Collect): string {
  const out = [`*${car.title.trim()}*${car.vin ? ` · VIN ${car.vin}` : ''}`, '', 'Please keep for us:'];
  for (const [k, l] of lines.entries()) {
    const what = [l.kind ? KIND[l.kind] ?? l.kind : '', l.brand ?? ''].filter(Boolean).join(' ');
    const qty = l.qty > 1 ? ` × ${l.qty}` : '';
    const price = l.costFils ? ` — ${formatAed(l.costFils, 'en')}` : '';
    out.push(`${k + 1}. ${l.name}${what ? ` (${what})` : ''}${qty}${price}`);
  }
  out.push('', collect.by === 'deliver' ? 'Please deliver to the garage.' : `We will collect ${collect.at}.`, 'Thank you!');
  return out.join('\n');
}

/** A part the garage still has to buy, with something a supplier offered for it. */
export function buyable(i: Pick<OrderItem, 'kind' | 'customerSupplied' | 'procurementStatus' | 'approvalState' | 'offers'>): boolean {
  if (i.kind !== 'part' || i.customerSupplied || i.approvalState === 'declined' || i.approvalState === 'cancelled') return false;
  if (i.procurementStatus && i.procurementStatus !== 'needed') return false;
  return (i.offers ?? []).some((o) => !o.na && !!o.supplierId);
}

/** The offer picked at first: the one already on the line (its supplier and cost), else the cheapest priced, else the first. */
export function bestOffer(i: Pick<OrderItem, 'offers' | 'supplierId' | 'costPriceFils'>): PartOffer | undefined {
  const all = (i.offers ?? []).filter((o) => !o.na && !!o.supplierId);
  const own = all.find((o) => o.supplierId === i.supplierId && (!i.costPriceFils || o.costFils === i.costPriceFils));
  if (own) return own;
  const priced = all.filter((o) => (o.costFils ?? 0) > 0).sort((a, b) => (a.costFils ?? 0) - (b.costFils ?? 0));
  return priced[0] ?? all[0];
}
