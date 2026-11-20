import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { byPosition, itemTitle, lineName } from '../domain/items';
import { rankForJob, rankSuppliers, supplierUse, type BoughtLine, type Ranked, type SupplierUse } from '../domain/supplierRank';
import type { Lang, OrderItem, Supplier, Vehicle } from '../domain/types';

/*
 * What the garage bought from whom (v0.38): every line with a supplier (a part bought, a line handed to a contractor),
 * with its job's make — for the suppliers' counts, their order in lists and the suppliers for a job.
 */

const titleOf = (i: Pick<OrderItem, 'titleEn' | 'titleRu' | 'partNumber' | 'brand'>) => [i.titleEn, i.titleRu, i.partNumber, i.brand].filter(Boolean).join(' ');

/** In the order they were bought (the latest last). */
export async function boughtLines(): Promise<BoughtLine[]> {
  // One pass: a part's supplier is indexed, a contractor's (on the line's `outsource`) is not.
  const items = await db.items.filter((i) => !!(i.supplierId || i.outsource?.supplierId) && !i.customerSupplied).toArray();
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  const orders = await db.orders.bulkGet(orderIds);
  const vehicleOf = new Map(orders.filter((o) => !!o).map((o) => [o!.id, o!.vehicleId]));
  const vehicles = await db.vehicles.bulkGet([...new Set(vehicleOf.values())]);
  const makeOf = new Map(vehicles.filter((v): v is Vehicle => !!v).map((v) => [v.id, v.make]));
  const out: BoughtLine[] = [];
  for (const i of items) {
    // Orders gone with their job (deleted) say nothing any more.
    if (!vehicleOf.has(i.orderId)) continue;
    const make = makeOf.get(vehicleOf.get(i.orderId)!);
    const at = i.orderedAt ?? i.receivedAt ?? i.outsource?.sentAt ?? i.createdAt;
    const who = i.kind === 'part' ? i.supplierId : i.outsource?.supplierId ?? i.supplierId;
    if (who) out.push({ supplierId: who, orderId: i.orderId, at, make, title: titleOf(i), name: lineName(i.titleEn || i.titleRu || '', i.kind) || undefined });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Every supplier in the base with what was bought from it, most used and best rated first. */
export async function suppliersRanked(): Promise<{ list: Supplier[]; use: Map<string, SupplierUse> }> {
  const [all, lines, returns] = await Promise.all([db.suppliers.filter((s) => !s.archivedAt).toArray(), boughtLines(), db.supplierReturns.toArray()]);
  const use = supplierUse(lines, returns);
  return { list: rankSuppliers(all, use, nowIso()), use };
}

/** The suppliers for a job (its parts sellers; its contractors when it has work done outside), best fit first. */
export async function suppliersForJob(orderId: string, lang: Lang): Promise<{ parts: Ranked[]; contractors: Ranked[]; partLines: OrderItem[]; vehicle?: Vehicle } | null> {
  const order = await db.orders.get(orderId);
  if (!order) return null;
  const [vehicle, items, all, lines, returns] = await Promise.all([
    db.vehicles.get(order.vehicleId),
    db.items.where('orderId').equals(orderId).toArray(),
    db.suppliers.filter((s) => !s.archivedAt).toArray(),
    boughtLines(),
    db.supplierReturns.toArray(),
  ]);
  const use = supplierUse(lines, returns);
  const onJob = new Set(items.flatMap((i) => [i.supplierId, i.outsource?.supplierId, ...(i.offers ?? []).map((o) => o.supplierId)]).filter((x): x is string => !!x));
  // In the job's order (v0.59: the list sent and the diagrams' sheets are numbered alike).
  const partLines = items.filter((i) => i.kind === 'part' && !i.customerSupplied && i.approvalState !== 'declined').sort(byPosition);
  const handed = items.filter((i) => !!i.outsource);
  const now = nowIso();
  const named = (i: OrderItem) => ({ name: lineName(itemTitle(i, lang), i.kind), title: titleOf(i) });
  // What this job's own lines say is not history of it.
  const history = lines.filter((l) => l.orderId !== orderId);
  const sellers = all.filter((s) => !s.service);
  const doers = all.filter((s) => !!s.service);
  return {
    parts: rankForJob(sellers, use, history, { make: vehicle?.make, parts: partLines.map(named), onJob }, now),
    contractors: handed.length ? rankForJob(doers, use, history, { make: vehicle?.make, parts: handed.map(named), onJob }, now) : [],
    partLines,
    vehicle,
  };
}
