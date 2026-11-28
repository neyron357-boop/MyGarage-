import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { byPosition, itemTitle, lineName } from '../domain/items';
import { partOfLine } from '../domain/papers';
import { rateSeen, seenOf } from '../domain/chatStudy';
import { buys, knowOf, pickTop, rankForJob, rankSuppliers, relevance, supplierUse, useOf, type BoughtLine, type Ranked, type SupplierKnow, type SupplierUse, type TopCandidate } from '../domain/supplierRank';
import type { ChatFact, Lang, OrderItem, Supplier, Vehicle } from '../domain/types';
import { chatIdOf, chatRole, waDigits, type ChatRoles, type WaChat, type Who } from '../domain/whatsapp';
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
  // v1.05: what the suppliers' paper invoices say was bought (a paper is a purchase of its own, its lines with its car).
  const papers = await db.papers.where('state').anyOf(['done', 'look']).toArray();
  for (const p of papers) {
    if (!p.supplierId) continue;
    const at = p.date ? `${p.date}T08:00:00.000Z` : p.createdAt;
    for (const l of p.lines ?? []) {
      const name = partOfLine(l);
      if (!name) continue;
      out.push({ supplierId: p.supplierId, orderId: `paper:${p.id}`, at, make: l.make ?? p.make, title: [l.name, l.part, l.partNumber, l.brand].filter(Boolean).join(' '), name, paper: true });
    }
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

/** The garage's main suppliers, in their order (v0.91.6): by their chat and by the supplier of the base. */
export interface TopSuppliers {
  chats: Map<string, number>;
  suppliers: Map<string, number>;
}
export const NO_TOP: TopSuppliers = { chats: new Map(), suppliers: new Map() };

/**
 * The main suppliers (v0.91.6, the owner: «сопоставить самых релевантных, тех с которыми чаще работал, чаще отвечали…
 * закреплять всегда на первые позиции… везде в приложении самыми первыми»): every chat that is a supplier (of the base by its
 * number, given «Поставщик» or «Услуги» by hand or by the AI) and every supplier of the base parts were bought from —
 * weighed by `relevance` (requests answered, with a price, jobs bought, how it answers); pinned by hand — always, taken off by
 * hand — never (`ChatFact.pin`); domain/supplierRank.ts `pickTop`.
 */
export async function loadTop(given?: { facts: ChatFact[]; suppliers: Supplier[]; use: Map<string, SupplierUse>; people?: Map<string, Who>; roles?: ChatRoles }): Promise<TopSuppliers> {
  const [facts, sups, use, people, roles] = await Promise.all([
    given?.facts ?? db.chatFacts.toArray(),
    given?.suppliers ?? db.suppliers.filter((s) => !s.archivedAt).toArray(),
    given?.use ?? Promise.all([boughtLines(), db.supplierReturns.toArray()]).then(([l, r]) => supplierUse(l, r)),
    given?.people ?? loadPeople(),
    given?.roles ?? loadChatRoles(given?.facts ? { facts: given.facts } : undefined),
  ]);
  const now = Date.now();
  const byPhone = new Map(sups.filter((s) => waDigits(s.phone)).map((s) => [waDigits(s.phone), s]));
  const list: TopCandidate[] = [];
  const of = new Map<string, { chat?: string; supplier?: string }>();
  const counted = new Set<string>();
  for (const f of facts) {
    const sup = f.phone ? byPhone.get(f.phone) : undefined;
    const role = chatRole({ id: f.id, phone: f.phone, group: false }, people, roles);
    if (!sup && role !== 'supplier' && role !== 'service' && f.pin !== 'on') continue;
    const seen = seenOf(f.turns, now);
    const rating = rateSeen(seen);
    list.push({ key: f.id, score: relevance(seen, sup ? buys(useOf(use, sup.id)) : 0, rating), pin: f.pin, bad: !!rating && rating.score < -10 });
    of.set(f.id, { chat: f.id, supplier: sup?.id });
    if (sup) counted.add(sup.id);
  }
  for (const s of sups) {
    const jobs = buys(useOf(use, s.id));
    if (counted.has(s.id) || !jobs) continue;
    const key = chatIdOf(s.phone) || `s:${s.id}`;
    list.push({ key, score: relevance(undefined, jobs) });
    of.set(key, { chat: chatIdOf(s.phone) || undefined, supplier: s.id });
  }
  const top: TopSuppliers = { chats: new Map(), suppliers: new Map() };
  pickTop(list).forEach((key, i) => {
    const x = of.get(key);
    if (x?.chat) top.chats.set(x.chat, i);
    if (x?.supplier) top.suppliers.set(x.supplier, i);
  });
  return top;
}

/** The tables the main suppliers are read from (`useCalmQuery`). */
export const TOP_TABLES = ['chatFacts', 'suppliers', 'items', 'supplierReturns', 'settings', 'customers', 'employees', 'papers'];

/** Every supplier in the base with what was bought from it — the main ones first (v0.91.6), then most used and best rated. */
export async function suppliersRanked(): Promise<{ list: Supplier[]; use: Map<string, SupplierUse>; know: Map<string, SupplierKnow>; top: TopSuppliers }> {
  const [all, lines, returns, facts] = await Promise.all([db.suppliers.filter((s) => !s.archivedAt).toArray(), boughtLines(), db.supplierReturns.toArray(), db.chatFacts.toArray()]);
  const use = supplierUse(lines, returns);
  const now = nowIso();
  const know = supplierKnow(all, facts, now);
  const top = await loadTop({ facts, suppliers: all, use });
  return { list: rankSuppliers(all, use, now, know, top.suppliers), use, know, top };
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
  // The main suppliers first (v0.91.6) — those only in WhatsApp by their chat.
  const tops = await loadTop({ facts, suppliers: all, use });
  const topOf = new Map(tops.suppliers);
  for (const [id, chat] of chatOf) if (tops.chats.has(chat)) topOf.set(id, tops.chats.get(chat)!);
  const sellers = withChats.filter((s) => !s.service);
  const doers = withChats.filter((s) => !!s.service);
  const marked = (list: Ranked[]) => list.map((r) => (chatOf.has(r.supplier.id) ? { ...r, chat: chatOf.get(r.supplier.id) } : r));
  return {
    parts: marked(rankForJob(sellers, use, history, { make: vehicle?.make, parts: partLines.map(named), onJob }, now, know, topOf)),
    contractors: handed.length ? marked(rankForJob(doers, use, history, { make: vehicle?.make, parts: handed.map(named), onJob }, now, know, topOf)) : [],
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
