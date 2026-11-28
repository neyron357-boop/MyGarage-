import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { lineName } from '../domain/items';
import { bookMakes, groupPrices, historyBefore, historyBest, historyOffers, historyPatch, pointsOf, priceHints, samePoint, searchBought, type BoughtHit, type PriceGroup, type PriceHint } from '../domain/priceBook';
import type { OrderItem, PricePoint, Supplier } from '../domain/types';
import { updateItem } from './estimate';
import { carsOfLine } from '../domain/papers';
import { tokenize } from '../domain/search';
import { chatIdOf } from '../domain/whatsapp';
import { queueWa } from './waOutbox';
import { getSettings } from './settings';

/*
 * The price book (v0.91.7, the owner: «автосбор цен и автоформирование прайс-листов исходя из ответов поставщиков… записывать
 * цены каждой детали с маркой и моделью авто и с VIN и так наращивать знания»): every offer of a job's line — read off a
 * supplier's WhatsApp answer (services/waAsk.ts, by the rules or the AI) or typed on the line — kept as a record of its own
 * (\`priceBook\`, synced as any table), with the car it was for. A line or a job deleted later — its prices stay.
 */

/** A line's offers into the book (each record once; a price said again the same — not written again). */
export async function notePrices(itemId: string): Promise<number> {
  const item = await db.items.get(itemId);
  if (!item?.offers?.length || item.kind !== 'part') return 0;
  const order = await db.orders.get(item.orderId);
  const vehicle = order ? await db.vehicles.get(order.vehicleId) : undefined;
  const now = nowIso();
  const points = pointsOf(item, order, vehicle, now);
  if (!points.length) return 0;
  return db.transaction('rw', db.priceBook, async () => {
    const had = await db.priceBook.bulkGet(points.map((p) => p.id));
    const put: PricePoint[] = [];
    points.forEach((p, k) => {
      const was = had[k];
      // Said before: its moment stays (the record is what was said then).
      if (was && samePoint(was, p)) return;
      put.push(was ? { ...p, at: was.at } : p);
    });
    if (put.length) await db.priceBook.bulkPut(put);
    return put.length;
  });
}

const FILLED = 'mygarage.priceBook.filled';
let filling: Promise<number> | undefined;

/**
 * Once on each device (v0.91.7): the offers already on the jobs' lines put into the book — what the suppliers said before
 * the book was there. Records written by two devices are the same records (the offer's id).
 */
export function fillPriceBook(): Promise<number> {
  if (globalThis.localStorage?.getItem(FILLED) === '1') return Promise.resolve(0);
  filling ??= (async () => {
    const items = await db.items.filter((i) => i.kind === 'part' && !!i.offers?.some((o) => !!o.supplierId)).toArray();
    let n = 0;
    for (const i of items) n += await notePrices(i.id);
    globalThis.localStorage?.setItem(FILLED, '1');
    return n;
  })().finally(() => (filling = undefined));
  return filling;
}

export interface PriceBook {
  groups: PriceGroup[];
  makes: { make: string; n: number }[];
  suppliers: Map<string, Supplier>;
  total: number;
}

/** The book as the screen shows it: by part, the makes it has, the suppliers by id. */
export async function loadPriceBook(opts: { query?: string; make?: string } = {}): Promise<PriceBook> {
  const [points, sups] = await Promise.all([db.priceBook.toArray(), db.suppliers.toArray()]);
  return { groups: groupPrices(points, opts), makes: bookMakes(points), suppliers: new Map(sups.map((s) => [s.id, s])), total: points.length };
}

/** The prices said before for this line (its «+ Цена»): the same part — this car, its model, its make first. */
export async function priceHintsFor(itemId: string): Promise<{ hints: PriceHint[]; suppliers: Map<string, Supplier> }> {
  const item = await db.items.get(itemId);
  if (!item || item.kind !== 'part') return { hints: [], suppliers: new Map() };
  const order = await db.orders.get(item.orderId);
  const vehicle = order ? await db.vehicles.get(order.vehicleId) : undefined;
  const part = lineName((item.titleEn || item.titleRu || '').trim());
  if (!part) return { hints: [], suppliers: new Map() };
  const [points, sups] = await Promise.all([db.priceBook.toArray(), db.suppliers.toArray()]);
  const hints = priceHints(points, { part, make: vehicle?.make, model: vehicle?.model, vin: vehicle?.vin, itemId });
  return { hints, suppliers: new Map(sups.map((s) => [s.id, s])) };
}

