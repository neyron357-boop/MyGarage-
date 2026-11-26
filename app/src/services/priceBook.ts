import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { lineName } from '../domain/items';
import { bookMakes, groupPrices, pointsOf, priceHints, samePoint, type PriceGroup, type PriceHint } from '../domain/priceBook';
import type { PricePoint, Supplier } from '../domain/types';

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
