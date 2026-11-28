import { lineName } from './items';
import { labourWords, plainLabour } from './labourName';
import type { TogetherHint } from './together';
import type { ApprovalState, Lang, PricePoint } from './types';
import { withMarkup } from './money';

/*
 * The lines offered for one-tap adding, and the price each is offered at (v0.68, the user: «подсказки должны быть
 * максимально умными — брать цены из предыдущей истории этого автомобиля, этого клиента, этой марки и модели, чтобы
 * за такую же услугу не ставить другую цену»). Every line ever typed is history; a title's price is the one it had on
 * the job nearest to this one — this car, then this customer (a company's other cars), then the same make and model,
 * then the same make, then any job — the newest of that circle. Which titles come first follows the same circles:
 * what this car had before, then what the customer's cars had, then this model's, then the garage's usual ones (those
 * that went with a similar complaint first). Pure: the lines come from features/job/LineSheet.tsx.
 *
 * Labour and services (v0.68, the user: «в работе оставить только Labour Charges, всё остальное — в услуги»): the
 * labour sheet offers the labour charges only («LABOUR CHARGES», «LABOR …»); a service — anything else done to the car
 * (a change of oil, a wash, skimming the discs), in the garage or outside. Typing finds every one in both.
 */

/** Where a price comes from: this car, this customer, the same model, the same make, any job, the price list. */
export type PriceFrom = 'car' | 'customer' | 'model' | 'make' | 'any' | 'list';

/** A line typed before: its price (net; VAT-inclusive if typed with VAT; the VAT rate), where from and when. */
export interface Suggestion {
  titleRu: string;
  titleEn: string;
  price: number;
  gross?: number;
  rate?: number;
  /** How often it was used (a similar complaint counts more). */
  uses: number;
  from: PriceFrom;
  /** The day of the line the price is from (YYYY-MM-DD); none — the price list. */
  at?: string;
  /**
   * v1.06: bought before for this car (a supplier's paper invoice — `historyOffers`): the record, one piece's cost without VAT,
   * from whom, when, how near its car is (2 — the model, 1 — the make). A line added from it takes this cost.
   */
  bought?: { point: string; fils: number; supplierId: string; who: string; at: string; near: number };
}
export type Suggestions = { list: Map<string, Suggestion>; top: string[] };
/** Per sheet: work (the labour charges), parts, services; `work` — every line that is not a part (the job's chips). */
export type SuggestionSet = {
  labor: Suggestions;
  part: Suggestions;
  service: Suggestions;
  work: Suggestions;
  /** What usually goes with each title (audit 27/11, domain/together.ts) — the history, then the starter rules. */
  together?: Map<string, TogetherHint[]>;
};

/** A line of the history, as it is read. */
export interface HistLine {
  orderId: string;
  kind: 'labor' | 'part' | 'discount' | string;
  titleRu?: string;
  titleEn?: string;
  unitPriceFils: number;
  unitGrossFils?: number;
  vatRateBp?: number;
  approvalState: ApprovalState;
  createdAt?: string;
}
/** Its job: the car, the customer, the car's make and model, the complaint. */
export interface HistJob {
  vehicleId: string;
  customerId: string;
  make?: string;
  model?: string;
  complaint?: string;
}
/** The job the lines are for. */
export interface PriceContext {
  lang: Lang;
  orderId?: string;
  vehicleId?: string;
  customerId?: string;
  make?: string;
  model?: string;
  complaint?: string;
}
export interface PriceListLine {
  kind: string;
  titleRu: string;
  titleEn: string;
  unitPriceFils: number;
}

const words = (s: string) => s.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length >= 4);
const key = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '');

/** The labour charge itself, not a named job: a title that starts with the word for labour. */
export function isLabourCharge(title: string): boolean {
  return /^(LABOU?R|LABOUER|LABOUT|WORKMANSHIP|MAN ?HOURS?|РАБОТА|РАБОТЫ|ТРУД)(?![A-ZА-ЯЁ0-9])/.test(lineName(title.trim()));
}

/** How near a job is to this one: 5 — this car, 4 — this customer, 3 — the same model, 2 — the same make, 1 — any. */
export const RANK: Record<Exclude<PriceFrom, 'list'>, number> = { car: 5, customer: 4, model: 3, make: 2, any: 1 };
export function circle(job: HistJob | undefined, ctx: Omit<PriceContext, 'lang'>): Exclude<PriceFrom, 'list'> {
  if (!job) return 'any';
  if (ctx.vehicleId && job.vehicleId === ctx.vehicleId) return 'car';
  if (ctx.customerId && job.customerId === ctx.customerId) return 'customer';
  const make = key(ctx.make);
  if (make && key(job.make) === make) return key(ctx.model) && key(job.model) === key(ctx.model) ? 'model' : 'make';
  return 'any';
}
/** How much nearer jobs pull a title up the list (over plain use). */
const PULL: Record<PriceFrom, number> = { car: 100_000, customer: 10_000, model: 1_000, make: 0, any: 0, list: 0 };

type Acc = Suggestion & { rank: number; score: number };

/**
 * The suggestions for a job, from the history (`lines` newest first, their `jobs`) and the price list. Lines of this
 * very job are not its history; declined and cancelled ones are no price; a line without a price only counts as used.
 */
