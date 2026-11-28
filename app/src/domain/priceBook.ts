import { lineName } from './items';
import { carWordsOf, partName, partSimilarity } from './partMatch';
import type { Order, OrderItem, PricePoint, Vehicle } from './types';

/*
 * The price book (v0.91.7, the owner: «автосбор цен и автоформирование прайс-листов исходя из ответов поставщиков — ИИ должен
 * мониторить ответы и записывать цены каждой детали с маркой и моделью авто и с VIN и так наращивать знания»). Pure: what a
 * line's offers are as records, the book by part, and the prices that fit a line of a job.
 */

/** A line's offers (those with a supplier) as the book's records — the car of its job with each. */
export function pointsOf(item: OrderItem, order: Pick<Order, 'id' | 'asks'> | undefined, vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'vin'> | undefined, now: string): PricePoint[] {
  const title = lineName((item.titleEn || item.titleRu || '').trim());
  if (!title || item.kind !== 'part') return [];
  // When each message was said (the request keeps its replies).
  const said = new Map<string, string>();
  for (const a of order?.asks ?? []) for (const r of a.replies ?? []) said.set(r.id, r.at);
  return (item.offers ?? [])
    .filter((o) => !!o.supplierId && (o.costFils !== undefined || o.na))
    .map((o) => ({
      id: o.id,
      part: title,
      ...(item.titleRu && item.titleEn ? { partRu: lineName(item.titleRu.trim()) } : {}),
      ...(vehicle?.make ? { make: vehicle.make } : {}),
      ...(vehicle?.model ? { model: vehicle.model } : {}),
      ...(vehicle?.year ? { year: vehicle.year } : {}),
      ...(vehicle?.vin ? { vin: vehicle.vin } : {}),
      supplierId: o.supplierId,
      ...(o.costFils !== undefined && !o.na ? { costFils: o.costFils } : {}),
      kind: o.kind,
      ...(o.brand ? { brand: o.brand } : {}),
      ...(o.na ? { na: true as const } : {}),
      ...(o.unsure ? { unsure: true as const } : {}),
      ...(o.ai ? { ai: true as const } : {}),
      via: o.msg ? ('wa' as const) : ('hand' as const),
      at: (o.msg && said.get(o.msg)) || now,
      orderId: item.orderId,
      itemId: item.id,
      updatedAt: now,
    }));
}

/** The same record, what matters of it: a price said again the same is not written again. */
export const samePoint = (a: PricePoint, b: PricePoint) =>
  a.part === b.part && a.costFils === b.costFils && a.kind === b.kind && a.brand === b.brand && !!a.na === !!b.na && a.supplierId === b.supplierId && a.make === b.make && a.model === b.model && a.vin === b.vin;

export interface PriceGroup {
  part: string;
  partRu?: string;
  /** Its prices, the newest first. */
  points: PricePoint[];
  /** The lowest price said (not «not available»). */
  best?: PricePoint;
  makes: string[];
  suppliers: number;
  last: string;
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/**
 * The book by part, the most recently priced first. `query` — the part's words, a make, a model, a VIN or a brand; `make`
 * — only the prices said for that make.
 */
export function groupPrices(points: PricePoint[], opts: { query?: string; make?: string } = {}): PriceGroup[] {
  const q = fold(opts.query?.trim() ?? '');
  const words = q.split(/\s+/).filter(Boolean);
  const by = new Map<string, PricePoint[]>();
  for (const p of points) {
    if (opts.make && p.make !== opts.make) continue;
    if (words.length) {
      const hay = fold(`${p.part} ${p.partRu ?? ''} ${p.make ?? ''} ${p.model ?? ''} ${p.vin ?? ''} ${p.brand ?? ''}`);
      if (!words.every((w) => hay.includes(w))) continue;
    }
    by.set(p.part, [...(by.get(p.part) ?? []), p]);
  }
  const out: PriceGroup[] = [];
  for (const [part, list] of by) {
    const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at));
    const priced = sorted.filter((p) => p.costFils !== undefined && !p.na);
    const best = priced.reduce<PricePoint | undefined>((m, p) => (!m || p.costFils! < m.costFils! ? p : m), undefined);
    out.push({
      part,
      partRu: sorted.find((p) => p.partRu)?.partRu,
      points: sorted,
      best,
      makes: [...new Set(sorted.map((p) => p.make).filter((m): m is string => !!m))],
      suppliers: new Set(sorted.map((p) => p.supplierId)).size,
      last: sorted[0].at,
    });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last) || a.part.localeCompare(b.part));
}

/** The makes the book has prices for, the most priced first. */
export function bookMakes(points: PricePoint[]): { make: string; n: number }[] {
  const n = new Map<string, number>();
  for (const p of points) if (p.make) n.set(p.make, (n.get(p.make) ?? 0) + 1);
  return [...n.entries()].map(([make, k]) => ({ make, n: k })).sort((a, b) => b.n - a.n || a.make.localeCompare(b.make));
}

export interface PriceHint {
  point: PricePoint;
  /** How near its car is: 3 — this VIN, 2 — the same model, 1 — the same make, 0 — another. */
  near: number;
}

/**
 * The prices said before for a line of a job (its «+ Цена»): the same part (by what its name says — domain/partMatch.ts),
 * this car first, then the same model, the same make, any; the newest first within; «not available» left out; one per
 * supplier and kind (its latest). At most `limit`.
 */
/** A paper's line fits several models («RIO/ACCENT/VELOSTR», v1.05.2): this car's among them. */
const fitsCar = (p: PricePoint, line: { make?: string; model?: string }) => !!line.make && !!line.model && !!p.fits?.some((f) => f.trim().toLowerCase() === `${line.make} ${line.model}`.trim().toLowerCase());
const fitsMake = (p: PricePoint, line: { make?: string }) => !!line.make && !!p.fits?.some((f) => f.toLowerCase().startsWith(`${line.make!.toLowerCase()} `));

export function priceHints(points: PricePoint[], line: { part: string; make?: string; model?: string; vin?: string; itemId?: string }, limit = 5): PriceHint[] {
  const cars = new Set(carWordsOf(line.make, line.model));
  const me = partName(line.part, cars);
  const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const fit = points
    .filter((p) => p.itemId !== line.itemId && !p.na && p.costFils !== undefined)
    .map((p) => ({ p, sim: p.part === lineName(line.part) ? 1 : partSimilarity(me, partName(p.part, cars)) }))
    .filter((x) => x.sim >= 0.85)
    .map(({ p }) => ({ point: p, near: line.vin && p.vin === line.vin ? 3 : (same(p.model, line.model) && same(p.make, line.make)) || fitsCar(p, line) ? 2 : same(p.make, line.make) || fitsMake(p, line) ? 1 : 0 }))
    // Another make's part is another part (a Toyota's pads are not a Nissan's): only when the car is not known.
    .filter((h) => !line.make || h.near > 0 || !h.point.make);
  fit.sort((a, b) => b.near - a.near || b.point.at.localeCompare(a.point.at));
  const seen = new Set<string>();
  const out: PriceHint[] = [];
  for (const h of fit) {
    const key = `${h.point.supplierId}|${h.point.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
