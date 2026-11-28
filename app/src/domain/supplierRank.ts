import { canonicalMake } from './carCatalog';
import { chatMakes, rateSeen, seenOf, type ChatRating, type ChatSeen, type KnownMake } from './chatStudy';
import { expandToken, indexText, matchToken, tokenize, type Indexed } from './search';
import type { ChatFact, Supplier } from './types';

/*
 * Suppliers by what the garage did with them (v0.38): how many jobs and parts, for which makes, how lately, how many
 * parts went back — and the manager's own stars (`Supplier.reliability`, 1–5). For a job, the ones that fit it come
 * first: already on its lines, bought from for this make, sold such a part before, declared the make or the part —
 * then the stars, the habit (jobs), how lately; a part given back counts against. Pure — the lines are read by
 * `services/supplierRank.ts`.
 * v0.91 (the owner: «те кто долго или часто пишут нету в наличии или не отвечает — снизить рейтинг; кто чаще всего
 * отвечает, быстро и часто даёт цены — повысить и при поиске деталей показывать самыми первыми»; «на какие марки авто она
 * часто отвечает — учесть»): what its WhatsApp chat taught (`SupplierKnow`, domain/chatStudy.ts) — how it answers the
 * garage's requests counts in every list, the makes it answered for (and those given by hand or said by the AI) for a job.
 */

/** A line bought from a supplier, or handed to a contractor — as the ranking reads it. */
export interface BoughtLine {
  supplierId: string;
  orderId: string;
  /** When (ordered, received, or the line made). */
  at: string;
  /** The car's make. */
  make?: string;
  /** Its names (both languages) and part number. */
  title: string;
  /** Its name as shown (what was bought: «Брали: …»). */
  name?: string;
  /** v1.05.1: the car's model, and what one piece cost (the line's cost, the invoice's price). */
  model?: string;
  /** v1.05.2: the other models it fits (a paper's line «RIO/ACCENT/VELOSTR»). */
  models?: string[];
  fils?: number;
  /** v1.05: off a supplier's paper invoice (`orderId` is the paper's): a purchase, not a job. */
  paper?: true;
}

export interface SupplierUse {
  /** Jobs it supplied (or worked on). */
  jobs: number;
  /** v1.05: its paper invoices read (purchases before the app, or never put on a job). */
  papers: number;
  /** Lines bought from it. */
  lines: number;
  /** Jobs per make (canonical, lower case). */
  makeJobs: Record<string, number>;
  lastAt?: string;
  /** Parts given back to it. */
  returns: number;
}

const NONE: SupplierUse = { jobs: 0, papers: 0, lines: 0, makeJobs: {}, returns: 0 };

/** Jobs and paper invoices alike: how much the garage bought from it. */
export const buys = (u: Pick<SupplierUse, 'jobs' | 'papers'>) => u.jobs + u.papers;

