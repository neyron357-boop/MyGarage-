/*
 * A VIN's line found by its characters (v0.35), the way the number plate's is (domain/plateGlyphs.ts) — not by its
 * outline as a line of text: on a VIN plate the VIN is the one row of about seventeen separate marks of one height,
 * side by side at an even pitch, at whatever slant the phone held it. The plate's other lines are not: Arabic words run
 * joined, with dots and tails of every height; the frame is one long mark; a label's words are short. Pure work on the
 * photo's brightness — the reading of the row is the OCR's (services/vinReader.ts).
 */

import { charLike, glyphsOf, gh, gw, inkOf, type Glyph } from './plateGlyphs';

/** A row of characters that may be a VIN: its marks, its middle, length and characters' height (px), its slope. */
export interface VinRow {
  glyphs: Glyph[];
  cx: number;
  cy: number;
  /** Its length along its slope. */
  w: number;
  /** Its characters' height. */
  h: number;
  /** From one character's middle to the next's. */
  pitch: number;
  /** Degrees, down to the right; −90 < angle ≤ 90 (which end it begins at is the reading's to tell). */
  angle: number;
  /** Dark characters on a light ground (else light on dark: a stamped plate, white print on black). */
  dark: boolean;
  score: number;
}

const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : 0;
};

/** A mark seen along a slope: its middle along (u) and across (v) it, how far it reaches along and across. */
interface Seen {
  g: Glyph;
  u: number;
  v: number;
  eu: number;
  ev: number;
}

function seenAt(gs: Glyph[], deg: number): Seen[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const ac = Math.abs(c);
  const as = Math.abs(s);
  return gs.map((g) => {
    const x = (g.x0 + g.x1) / 2;
    const y = (g.y0 + g.y1) / 2;
    const w = gw(g);
    const h = gh(g);
    return { g, u: x * c + y * s, v: -x * s + y * c, eu: w * ac + h * as, ev: w * as + h * ac };
  });
}

/**
 * The marks joined into rows along one slope: each to the nearest mark ahead of it that stands beside it (of a height,
 * on its line, a character's gap away) — and each taken by one mark behind it only, so two lines never join at a fork.
 */
function chainsAt(gs: Glyph[], deg: number): Seen[][] {
  const items = seenAt(gs, deg).sort((a, b) => a.u - b.u);
  const n = items.length;
  const next = new Int32Array(n).fill(-1);
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const a = items[i];
    const end = a.u + a.eu / 2;
    let best = -1;
    let bestCost = Infinity;
    for (let j = i + 1; j < n; j++) {
      const b = items[j];
      // Sorted by their middles: a partner (no more than half as tall again) has its middle within reach.
      if (b.u > end + 4 * a.ev) break;
      const size = Math.max(a.ev, b.ev);
      if (b.u - b.eu / 2 > end + 1.3 * size) continue;
      if (Math.min(a.ev, b.ev) < size * 0.7) continue;
      const dv = Math.abs(b.v - a.v);
      if (dv > size * 0.3) continue;
      const gap = b.u - b.eu / 2 - end;
      if (gap < -size * 0.25) continue;
      const c = Math.max(0, gap) + 2 * dv;
      if (c < bestCost) (bestCost = c), (best = j);
    }
    if (best < 0) continue;
    if (prev[best] < 0 || bestCost < cost[best]) {
      if (prev[best] >= 0) next[prev[best]] = -1;
      prev[best] = i;
      next[i] = best;
      cost[best] = bestCost;
    }
  }
  const chains: Seen[][] = [];
  for (let i = 0; i < n; i++) {
    if (prev[i] >= 0) continue;
    const chain: Seen[] = [];
    for (let k = i; k >= 0; k = next[k]) chain.push(items[k]);
    if (chain.length >= 6) chains.push(chain);
  }
  return chains;
}

/** How much a count of marks is a VIN's: seventeen; a few more or fewer (a letter broken in two, two touching). */
const COUNT = (n: number) =>
  n === 17 ? 1 : n === 16 || n === 18 ? 0.92 : n === 15 || n === 19 ? 0.82 : n >= 13 && n <= 21 ? 0.62 : n >= 10 && n <= 24 ? 0.4 : n >= 7 ? 0.2 : 0;

/**
 * How much a run of marks (in order along the slope) looks like a VIN: about seventeen of them, of one height, their
 * middles on one line, at an even pitch about their height, each taller than wide. 0 — not at all.
 */
