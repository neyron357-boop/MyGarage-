import { lineName } from './items';
import { expandToken, indexText, matchToken } from './search';
import { withMarkup } from './money';
import { enteredPrice, priceFromEntered, vatModeOf } from './vat';
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

export function priceHints(points: PricePoint[], line: { part: string; make?: string; model?: string; vin?: string; itemId?: string }, limit = 5, minSim = 0.85): PriceHint[] {
  const cars = new Set(carWordsOf(line.make, line.model));
  const me = partName(line.part, cars);
  const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const fit = points
    .filter((p) => p.itemId !== line.itemId && !p.na && p.costFils !== undefined)
    .map((p) => ({ p, sim: p.part === lineName(line.part) ? 1 : partSimilarity(me, partName(p.part, cars)) }))
    .filter((x) => x.sim >= minSim)
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

/* ---------- The garage's history at work (v1.06) ---------- */

/*
 * The owner (28/11, 428 invoices scanned, «ещё 1000–2000»): «во время того как сделали диагностику… записал все запчасти…
 * приложение уже выставляло цены из истории, где такая же деталь для такого же автомобиля уже закупалась… сделать смету и
 * сразу предоставить клиенту, не дождавшись ответа поставщиков»; «в мини-карточках деталей — те, что уже есть в истории, с
 * ценами по выбору… цена сама выставлялась в цене закупки».
 */

/** What was bought: a paper invoice's line — a purchase, surer than a supplier's word. */
const bought = (p: PricePoint) => p.via === 'paper';

/**
 * The prices of this part for this car the garage knows (a line of a job): a known car only — this VIN or the same model (or
 * a model the paper's line fits) — 2 and up, the same make — 1 (a part of a car not said is no price for this one); bought
 * before told, the newest first within; one per supplier and kind; no service's line. At most `limit`.
 */
export function historyOffers(points: PricePoint[], line: { part: string; make?: string; model?: string; vin?: string; itemId?: string }, limit = 3): PriceHint[] {
  if (!line.make && !line.vin) return [];
  return priceHints(
    points.filter((p) => !!p.supplierId && !p.service),
    line,
    40,
    // the very part (0.85 is a piece of another — «TAIL LIGHT COVER» for «TAIL LIGHT»: another price)
    0.9,
  )
    .filter((h) => h.near >= 1)
    .sort((a, b) => b.near - a.near || Number(bought(b.point)) - Number(bought(a.point)) || b.point.at.localeCompare(a.point.at))
    .slice(0, limit);
}

/** The one taken by itself («Цены из истории»): bought for this very car (its model, its VIN) — the newest; told — only if none was bought. */
export function historyBest(offers: PriceHint[]): PriceHint | undefined {
  return offers.filter((h) => h.near >= 2).sort((a, b) => Number(bought(b.point)) - Number(bought(a.point)) || b.point.at.localeCompare(a.point.at))[0];
}

export interface BoughtHit {
  point: PricePoint;
  /** How near its car is to the one searched: 2 — the model, 1 — the make, 0 — none named (or the paper said none). */
  near: number;
}

/**
 * The parts bought before, searched (v1.06, the owner: «в поиске поставщиков… любую запчасть из истории инвойсов… передний
 * бампер Toyota Land Cruiser… у этого поставщика уже куплена была вот эта деталь для такого-то автомобиля»): the paper invoices'
 * lines whose part has every word searched that is not the car's (in either language, through the garage's dictionary —
 * domain/search.ts), for the car named (`car` — its make, its model) — the same model first, the same make, then those whose
 * paper named no car; another make's — never. The newest first; one per supplier, part and model.
 */
export function searchBought(points: PricePoint[], words: { tokens: string[]; car?: { make?: string; model?: string } }, limit = 40): BoughtHit[] {
  const terms = words.tokens.map((tk) => ({ tk, terms: expandToken(tk) }));
  const make = words.car?.make?.toLowerCase();
  const model = words.car?.model?.toLowerCase();
  if (!terms.length && !make) return [];
  const hits: BoughtHit[] = [];
  for (const p of points) {
    if (!bought(p) || !p.supplierId || p.service || p.costFils === undefined) continue;
    let near = 0;
    if (make) {
      const pm = p.make?.toLowerCase();
      const fitMake = !!p.fits?.some((f) => f.toLowerCase().startsWith(`${make} `));
      const fitModel = !!model && (p.model?.toLowerCase() === model || !!p.fits?.some((f) => f.toLowerCase() === `${make} ${model}`));
      // another make's part is another part
      if (pm && pm !== make && !fitMake) continue;
      // the paper named no car — 0; the model searched — 2; only a make searched — every line of it; another model of it — 1
      near = !pm && !fitMake ? 0 : fitModel || !model ? 2 : 1;
    }
    if (terms.length) {
      const x = indexText(`${p.part} ${p.partRu ?? ''} ${p.name ?? ''}`);
      if (!terms.every(({ tk, terms }) => matchToken(tk, terms, x))) continue;
    }
    hits.push({ point: p, near });
  }
  hits.sort((a, b) => b.near - a.near || b.point.at.localeCompare(a.point.at));
  const seen = new Set<string>();
  const out: BoughtHit[] = [];
  for (const h of hits) {
    const k = `${h.point.supplierId}|${h.point.part}|${h.point.model ?? ''}|${h.point.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A line's cost from the history (`historyOffers`): the cost (one piece, without VAT, as a cost is typed), its supplier, and —
 * on a draft without a customer's price, or with the one the history put — the customer's price by the garage's markup
 * (`withMarkup`, in the line's VAT mode, as «+ Цена» counts it). The AI's and the answers' marks go: the history set it.
 */
export function historyPatch(item: Pick<OrderItem, 'approvalState' | 'unitPriceFils' | 'unitGrossFils' | 'vatRateBp' | 'costFrom'>, point: Pick<PricePoint, 'id' | 'costFils' | 'supplierId' | 'at'>, s: { defaultMarkupBp: number; vatRateBp: number; pricesIncludeVat: boolean }): Partial<OrderItem> {
  const fils = point.costFils ?? 0;
  const from: NonNullable<OrderItem['costFrom']> = { point: point.id, fils, at: point.at };
  const patch: Partial<OrderItem> = { costPriceFils: fils, supplierId: point.supplierId, costAi: undefined, costBy: undefined };
  const byHistory = item.costFrom?.price !== undefined && item.unitPriceFils === item.costFrom.price;
  if (item.approvalState === 'draft' && (!item.unitPriceFils || byHistory)) {
    const rate = item.vatRateBp || s.vatRateBp;
    const mode = vatModeOf(item, s.pricesIncludeVat);
    Object.assign(patch, priceFromEntered(enteredPrice({ unitPriceFils: withMarkup(fils, s.defaultMarkupBp) }, rate, mode), rate, mode));
    from.price = patch.unitPriceFils;
  }
  patch.costFrom = from;
  return patch;
}

/** What a line had of what `historyPatch` writes — put back by «Отменить». */
export const historyBefore = (i: OrderItem): Partial<OrderItem> => ({
  costPriceFils: i.costPriceFils,
  supplierId: i.supplierId,
  unitPriceFils: i.unitPriceFils,
  unitGrossFils: i.unitGrossFils,
  costAi: i.costAi,
  costBy: i.costBy,
  costFrom: i.costFrom,
});