const makeKey = (m?: string) => (m ? canonicalMake(m).toLowerCase() : '');
const modelKey = (m?: string) => (m ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function supplierUse(lines: BoughtLine[], returns: { supplierId?: string }[] = []): Map<string, SupplierUse> {
  const jobs = new Map<string, Set<string>>();
  const papers = new Map<string, Set<string>>();
  const byMake = new Map<string, Map<string, Set<string>>>();
  const out = new Map<string, SupplierUse>();
  const get = (id: string) => {
    let u = out.get(id);
    if (!u) out.set(id, (u = { jobs: 0, papers: 0, lines: 0, makeJobs: {}, returns: 0 }));
    return u;
  };
  for (const l of lines) {
    const u = get(l.supplierId);
    u.lines++;
    if (!u.lastAt || l.at > u.lastAt) u.lastAt = l.at;
    const into = l.paper ? papers : jobs;
    let js = into.get(l.supplierId);
    if (!js) into.set(l.supplierId, (js = new Set()));
    js.add(l.orderId);
    const m = makeKey(l.make);
    if (!m) continue;
    let bm = byMake.get(l.supplierId);
    if (!bm) byMake.set(l.supplierId, (bm = new Map()));
    let mj = bm.get(m);
    if (!mj) bm.set(m, (mj = new Set()));
    mj.add(l.orderId);
  }
  for (const [id, js] of jobs) get(id).jobs = js.size;
  for (const [id, ps] of papers) get(id).papers = ps.size;
  for (const [id, bm] of byMake) for (const [m, js] of bm) get(id).makeJobs[m] = js.size;
  for (const r of returns) if (r.supplierId) get(r.supplierId).returns++;
  return out;
}

export const useOf = (use: Map<string, SupplierUse>, id: string): SupplierUse => use.get(id) ?? NONE;

/** What a supplier's WhatsApp chat taught the garage (v0.91). */
export interface SupplierKnow {
  seen: ChatSeen;
  rating?: ChatRating;
  /** Makes it is known for (by hand on a chat not of the base, answered for, said by the AI). */
  makes: KnownMake[];
}

/** A chat's record as the ranking reads it; `hand` — the makes on the supplier's card (they come first). */
export function knowOf(fact: Pick<ChatFact, 'turns' | 'makes' | 'aiMakes'> | undefined, now: string, hand?: string[]): SupplierKnow | undefined {
  if (!fact && !hand?.length) return undefined;
  const seen = seenOf(fact?.turns, Date.parse(now));
  return { seen, rating: rateSeen(seen), makes: chatMakes({ hand: hand?.length ? hand : fact?.makes, seen, ai: fact?.aiMakes }) };
}

/* ---------- The garage's main suppliers (v0.91.6) ---------- */

/**
 * The owner (27/11): «после загрузки всех их — сопоставить самых релевантных, с которыми чаще работал, чаще отвечали…
 * закреплять всегда на первые позиции… везде в приложении самыми первыми». How much the garage works with a supplier: the
 * requests it answered, those with a price (worth more), the jobs bought from it (worth most) — weighed by how it answers
 * (a silent one or one of «not available» — less, a fast one with prices — more).
 */
export function relevance(seen: Pick<ChatSeen, 'answered' | 'priced'> | undefined, jobs = 0, rating?: ChatRating): number {
  const work = (seen?.answered ?? 0) + 1.5 * (seen?.priced ?? 0) + 3 * jobs;
  const q = rating ? Math.max(0.5, Math.min(1.5, 1 + rating.score / 60)) : 1;
  return Math.round(work * q * 10) / 10;
}
/** Main from this much work on (six answered requests, or two jobs); at most so many by themselves. */
export const TOP_MIN = 6;
export const TOP_MAX = 15;

export interface TopCandidate {
  key: string;
  score: number;
  /** Pinned by hand on top, or taken off by hand. */
  pin?: 'on' | 'off';
  /** Answers badly (silent, «not available» again and again): not main by itself. */
  bad?: boolean;
}

/** The main suppliers, in their order: pinned by hand (all of them) first, then up to `max` most worked with. */
export function pickTop(list: TopCandidate[], max = TOP_MAX): string[] {
  const by = (a: TopCandidate, b: TopCandidate) => b.score - a.score || a.key.localeCompare(b.key);
  const on = list.filter((x) => x.pin === 'on').sort(by);
  const auto = list
    .filter((x) => !x.pin && !x.bad && x.score >= TOP_MIN)
    .sort(by)
    // Their own room (v0.91.7): the ones pinned by hand do not push out the ones the work found — 42 pinned by hand left none.
    .slice(0, max);
  return [...on, ...auto].map((x) => x.key);
}

/** The stars a supplier shows: the manager's own, else the ones its answers earned (`auto`). */
export function shownStars(s: Pick<Supplier, 'reliability'>, k?: SupplierKnow): { n: number; auto?: true } | undefined {
  const own = starsOf(s);
  if (own) return { n: own };
  return k?.rating ? { n: k.rating.stars, auto: true } : undefined;
}

/** The manager's stars, 1–5 (none — not rated). */
export const starsOf = (s: Pick<Supplier, 'reliability'>): number | undefined => (s.reliability && s.reliability >= 1 ? Math.min(5, Math.round(s.reliability)) : undefined);

const DAY = 86_400_000;

/** What counts for any job: the stars, the habit, how lately, the parts given back, how it answers on WhatsApp. */
function standing(s: Supplier, u: SupplierUse, now: string, k?: SupplierKnow): number {
  const stars = starsOf(s);
  let score = stars ? (stars - 3) * 10 : 0;
  score += k?.rating?.score ?? 0;
  score += Math.min(20, 6 * Math.log2(1 + buys(u)));
  if (u.lastAt) {
    const days = (Date.parse(now) - Date.parse(u.lastAt)) / DAY;
    score += days <= 30 ? 8 : days <= 120 ? 4 : 0;
  }
  score -= Math.min(15, 5 * u.returns);
  // The manager's mark (v0.71): a good one up, one that does not answer down — in every list.
  if (s.mark === 'good') score += 20;
  else if (s.mark === 'silent') score -= 20;
  return score;
}

/** The suppliers list (Запчасти → Поставщики): the main ones first in their order (v0.91.6), then most used and best rated, then by name. */
export function rankSuppliers(list: Supplier[], use: Map<string, SupplierUse>, now: string, know?: Map<string, SupplierKnow>, top?: Map<string, number>): Supplier[] {
  const score = new Map(list.map((s) => [s.id, standing(s, useOf(use, s.id), now, know?.get(s.id))]));
  const rank = (s: Supplier) => top?.get(s.id) ?? Infinity;
  return [...list].sort((a, b) => rank(a) - rank(b) || score.get(b.id)! - score.get(a.id)! || a.name.localeCompare(b.name));
}

/** Why a supplier fits this job — shown under its name. */
export type Why =
  | { kind: 'onJob' }
  | { kind: 'boughtFor'; make: string; jobs: number }
  /** It sold such a part (v1.05.1: for this very model — `model`, its last price `fils`). */
  | { kind: 'sold'; part: string; times: number; model?: string; fils?: number }
  | { kind: 'make'; make: string }
  | { kind: 'sells'; part: string }
  /** The manager's mark (v0.71): good — first, silent — does not answer, last. */
  | { kind: 'good' }
  | { kind: 'silent' }
  /** v0.91: its WhatsApp answered requests for this make so many times; the AI says it deals with it. */
  | { kind: 'answers'; make: string; n: number }
  | { kind: 'aiMake'; make: string }
  /** v0.91.6: one of the garage's main suppliers. */
  | { kind: 'top' };

export interface Ranked {
  supplier: Supplier;
  score: number;
  use: SupplierUse;
  why: Why[];
  /** What its chat taught (v0.91). */
  know?: SupplierKnow;
  /** A supplier only in WhatsApp (v0.91): its chat — it becomes one of the base when it is asked. */
  chat?: string;
}

export interface JobNeeds {
  make?: string;
  /** v1.05.1: the car's model — a part sold for this very model counts most. */
  model?: string;
  /** The job's parts (or service lines for contractors): their shown name and what is searched. */
  parts: { name: string; title: string }[];
  /** Suppliers already on its lines (picked, offered, handed to). */
  onJob: Set<string>;
}

/** Words that say nothing of which part (a side, a set, "new"). */
const NOISE = new Set(['front', 'rear', 'left', 'right', 'lh', 'rh', 'fr', 'rr', 'set', 'kit', 'assy', 'new', 'used', 'original', 'oem', 'part', 'parts', 'and', 'for', 'with', 'перед', 'передн', 'задн', 'лев', 'прав', 'комплект', 'новый', 'новая', 'для']);

function partTerms(title: string) {
  return tokenize(title)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.has(w))
    .map((w) => ({ w, terms: expandToken(w) }));
}

