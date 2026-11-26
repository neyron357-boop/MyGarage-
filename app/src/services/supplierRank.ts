import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { byPosition, itemTitle, lineName } from '../domain/items';
import { knowOf, rankForJob, rankSuppliers, supplierUse, type BoughtLine, type Ranked, type SupplierKnow, type SupplierUse } from '../domain/supplierRank';
import type { ChatFact, Lang, OrderItem, Supplier, Vehicle } from '../domain/types';
import { chatRole, waDigits, type WaChat } from '../domain/whatsapp';
import { AppError } from './errors';
import { loadChatRoles, loadPeople, waStore } from './whatsapp';

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

/**
 * What each supplier's WhatsApp chat taught (v0.91, services/chatStudy.ts): by its number. The makes on its card come
 * first; a supplier with neither a chat studied nor makes — none.
 */
export function supplierKnow(suppliers: Supplier[], facts: ChatFact[], now = nowIso()): Map<string, SupplierKnow> {
  const byPhone = new Map(facts.filter((f) => f.phone).map((f) => [f.phone, f]));
  const out = new Map<string, SupplierKnow>();
  for (const s of suppliers) {
    const d = waDigits(s.phone);
    const k = knowOf(d ? byPhone.get(d) : undefined, now, s.makes);
    if (k) out.set(s.id, k);
  }
  return out;
}

/**
 * The suppliers only in WhatsApp (v0.91, the owner's note #74: «не все поставщики отображаются… при поиске особенно»): a
 * chat given the status «Поставщик» or «Услуги» (by hand, or by the AI) whose number is no one's of the base — listed under
 * the chat's name; asked, it becomes a supplier of the base (`supplierOfChat`). Its id here is `wa:<chat>`.
 */
export async function chatSuppliers(facts?: ChatFact[]): Promise<{ supplier: Supplier; chat: string; fact?: ChatFact }[]> {
  const [people, roles, all] = await Promise.all([loadPeople(), loadChatRoles(), facts ?? db.chatFacts.toArray()]);
  const factOf = new Map(all.map((f) => [f.id, f]));
  // The chats the app has (the list), else those it studied (their name kept).
  const chats = new Map<string, Pick<WaChat, 'id' | 'name' | 'phone' | 'group'>>();
  for (const f of all) if (f.phone) chats.set(f.id, { id: f.id, name: f.name ?? '', phone: f.phone, group: false });
  for (const c of waStore().chats) if (!c.group && !c.self) chats.set(c.id, c);
  const out: { supplier: Supplier; chat: string; fact?: ChatFact }[] = [];
  for (const c of chats.values()) {
    const role = chatRole(c, people, roles);
    if ((role !== 'supplier' && role !== 'service') || people.has(c.phone) || !c.phone) continue;
    const fact = factOf.get(c.id);
    out.push({
      chat: c.id,
      fact,
      supplier: { id: `wa:${c.id}`, name: c.name.trim() || `+${c.phone}`, phone: `+${c.phone}`, makes: fact?.makes, service: role === 'service' || undefined, createdAt: '' },
    });
  }
  return out;
}

/** Every supplier in the base with what was bought from it, most used and best rated first. */
export async function suppliersRanked(): Promise<{ list: Supplier[]; use: Map<string, SupplierUse>; know: Map<string, SupplierKnow> }> {
  const [all, lines, returns, facts] = await Promise.all([db.suppliers.filter((s) => !s.archivedAt).toArray(), boughtLines(), db.supplierReturns.toArray(), db.chatFacts.toArray()]);
  const use = supplierUse(lines, returns);
  const now = nowIso();
  const know = supplierKnow(all, facts, now);
  return { list: rankSuppliers(all, use, now, know), use, know };
}

/** The suppliers for a job (its parts sellers; its contractors when it has work done outside), best fit first. */
export async function suppliersForJob(orderId: string, lang: Lang): Promise<{ parts: Ranked[]; contractors: Ranked[]; off: Supplier[]; partLines: OrderItem[]; vehicle?: Vehicle } | null> {
  const order = await db.orders.get(orderId);
  if (!order) return null;
  const [vehicle, items, all, lines, returns, facts] = await Promise.all([
    db.vehicles.get(order.vehicleId),
    db.items.where('orderId').equals(orderId).toArray(),
    db.suppliers.filter((s) => !s.archivedAt).toArray(),
    boughtLines(),
    db.supplierReturns.toArray(),
    db.chatFacts.toArray(),
  ]);
  const use = supplierUse(lines, returns);
  const now = nowIso();
  // What the chats taught (v0.91): the base's suppliers by their numbers, and those only in WhatsApp.
  const fromChats = await chatSuppliers(facts);
  const know = supplierKnow(all, facts, now);
  for (const x of fromChats) {
    const k = knowOf(x.fact, now);
    if (k) know.set(x.supplier.id, k);
  }
  const onJob = new Set(items.flatMap((i) => [i.supplierId, i.outsource?.supplierId, ...(i.offers ?? []).map((o) => o.supplierId)]).filter((x): x is string => !!x));
  // In the job's order (v0.59: the list sent and the diagrams' sheets are numbered alike).
  const partLines = items.filter((i) => i.kind === 'part' && !i.customerSupplied && i.approvalState !== 'declined').sort(byPosition);
  const handed = items.filter((i) => !!i.outsource);
  const named = (i: OrderItem) => ({ name: lineName(itemTitle(i, lang), i.kind), title: titleOf(i) });
  // What this job's own lines say is not history of it.
  const history = lines.filter((l) => l.orderId !== orderId);
  const chatOf = new Map(fromChats.map((x) => [x.supplier.id, x.chat]));
  const withChats = [...all, ...fromChats.map((x) => x.supplier)];
  const sellers = withChats.filter((s) => !s.service);
  const doers = withChats.filter((s) => !!s.service);
  const marked = (list: Ranked[]) => list.map((r) => (chatOf.has(r.supplier.id) ? { ...r, chat: chatOf.get(r.supplier.id) } : r));
  return {
    parts: marked(rankForJob(sellers, use, history, { make: vehicle?.make, parts: partLines.map(named), onJob }, now, know)),
    contractors: handed.length ? marked(rankForJob(doers, use, history, { make: vehicle?.make, parts: handed.map(named), onJob }, now, know)) : [],
    // Taken off the list by the manager (v0.71): folded under it, to bring back.
    off: all.filter((s) => s.mark === 'off').sort((a, b) => a.name.localeCompare(b.name)),
    partLines,
    vehicle,
  };
}

/** The manager's mark on a supplier (v0.71: good, silent, off — or none). Returns the one it had (for «Отменить»). */
export async function setSupplierMark(supplierId: string, mark: Supplier['mark']): Promise<Supplier['mark']> {
  const s = await db.suppliers.get(supplierId);
  if (!s) throw new AppError('err.notFound');
  await db.suppliers.update(supplierId, { mark });
  return s.mark;
}
