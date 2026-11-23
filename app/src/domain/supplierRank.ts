import { canonicalMake } from './carCatalog';
import { expandToken, indexText, matchToken, tokenize, type Indexed } from './search';
import type { Supplier } from './types';

/*
 * Suppliers by what the garage did with them (v0.38): how many jobs and parts, for which makes, how lately, how many
 * parts went back — and the manager's own stars (`Supplier.reliability`, 1–5). For a job, the ones that fit it come
 * first: already on its lines, bought from for this make, sold such a part before, declared the make or the part —
 * then the stars, the habit (jobs), how lately; a part given back counts against. Pure — the lines are read by
 * `services/supplierRank.ts`.
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
}

export interface SupplierUse {
  /** Jobs it supplied (or worked on). */
  jobs: number;
  /** Lines bought from it. */
  lines: number;
  /** Jobs per make (canonical, lower case). */
  makeJobs: Record<string, number>;
  lastAt?: string;
  /** Parts given back to it. */
  returns: number;
}

const NONE: SupplierUse = { jobs: 0, lines: 0, makeJobs: {}, returns: 0 };

const makeKey = (m?: string) => (m ? canonicalMake(m).toLowerCase() : '');

export function supplierUse(lines: BoughtLine[], returns: { supplierId?: string }[] = []): Map<string, SupplierUse> {
  const jobs = new Map<string, Set<string>>();
  const byMake = new Map<string, Map<string, Set<string>>>();
  const out = new Map<string, SupplierUse>();
  const get = (id: string) => {
    let u = out.get(id);
    if (!u) out.set(id, (u = { jobs: 0, lines: 0, makeJobs: {}, returns: 0 }));
    return u;
  };
  for (const l of lines) {
    const u = get(l.supplierId);
    u.lines++;
    if (!u.lastAt || l.at > u.lastAt) u.lastAt = l.at;
    let js = jobs.get(l.supplierId);
    if (!js) jobs.set(l.supplierId, (js = new Set()));
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
  for (const [id, bm] of byMake) for (const [m, js] of bm) get(id).makeJobs[m] = js.size;
  for (const r of returns) if (r.supplierId) get(r.supplierId).returns++;
  return out;
}

export const useOf = (use: Map<string, SupplierUse>, id: string): SupplierUse => use.get(id) ?? NONE;

/** The manager's stars, 1–5 (none — not rated). */
export const starsOf = (s: Pick<Supplier, 'reliability'>): number | undefined => (s.reliability && s.reliability >= 1 ? Math.min(5, Math.round(s.reliability)) : undefined);

const DAY = 86_400_000;

/** What counts for any job: the stars, the habit, how lately, the parts given back. */
function standing(s: Supplier, u: SupplierUse, now: string): number {
  const stars = starsOf(s);
  let score = stars ? (stars - 3) * 10 : 0;
  score += Math.min(20, 6 * Math.log2(1 + u.jobs));
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

/** The suppliers list (Запчасти → Поставщики): most used and best rated first, then by name. */
export function rankSuppliers(list: Supplier[], use: Map<string, SupplierUse>, now: string): Supplier[] {
  const score = new Map(list.map((s) => [s.id, standing(s, useOf(use, s.id), now)]));
  return [...list].sort((a, b) => score.get(b.id)! - score.get(a.id)! || a.name.localeCompare(b.name));
}

/** Why a supplier fits this job — shown under its name. */
export type Why =
  | { kind: 'onJob' }
  | { kind: 'boughtFor'; make: string; jobs: number }
  | { kind: 'sold'; part: string; times: number }
  | { kind: 'make'; make: string }
  | { kind: 'sells'; part: string }
  /** The manager's mark (v0.71): good — first, silent — does not answer, last. */
  | { kind: 'good' }
  | { kind: 'silent' };

export interface Ranked {
  supplier: Supplier;
  score: number;
  use: SupplierUse;
  why: Why[];
}

export interface JobNeeds {
  make?: string;
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
 * The suppliers for a job, the best fit first. Only those with a reason are returned (none fits — the most used and
 * best rated, so the screen is never empty).
 */
export function rankForJob(list: Supplier[], use: Map<string, SupplierUse>, history: BoughtLine[], job: JobNeeds, now: string): Ranked[] {
  const make = makeKey(job.make);
  const parts = job.parts.map((p) => ({ name: p.name, terms: partTerms(p.title) })).filter((p) => p.terms.length);
  // What each supplier sold before, prepared once.
  const sold = new Map<string, { x: Indexed; name?: string }[]>();
  for (const l of history) {
    let a = sold.get(l.supplierId);
    if (!a) sold.set(l.supplierId, (a = []));
    a.push({ x: indexText(l.title), name: l.name });
  }
  // Taken off by the manager (v0.71): not in a job's list (`offOf` — folded under it).
  const ranked = list.filter((s) => s.mark !== 'off').map((s): Ranked => {
    const u = useOf(use, s.id);
    const why: Why[] = [];
    let score = standing(s, u, now);
    // Marked good — first, whatever else; marked silent — last (v0.71, «самые хорошие наверху»).
    if (s.mark === 'good') {
      score += 1000;
      why.push({ kind: 'good' });
    } else if (s.mark === 'silent') {
      score -= 1000;
      why.push({ kind: 'silent' });
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
    let firstSold: Why | undefined;
    for (const p of parts) {
      const same = theirs.filter((h) => speaksOf(p.terms, h.x));
      if (!same.length) continue;
      partsSold++;
      // What they sold (its own name, the latest), else the job's part.
      firstSold ??= { kind: 'sold', part: same.at(-1)!.name || p.name, times: same.length };
    }
    if (firstSold) {
      score += Math.min(40, 20 * partsSold);
      why.push(firstSold);
    }
    const declared = make && s.makes?.some((m) => makeKey(m) === make);
    if (declared) {
      score += 30;
      if (!forMake) why.push({ kind: 'make', make: canonicalMake(job.make!) });
    } else if (make && s.makes?.length) score -= 10;
    if (s.parts) {
      const x = indexText(s.parts);
      const p = parts.find((q) => speaksOf(q.terms, x));
      if (p) {
        score += 20;
        if (!firstSold) why.push({ kind: 'sells', part: p.name });
      }
    }
    return { supplier: s, score, use: u, why };
  });
  ranked.sort((a, b) => b.score - a.score || b.use.jobs - a.use.jobs || a.supplier.name.localeCompare(b.supplier.name));
  const fit = ranked.filter((r) => r.why.length);
  return fit.length ? fit : ranked.filter((r) => r.use.jobs || starsOf(r.supplier));
}