export function buildSuggestions(lines: HistLine[], jobs: Map<string, HistJob>, priceList: PriceListLine[], ctx: PriceContext): SuggestionSet {
  const maps = { part: new Map<string, Acc>(), work: new Map<string, Acc>() };
  const mine = new Set(words(ctx.complaint ?? ''));
  const alike = (job?: HistJob) => !!job && mine.size > 0 && words(job.complaint ?? '').some((w) => mine.has(w));
  const titleOf = (ru?: string, en?: string) => lineName((ctx.lang === 'ru' ? ru || en : en || ru)?.trim() ?? '');
  // A labour charge named by its job's parts (v0.80) is the same labour charge: by its words, not by the parts.
  const plain = (t?: string) => (t && plainLabour(t) ? labourWords(t) : t);
  for (const raw of lines) {
    if (raw.kind !== 'labor' && raw.kind !== 'part') continue;
    if (ctx.orderId && raw.orderId === ctx.orderId) continue;
    const it = raw.kind === 'labor' ? { ...raw, titleRu: plain(raw.titleRu), titleEn: plain(raw.titleEn) } : raw;
    const title = titleOf(it.titleRu, it.titleEn);
    if (!title) continue;
    const job = jobs.get(it.orderId);
    const from = circle(job, ctx);
    const rank = RANK[from];
    const priced = it.unitPriceFils > 0 && it.approvalState !== 'declined' && it.approvalState !== 'cancelled';
    const m = it.kind === 'part' ? maps.part : maps.work;
    const uses = alike(job) ? 50 : 1;
    const had = m.get(title);
    const s: Omit<Acc, 'uses' | 'score'> = { titleRu: it.titleRu ?? '', titleEn: it.titleEn ?? '', price: it.unitPriceFils, gross: it.unitGrossFils, rate: it.vatRateBp, from, at: it.createdAt?.slice(0, 10), rank };
    if (!had) {
      // A first sight without a price: the title is known, its price is not (yet).
      m.set(title, priced ? { ...s, uses, score: 0 } : { ...s, price: 0, gross: undefined, rate: undefined, from: 'any', at: undefined, rank: 0, uses, score: 0 });
      if (priced) m.get(title)!.score = PULL[from];
      continue;
    }
    had.uses += uses;
    had.score = Math.max(had.score, priced ? PULL[from] : 0);
    // Newest first: a nearer circle takes the price; the same circle keeps the newest one.
    if (priced && rank > had.rank) Object.assign(had, s);
  }
  for (const p of priceList)
    if (p.kind === 'labor' || p.kind === 'part') {
      const m = p.kind === 'part' ? maps.part : maps.work;
      const title = titleOf(p.titleRu, p.titleEn);
      if (!title) continue;
      const had = m.get(title);
      if (!had) m.set(title, { titleRu: p.titleRu, titleEn: p.titleEn, price: p.unitPriceFils, from: 'list', uses: 0, rank: 0, score: 0 });
      else if (!had.price && p.unitPriceFils > 0) Object.assign(had, { price: p.unitPriceFils, gross: undefined, rate: undefined, from: 'list', at: undefined });
    }
  const pack = (m: Map<string, Acc>, keep: (title: string) => boolean = () => true): Suggestions => ({
    list: m,
    top: [...m.entries()]
      .filter(([title, s]) => s.price > 0 && keep(title))
      .sort((a, b) => b[1].score + b[1].uses - (a[1].score + a[1].uses) || (b[1].at ?? '').localeCompare(a[1].at ?? ''))
      .slice(0, 12)
      .map(([k]) => k),
  });
  return {
    labor: pack(maps.work, isLabourCharge),
    service: pack(maps.work, (t) => !isLabourCharge(t)),
    part: pack(maps.part),
    work: pack(maps.work),
  };
}

/**
 * v1.06 (the owner: «в подсказках, когда набираю деталь… из истории бралось… детали, которые уже были в истории для этого
 * автомобиля, чтобы значок автомобиля был в подсказке»): the parts the garage bought for this car (its model — 2, its make — 1;
 * the suppliers' paper invoices) among a job's part suggestions — on a title of the history, said beside it; a title only
 * bought, offered with its cost at the markup as the customer's price. The newest of the nearest per title.
 */
export function withBought(part: Suggestions, points: PricePoint[], ctx: Pick<PriceContext, 'make' | 'model'>, markupBp: number, who: Map<string, string>): Suggestions {
  if (!ctx.make) return part;
  const make = ctx.make.toLowerCase();
  const model = ctx.model?.toLowerCase();
  const best = new Map<string, NonNullable<Suggestion['bought']>>();
  for (const p of points) {
    if (p.via !== 'paper' || !p.supplierId || p.service || !p.costFils) continue;
    const fits = (p.fits ?? []).map((f) => f.toLowerCase());
    const near = model && (p.model?.toLowerCase() === model || fits.includes(`${make} ${model}`)) ? 2 : p.make?.toLowerCase() === make || fits.some((f) => f.startsWith(`${make} `)) ? 1 : 0;
    if (!near) continue;
    const title = lineName(p.part.trim());
    if (!title) continue;
    const had = best.get(title);
    if (had && (had.near > near || (had.near === near && had.at >= p.at))) continue;
    best.set(title, { point: p.id, fils: p.costFils, supplierId: p.supplierId, who: who.get(p.supplierId) ?? '', at: p.at, near });
  }
  if (!best.size) return part;
  const list = new Map(part.list);
  for (const [title, b] of best) {
    const had = list.get(title);
    list.set(title, had ? { ...had, bought: b } : { titleRu: '', titleEn: title, price: withMarkup(b.fils, markupBp), uses: 1, from: b.near >= 2 ? 'model' : 'make', at: b.at.slice(0, 10), bought: b });
  }
  return { list, top: part.top };
}