function scoreRun(run: Seen[]): number {
  const n = run.length;
  const count = COUNT(n);
  if (!count) return 0;
  const H = median(run.map((s) => s.ev));
  if (H <= 0) return 0;
  const spread = Math.sqrt(run.reduce((t, s) => t + (s.ev - H) ** 2, 0) / n) / H;
  const { slope, rms } = fit(run);
  if (Math.abs(slope) > 0.2) return 0;
  const off = rms / H;
  const pitches = run.slice(1).map((s, i) => s.u - run[i].u);
  const P = median(pitches);
  if (P < H * 0.35 || P > H * 1.5) return 0;
  const even = pitches.filter((p) => Math.abs(p - P) <= Math.max(2, P * 0.3)).length / pitches.length;
  // Taller than wide (a column of stacked lines, seen along it, is wider than tall).
  const wide = median(run.map((s) => s.eu)) / H;
  const shape = wide <= 1 ? 1 : Math.max(0, 1 - (wide - 1) * 2.5);
  return count * Math.max(0, 1 - spread * 3) * Math.max(0, 1 - off * 4) * (0.3 + 0.7 * even) * shape * Math.sqrt(H);
}

/** The line through the marks' middles: its slope (across per along) and how far they stand off it. */
function fit(run: Seen[]): { slope: number; at: number; rms: number } {
  const n = run.length;
  const mu = run.reduce((t, s) => t + s.u, 0) / n;
  const mv = run.reduce((t, s) => t + s.v, 0) / n;
  let suv = 0;
  let suu = 0;
  for (const s of run) (suv += (s.u - mu) * (s.v - mv)), (suu += (s.u - mu) ** 2);
  const slope = suu ? suv / suu : 0;
  const rms = Math.sqrt(run.reduce((t, s) => t + (s.v - mv - slope * (s.u - mu)) ** 2, 0) / n);
  return { slope, at: mv - slope * mu, rms };
}

/**
 * The runs of a row worth scoring: the whole of it, and — where it has wide gaps (a label's word before the VIN, a
 * VIN printed in groups) — each stretch between them and each few stretches together.
 */
function runsOf(chain: Seen[]): Seen[][] {
  const gaps = chain.slice(1).map((s, i) => s.u - s.eu / 2 - (chain[i].u + chain[i].eu / 2));
  const H = median(chain.map((s) => s.ev));
  const usual = median(gaps);
  const cuts = [0];
  gaps.forEach((g, i) => g > Math.max(usual * 2.2, H * 0.45) && cuts.push(i + 1));
  cuts.push(chain.length);
  const out: Seen[][] = [chain];
  for (let a = 0; a < cuts.length - 1; a++)
    for (let b = a + 1; b < cuts.length && b <= a + 4; b++) if (a > 0 || b < cuts.length - 1) out.push(chain.slice(cuts[a], cuts[b]));
  return out;
}

/** A run as a row: its middle, length and slope on the picture, its characters' height. */
function rowOf(run: Seen[], deg: number, dark: boolean, score: number): VinRow {
  const turn = (Math.atan(fit(run).slope) * 180) / Math.PI;
  let angle = deg + turn;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const seen = seenAt(run.map((s) => s.g), angle);
  const u0 = Math.min(...seen.map((s) => s.u - s.eu / 2));
  const u1 = Math.max(...seen.map((s) => s.u + s.eu / 2));
  const { slope, at } = fit(seen);
  const uc = (u0 + u1) / 2;
  const vc = at + slope * uc;
  const r = (angle * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // A mark's box at a slant is taller than the mark: its height is what the box's two sides say together (near a
  // level row, nearly the box's own).
  const as = Math.abs(s);
  const c2 = c * c - s * s;
  const heights = run.map(({ g }) => {
    const ev = gw(g) * as + gh(g) * Math.abs(c);
    if (c2 < 0.5) return ev * 0.8;
    const own = (gh(g) * Math.abs(c) - gw(g) * as) / c2;
    return Math.min(ev, Math.max(ev * 0.5, own));
  });
  const order = [...seen].sort((a, b) => a.u - b.u);
  const pitch = median(order.slice(1).map((x, i) => x.u - order[i].u));
  return { glyphs: run.map((x) => x.g), cx: uc * c - vc * s, cy: uc * s + vc * c, w: u1 - u0, h: median(heights), pitch, angle, dark, score };
}

/** The rows of one picture's marks, at every slant (a quarter turn either way — a plate shot sideways too). */
export function rowsOfMarks(glyphs: Glyph[], dark: boolean, step = 4): VinRow[] {
  const found: VinRow[] = [];
  for (let deg = -88; deg <= 90; deg += step) {
    for (const chain of chainsAt(glyphs, deg)) {
      let best: Seen[] | undefined;
      let bestScore = 0;
      for (const run of runsOf(chain)) {
        const sc = scoreRun(run);
        if (sc > bestScore) (bestScore = sc), (best = run);
      }
      if (best) found.push(rowOf(best, deg, dark, bestScore));
    }
  }
  return found;
}

/** The same row found twice (at two slants near each other, or in two ways of taking the ink): mostly the same place. */
function sameRow(a: VinRow, b: VinRow): boolean {
  const shared = a.glyphs.filter((g) => b.glyphs.includes(g)).length;
  if (shared >= Math.min(a.glyphs.length, b.glyphs.length) * 0.5) return true;
  const d = Math.abs(a.angle - b.angle) % 180;
  return Math.min(d, 180 - d) < 15 && Math.hypot(a.cx - b.cx, a.cy - b.cy) < Math.max(a.h, b.h) && Math.abs(a.w - b.w) < Math.max(a.w, b.w) * 0.3;
}

/**
 * The photo's brightness stretched towards the full range (its darkest and lightest hundredth left out): a dim photo's
 * faint print shows. At most threefold — a clean label with little print would have its paper's grain stretched into ink.
 */
function stretched(Y: Float32Array): Float32Array {
  const sorted = Float32Array.from(Y).sort();
  const lo = sorted[Math.floor(Y.length * 0.01)];
  const span = Math.max(85, sorted[Math.floor(Y.length * 0.99)] - lo);
  return Y.map((v) => Math.max(0, Math.min(255, ((v - lo) * 255) / span)));
}

/** Ink grown by a point each way: the strokes of a thin or worn print, broken into specks, joined into its letters. */
function grown(ink: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(ink.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ink[i] || (x > 0 && ink[i - 1]) || (x < W - 1 && ink[i + 1]) || (y > 0 && ink[i - W]) || (y < H - 1 && ink[i + W])) out[i] = 1;
    }
  return out;
}