/**
 * v1.05.1 (the owner: «если тот же автомобиль, та же деталь — подсказывать: ты покупал у этого поставщика за такую цену»): the
 * job's parts with no cost yet that the garage bought before for this very car's model (or this VIN) — a supplier's paper
 * invoice's price, the latest: who, for how much, when. Shown under the line.
 */
export async function boughtBeforeFor(orderId: string): Promise<Map<string, { supplier: string; supplierId: string; fils: number; at: string }>> {
  const out = new Map<string, { supplier: string; supplierId: string; fils: number; at: string }>();
  const order = await db.orders.get(orderId);
  if (!order) return out;
  const items = (await db.items.where('orderId').equals(orderId).toArray()).filter(
    (i) => i.kind === 'part' && i.costPriceFils === undefined && (!i.procurementStatus || i.procurementStatus === 'needed') && !i.customerSupplied,
  );
  if (!items.length) return out;
  const points = await db.priceBook.where('id').startsWith('paper:').toArray();
  if (!points.length) return out;
  const [vehicle, sups] = await Promise.all([db.vehicles.get(order.vehicleId), db.suppliers.toArray()]);
  if (!vehicle?.model && !vehicle?.vin) return out;
  const names = new Map(sups.map((s) => [s.id, s.name]));
  for (const i of items) {
    const part = lineName((i.titleEn || i.titleRu || '').trim());
    if (!part) continue;
    const near = priceHints(points, { part, make: vehicle.make, model: vehicle.model, vin: vehicle.vin, itemId: i.id }, 5).filter((h) => h.near >= 2 && h.point.supplierId);
    const best = near.sort((a, b) => b.point.at.localeCompare(a.point.at))[0];
    if (best) out.set(i.id, { supplier: names.get(best.point.supplierId!) ?? '', supplierId: best.point.supplierId!, fils: best.point.costFils!, at: best.point.at });
  }
  return out;
}

/* ---------- Prices from the history on a job (v1.06) ---------- */

/** A price of the history offered on a job's line: who, for how much (one piece, without VAT), when, how near its car is. */
export interface HistoryOffer {
  id: string;
  supplierId: string;
  supplier: string;
  fils: number;
  at: string;
  /** 3 — this VIN, 2 — the same model, 1 — the same make. */
  near: number;
  /** Bought (a paper invoice) — else a supplier's word on another job. */
  bought: boolean;
  /** The line as the invoice printed it. */
  name?: string;
  kind: PricePoint['kind'];
  brand?: string;
}

/** The job's lines a history price may go on: parts drafts still to buy, without a cost of their own. */
const open = (i: OrderItem) => i.kind === 'part' && i.approvalState === 'draft' && !i.customerSupplied && (!i.procurementStatus || i.procurementStatus === 'needed');

/**
 * Each part of the job still to price (no cost, or the one the history put) and what the garage paid or was told for it for
 * this car before — at most three, this model first, bought before told (domain/priceBook.ts `historyOffers`); `best` — the one
 * «Цены из истории» takes (this very car's model).
 */
export async function historyOffersFor(orderId: string): Promise<Map<string, { offers: HistoryOffer[]; best?: string }>> {
  const out = new Map<string, { offers: HistoryOffer[]; best?: string }>();
  const order = await db.orders.get(orderId);
  if (!order) return out;
  const items = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => open(i) && (i.costPriceFils === undefined || !!i.costFrom));
  if (!items.length) return out;
  const vehicle = await db.vehicles.get(order.vehicleId);
  if (!vehicle?.make && !vehicle?.vin) return out;
  const [points, sups] = await Promise.all([db.priceBook.toArray(), db.suppliers.toArray()]);
  if (!points.length) return out;
  const names = new Map(sups.map((s) => [s.id, s.name]));
  for (const i of items) {
    const part = lineName((i.titleEn || i.titleRu || '').trim());
    if (!part) continue;
    const hints = historyOffers(points, { part, make: vehicle.make, model: vehicle.model, vin: vehicle.vin, itemId: i.id }, 3);
    if (!hints.length) continue;
    const best = historyBest(hints);
    out.set(i.id, {
      offers: hints.map(({ point: p, near }) => ({ id: p.id, supplierId: p.supplierId!, supplier: names.get(p.supplierId!) ?? '', fils: p.costFils!, at: p.at, near, bought: p.via === 'paper', ...(p.name ? { name: p.name } : {}), kind: p.kind, ...(p.brand ? { brand: p.brand } : {}) })),
      ...(best ? { best: best.point.id } : {}),
    });
  }
  return out;
}