/** Does this text speak of this part (any of its telling words, in either language)? */
function speaksOf(part: ReturnType<typeof partTerms>, x: Indexed): boolean {
  return part.some((p) => !!matchToken(p.w, p.terms, x));
}

/**
 * The suppliers for a job, the best fit first — every one of them (v0.91, the owner's note #74: «при отправке не все
 * поставщики отображаются, но нужно чтобы все, при поиске особенно»); `fitOf` says which have a reason.
 */
export function rankForJob(list: Supplier[], use: Map<string, SupplierUse>, history: BoughtLine[], job: JobNeeds, now: string, know?: Map<string, SupplierKnow>, top?: Map<string, number>): Ranked[] {
  const make = makeKey(job.make);
  const model = modelKey(job.model);
  const parts = job.parts.map((p) => ({ name: p.name, terms: partTerms(p.title) })).filter((p) => p.terms.length);
  // What each supplier sold before, prepared once.
  const sold = new Map<string, { x: Indexed; name?: string; make?: string; model?: string; models?: string[]; fils?: number }[]>();
  for (const l of history) {
    let a = sold.get(l.supplierId);
    if (!a) sold.set(l.supplierId, (a = []));
    a.push({ x: indexText(l.title), name: l.name, make: l.make, model: l.model, models: l.models, fils: l.fils });
  }
  // Taken off by the manager (v0.71): not in a job's list (`offOf` — folded under it).
  const ranked = list.filter((s) => s.mark !== 'off').map((s): Ranked => {
    const u = useOf(use, s.id);
    const k = know?.get(s.id);
    const why: Why[] = [];
    let score = standing(s, u, now, k);
    // Marked good — first, whatever else; marked silent — last (v0.71, «самые хорошие наверху»).
    if (s.mark === 'good') {
      score += 1000;
      why.push({ kind: 'good' });
    } else if (s.mark === 'silent') {
      score -= 1000;
      why.push({ kind: 'silent' });
    }
    // The garage's main suppliers (v0.91.6): first, as the manager's own good ones — among them, the best fit for this job.
    if (top?.has(s.id) && s.mark !== 'silent') {
      score += 1000;
      why.push({ kind: 'top' });
    }
    if (job.onJob.has(s.id)) {
      score += 100;
      why.push({ kind: 'onJob' });
    }
    const forMake = make ? u.makeJobs[make] ?? 0 : 0;
    if (forMake) {
      score += Math.min(30, 10 * forMake);
      why.push({ kind: 'boughtFor', make: canonicalMake(job.make!), jobs: forMake });
    }
    const theirs = sold.get(s.id) ?? [];
    let partsSold = 0;
    let carSold = 0;
    let firstSold: Why | undefined;
    let forCar: Why | undefined;
    for (const p of parts) {
      const same = theirs.filter((h) => speaksOf(p.terms, h.x));
      if (!same.length) continue;
      partsSold++;
      // v1.05.1 (the owner: «такой же деталь для такого же автомобиля — ты покупал у этого поставщика»): for this very model.
      const mine = model ? same.filter((h) => (modelKey(h.model) === model && (!make || !h.make || makeKey(h.make) === make)) || !!h.models?.some((m) => modelKey(m) === model)) : [];
      if (mine.length) {
        carSold++;
        const last = mine[mine.length - 1];
        forCar ??= { kind: 'sold', part: last.name || p.name, times: mine.length, model: job.model, ...(last.fils ? { fils: last.fils } : {}) };
      }
      // What they sold (its own name, the latest), else the job's part.
      firstSold ??= { kind: 'sold', part: same.at(-1)!.name || p.name, times: same.length };
    }
    if (forCar) {
      score += Math.min(120, 60 * carSold) + Math.min(20, 10 * partsSold);
      why.push(forCar);
    } else if (firstSold) {
      score += Math.min(40, 20 * partsSold);
      why.push(firstSold);
    }
    const declared = make && s.makes?.some((m) => makeKey(m) === make);
    // What its chat says of the make (v0.91): given by hand to a chat, answered for again and again, said by the AI.
    const known = make && !declared ? k?.makes.find((m) => makeKey(m.make) === make) : undefined;
    if (declared || known?.by === 'hand') {
      score += 30;
      if (!forMake) why.push({ kind: 'make', make: canonicalMake(job.make!) });
    } else if (known?.by === 'seen') {
      score += Math.min(30, 8 * (known.n ?? 1));
      if (!forMake) why.push({ kind: 'answers', make: known.make, n: known.n ?? 1 });
    } else if (known?.by === 'ai') {
      score += 12;
      if (!forMake) why.push({ kind: 'aiMake', make: known.make });
    } else if (make && (s.makes?.length || k?.makes.some((m) => m.by !== 'ai'))) score -= 10;
    if (s.parts) {
      const x = indexText(s.parts);
      const p = parts.find((q) => speaksOf(q.terms, x));
      if (p) {
        score += 20;
        if (!firstSold) why.push({ kind: 'sells', part: p.name });
      }
    }
    return { supplier: s, score, use: u, why, ...(k ? { know: k } : {}) };
  });
  ranked.sort((a, b) => b.score - a.score || buys(b.use) - buys(a.use) || a.supplier.name.localeCompare(b.supplier.name));
  return ranked;
}

/** A supplier with a reason to be asked for this job (on it, its make, its part, its stars, how it answers). */
export const fitOf = (r: Ranked): boolean => r.why.length > 0 || buys(r.use) > 0 || !!starsOf(r.supplier) || !!r.know?.rating;