/**
 * The ways a photo's ink is taken, each showing plates the others miss: by the light around each point over a wide
 * reach (most plates) and a narrow one (a VIN on a strip narrower than the wide reach — the strip all one blot
 * otherwise), thin print grown into its letters, and each of several shades across the photo (silver letters on a
 * silver strip in a black frame come out whole only at one shade between them).
 */
export type InkWay = 'wide' | 'narrow' | 'grown' | 'shades';

/**
 * The likeliest VIN rows of a photo (its brightness, `W`×`H`), best first: its marks — dark on light and light on
 * dark, taken each of `ways` — joined into rows at every slant, each row scored by how much it is a VIN's.
 */
export function vinRows(Y0: Float32Array, W: number, H: number, keep = 5, ways: InkWay[] = ['wide', 'narrow', 'grown', 'shades']): VinRow[] {
  const Y = stretched(Y0);
  const side = Math.min(W, H);
  const minH = Math.max(8, Math.round(side * 0.012));
  const found: VinRow[] = [];
  // A character's mark, upright or lying on its side (a plate shot sideways: its row runs up the photo).
  const lying = (g: Glyph): Glyph => ({ x0: g.y0, y0: g.x0, x1: g.y1, y1: g.x1, area: g.area });
  const take = (ink: Uint8Array, dark: boolean) => {
    const marks = glyphsOf(ink, W, H).filter((g) => (charLike(g, H, minH) && gh(g) <= side * 0.25) || (charLike(lying(g), W, minH) && gw(g) <= side * 0.25));
    found.push(...rowsOfMarks(marks, dark));
  };
  for (const dark of [true, false]) {
    if (ways.includes('wide') || ways.includes('grown')) {
      const ink = inkOf(Y, W, H, Math.max(10, Math.round(side / 24)), dark);
      if (ways.includes('wide')) take(ink, dark);
      if (ways.includes('grown')) take(grown(ink, W, H), dark);
    }
    if (ways.includes('narrow')) take(inkOf(Y, W, H, Math.max(8, Math.round(side / 60)), dark), dark);
  }
  if (ways.includes('shades')) {
    const sorted = Float32Array.from(Y).sort();
    const lo = sorted[Math.floor(Y.length * 0.05)];
    const hi = sorted[Math.floor(Y.length * 0.95)];
    const ink = new Uint8Array(Y.length);
    for (let k = 1; k <= 5; k++) {
      const t = lo + ((hi - lo) * k) / 6;
      for (const dark of [true, false]) {
        for (let i = 0; i < Y.length; i++) ink[i] = Y[i] < t === dark ? 1 : 0;
        take(ink, dark);
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const out: VinRow[] = [];
  for (const r of found) {
    if (out.some((o) => sameRow(o, r))) continue;
    out.push(r);
    if (out.length >= keep) break;
  }
  return out;
}
