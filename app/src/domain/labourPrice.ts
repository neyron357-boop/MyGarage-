import { circle, RANK, type HistJob, type PriceContext } from './linePrices';
import { partName, partSimilarity, type PartName } from './partMatch';
import { fromNet, netFromGross } from './vat';

/*
 * The labour charge priced by the garage's own history (v0.90, the owner's note #70: «он должен быть максимально умным по
 * цене… автоматически проверял историю и проверял похожие работы по трудоёмкости и сам выставлял цены… анализировал»).
 * Without AI — what the garage charged before:
 *  - the same work before (the same parts, however each was typed — domain/partMatch.ts): its labour, from the nearest job
 *    (this car, this customer, the same model, the same make, any), the newest of them;
 *  - else each part's labour: an earlier job's labour shared among its parts (a job of one part — all of it to that part);
 *    for each part the middle of its shares in the nearest circle that has any. A part the garage never charged labour
 *    for — the middle of all its shares, and only beside a part it knows (nothing known — no price). Rounded to 5 AED,
 *    as the garage types its prices (with VAT or without).
 */

/** An earlier job with a labour charge: whose, when, its parts' names and its labour (net; with VAT if typed so). */
export interface LabourJob extends HistJob {
  orderId: string;
  /** Its day (YYYY-MM-DD…): the newest wins in a circle. */
  at: string;
  parts: string[];
  net: number;
  gross?: number;
}

export interface LabourGuess {
  /** The net price of the labour charge (one of it). */
  fils: number;
  /** With VAT, when it is typed so. */
  gross?: number;
  /** How many earlier jobs it comes from. */
  jobs: number;
  /** The same work before, or the parts' labour one by one. */
  basis: 'same' | 'parts';
}

/** Two names are one part from here up (partMatch.ts: the same words, one inside the other with the same thing). */
const ONE_PART = 0.85;
/** Rounded as prices are typed: 5 AED. */
const STEP = 500;

const read = new Map<string, PartName>();
function nameOf(s: string): PartName {
  let n = read.get(s);
  if (!n) {
    n = partName(s);
    if (read.size > 5000) read.clear();
    read.set(s, n);
  }
  return n;
}
const alike = (a: PartName, b: PartName) => partSimilarity(a, b) >= ONE_PART;
const covers = (a: PartName[], b: PartName[]) => a.every((x) => b.some((y) => alike(x, y)));
/** Each part once: an original and its copy side by side (v0.90 #72 — options) are one part to the labour. */
const once = (names: PartName[]) => names.filter((n, k) => !names.slice(0, k).some((m) => alike(m, n)));

function middle(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * The labour charge for a job of these parts, from the earlier jobs (`past`, any order; this job not among them) — or none
 * when the garage's history says nothing of them. `incl` — prices are typed with VAT (`rateBp` the VAT).
 */
export function labourGuess(parts: string[], past: LabourJob[], ctx: Omit<PriceContext, 'lang'>, rateBp: number, incl: boolean): LabourGuess | undefined {
  const mine = once(parts.map(nameOf).filter((p) => p.tokens.length));
  if (!mine.length) return undefined;
  const jobs = past
    .filter((j) => j.net > 0 && j.parts.length && j.orderId !== ctx.orderId)
    .map((j) => ({ j, rank: RANK[circle(j, ctx)], names: once(j.parts.map(nameOf).filter((p) => p.tokens.length)) }))
    .filter((x) => x.names.length);
  const nearest = <T extends { rank: number; j: LabourJob }>(xs: T[]) => [...xs].sort((a, b) => b.rank - a.rank || b.j.at.localeCompare(a.j.at));

  // The same work before.
  const same = nearest(jobs.filter((x) => x.names.length === mine.length && covers(mine, x.names) && covers(x.names, mine)));
  if (same.length) {
    const { j } = same[0];
    return { fils: j.net, ...(j.gross !== undefined ? { gross: j.gross } : {}), jobs: same.length, basis: 'same' };
  }

  // Each part's labour: its share of the earlier jobs it was in, from the nearest circle that has it.
  const all = jobs.map((x) => Math.round(x.j.net / x.names.length));
  const used = new Set<string>();
  let net = 0;
  let unknown = 0;
  for (const p of mine) {
    const shares = jobs.filter((x) => x.names.some((q) => alike(p, q)));
    if (!shares.length) {
      unknown++;
      continue;
    }
    const best = Math.max(...shares.map((x) => x.rank));
    const near = shares.filter((x) => x.rank === best);
    near.forEach((x) => used.add(x.j.orderId));
    net += middle(near.map((x) => Math.round(x.j.net / x.names.length)));
  }
  if (unknown === mine.length) return undefined;
  if (unknown) net += unknown * middle(all);
  if (incl && rateBp > 0) {
    const gross = Math.max(STEP, Math.round(fromNet(net, rateBp).gross / STEP) * STEP);
    return { fils: netFromGross(gross, rateBp), gross, jobs: used.size, basis: 'parts' };
  }
  return { fils: Math.max(STEP, Math.round(net / STEP) * STEP), jobs: used.size, basis: 'parts' };
}