/** A line's cost from one price of the history (a tap on it): what the line had, for «Отменить». */
export async function takeHistoryPrice(itemId: string, pointId: string): Promise<Partial<OrderItem> | undefined> {
  const [item, point, settings] = await Promise.all([db.items.get(itemId), db.priceBook.get(pointId), getSettings()]);
  if (!item || !point || point.costFils === undefined || !open(item)) return undefined;
  const before = historyBefore(item);
  await updateItem(itemId, historyPatch(item, point, settings));
  return before;
}

/**
 * «Цены из истории» (the owner's dream: the parts written down after the diagnosis, their prices from what the garage paid
 * for the same part for the same car — the quote to the customer without waiting for the suppliers): every part of the job
 * without a cost that has one bought (or told) for this very car — its newest. What each line had, for «Отменить».
 */
export async function priceFromHistory(orderId: string): Promise<Map<string, Partial<OrderItem>>> {
  const offers = await historyOffersFor(orderId);
  const before = new Map<string, Partial<OrderItem>>();
  for (const [itemId, o] of offers) {
    const item = await db.items.get(itemId);
    if (!o.best || !item || item.costPriceFils !== undefined) continue;
    const had = await takeHistoryPrice(itemId, o.best);
    if (had) before.set(itemId, had);
  }
  return before;
}

/** «Отменить»: the lines as they were (only those the history's price is still on). */
export async function undoHistoryPrices(before: Map<string, Partial<OrderItem>>): Promise<void> {
  for (const [id, had] of before) {
    const now = await db.items.get(id);
    if (!now?.costFrom) continue;
    await updateItem(id, had);
  }
}

/* ---------- The parts bought, searched (v1.06) ---------- */

/**
 * «Поставщики» searched by a part and a car (the owner: «передний бампер Toyota Land Cruiser… у этого поставщика уже куплена
 * была вот эта деталь для такого-то автомобиля… и заново могу запрос дать ему»): the car read off the words (domain/papers.ts
 * `carsOfLine`), the rest — the part, in either language; the invoices' lines that fit (domain/priceBook.ts `searchBought`).
 */
export async function searchBoughtParts(query: string): Promise<{ hits: BoughtHit[]; suppliers: Map<string, Supplier>; car?: { make?: string; model?: string } }> {
  const q = query.trim();
  if (q.length < 3) return { hits: [], suppliers: new Map() };
  const car = carsOfLine(q);
  const carWords = new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).filter((_, k) => car.words.includes(k)));
  const tokens = tokenize(q).filter((tk) => !carWords.has(tk) && !/^\d{4}$/.test(tk));
  const points = await db.priceBook.where('id').startsWith('paper:').toArray();
  const hits = searchBought(points, { tokens, car: car.make ? { make: car.make, model: car.model } : undefined });
  if (!hits.length) return { hits, suppliers: new Map() };
  const sups = await db.suppliers.bulkGet([...new Set(hits.map((h) => h.point.supplierId!))]);
  return { hits, suppliers: new Map(sups.filter((s): s is Supplier => !!s).map((s) => [s.id, s])), ...(car.make ? { car: { make: car.make, model: car.model } } : {}) };
}

/** The question to a supplier about a part bought from it before — its words as on the invoice, its number, the car. */
export function askAgainText(p: PricePoint, car?: { make?: string; model?: string }): string {
  const forCar = [car?.make ?? p.make, car?.model ?? p.model].filter(Boolean).join(' ');
  const said = [p.invoiceNo ? `invoice ${p.invoiceNo}` : '', `${p.at.slice(5, 7)}/${p.at.slice(0, 4)}`, p.partNumber ? `part no. ${p.partNumber}` : ''].filter(Boolean).join(', ');
  return `Salam! Do you have *${p.part}*${forCar ? ` for ${forCar}` : ''}?\nWe bought it from you before (${said}${p.name && p.name !== p.part ? `: ${p.name}` : ''}).\nPrice please.`;
}

/** Asked again through «Проверить и отправить» (seen and sent by the manager's tap — services/waConfirm.ts). */
export async function askAgain(p: PricePoint, car?: { make?: string; model?: string }): Promise<boolean> {
  const s = p.supplierId ? await db.suppliers.get(p.supplierId) : undefined;
  if (!s?.phone) return false;
  const [r] = await queueWa([{ key: `askpart:${p.id}:${nowIso().slice(0, 10)}`, phone: s.phone, chat: chatIdOf(s.phone), parts: [{ text: askAgainText(p, car) }], title: s.name }]);
  return !!r && r.state !== 'none';
}
