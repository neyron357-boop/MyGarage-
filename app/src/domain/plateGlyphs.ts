/*
 * A number plate found by its characters (v0.32), as plate readers do it — not as a line of text: on a photo of a car
 * the plate's number is a row of the tallest marks of one height, dark on a light ground, side by side at even gaps;
 * its code is one or two marks a size smaller beside it (on its left, as Dubai's plates have it, or over it on a short
 * plate) or of its own height before it (older plates); the emirate's word is a row of small marks near it. Pure work
 * on the photo's brightness — the reading of each part is the OCR's (services/plateReader.ts).
 */

/** A connected piece of ink: its box (inclusive) and how many points it has. */
export interface Glyph {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

export const gw = (g: Glyph) => g.x1 - g.x0 + 1;
export const gh = (g: Glyph) => g.y1 - g.y0 + 1;
const gcx = (g: Glyph) => (g.x0 + g.x1) / 2;
const gcy = (g: Glyph) => (g.y0 + g.y1) / 2;

/**
 * Ink by the light around each point (Sauvola): a point is ink when it is darker than its neighbourhood's mean by a
 * share of how much the neighbourhood varies — a plate in shade, in the sun, at night alike. Flat places have no ink.
 * `dark` false: light marks on a dark ground (a code in a coloured box).
 */
export function inkOf(Y: Float32Array, W: number, H: number, r: number, dark = true, k = 0.2): Uint8Array {
  const S = new Float64Array((W + 1) * (H + 1));
  const Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let s = 0;
    let q = 0;
    for (let x = 0; x < W; x++) {
      const v = dark ? Y[y * W + x] : 255 - Y[y * W + x];
      s += v;
      q += v * v;
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + s;
      Q[(y + 1) * (W + 1) + x + 1] = Q[y * (W + 1) + x + 1] + q;
    }
  }
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(W, x + r + 1);
      const n = (yb - ya) * (xb - xa);
      const a = ya * (W + 1) + xa;
      const b = ya * (W + 1) + xb;
      const c = yb * (W + 1) + xa;
      const d = yb * (W + 1) + xb;
      const mean = (S[d] - S[b] - S[c] + S[a]) / n;
      const vr = (Q[d] - Q[b] - Q[c] + Q[a]) / n - mean * mean;
      const sd = Math.sqrt(Math.max(0, vr));
      if (sd < 10) continue;
      const v = dark ? Y[y * W + x] : 255 - Y[y * W + x];
      if (v < mean * (1 + k * (sd / 128 - 1))) ink[y * W + x] = 1;
    }
  }
  return ink;
}

/** The ink's pieces (each point joined to its eight neighbours); `labels`, if given, gets each point's piece (its index + 1). */
export function glyphsOf(ink: Uint8Array, W: number, H: number, labels?: Int32Array): Glyph[] {
  const seen = new Uint8Array(ink.length);
  const q = new Int32Array(ink.length);
  const out: Glyph[] = [];
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    seen[s] = 1;
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;
    const id = out.length + 1;
    while (head < tail) {
      const i = q[head++];
      if (labels) labels[i] = id;
      const x = i % W;
      const y = (i - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (ink[j] && !seen[j]) {
            seen[j] = 1;
            q[tail++] = j;
          }
        }
      }
    }
    out.push({ x0, y0, x1, y1, area: tail });
  }
  return out;
}

/** A mark that may be a character: not a speck, not a stripe, not a blot, not as tall as the photo. */
export function charLike(g: Glyph, H: number, minH = 10): boolean {
  const w = gw(g);
  const h = gh(g);
  if (h < minH || h > H * 0.4) return false;
  if (w > h * 1.25 || w < h * 0.08) return false;
  const fill = g.area / (w * h);
  // A one is a bar — its box all ink; a wide mark all ink is a blot.
  return fill >= 0.12 && (fill <= 0.92 || w <= h * 0.35);
}

/** A row of marks: a number's digits (or a word's letters), level-ish, of one height. */
export interface GlyphRow {
  glyphs: Glyph[];
  /** The marks' usual height. */
  h: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Its slope, degrees (down to the right), by the marks' feet. */
  angle: number;
  /** How much it looks like a plate's number. */
  score: number;
}

const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : 0;
};

/** The slope (degrees) of the line through points, by least squares. */
function slopeOf(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) (sxy += (xs[i] - mx) * (ys[i] - my)), (sxx += (xs[i] - mx) ** 2);
  return sxx ? (Math.atan(sxy / sxx) * 180) / Math.PI : 0;
}

/** Two marks side by side in one row: of a height, level, a character's gap apart (at most `gap` of their height). */
function besideEachOther(a: Glyph, b: Glyph, gap: number): boolean {
  const ha = gh(a);
  const hb = gh(b);
  const h = Math.max(ha, hb);
  if (Math.min(ha, hb) < h * 0.72) return false;
  if (Math.abs(gcy(a) - gcy(b)) > h * 0.3) return false;
  const d = b.x0 - a.x1;
  return d >= -h * 0.15 && d <= h * gap;
}

/** Marks into rows (each joined to the next one to its right that stands beside it), ranked likeliest number first. */
export function rowsOf(glyphs: Glyph[], gap = 1.5): GlyphRow[] {
  const gs = [...glyphs].sort((a, b) => a.x0 - b.x0);
  const parent = gs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < gs.length; i++) {
    const a = gs[i];
    const reach = a.x1 + gh(a) * (gap + 0.5);
    for (let j = i + 1; j < gs.length && gs[j].x0 <= reach; j++) if (besideEachOther(a, gs[j], gap)) parent[find(j)] = find(i);
  }
  const groups = new Map<number, Glyph[]>();
  gs.forEach((g, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), g]);
  });
  const rows: GlyphRow[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.x0 - b.x0);
    const hs = list.map(gh);
    const h = median(hs);
    const angle = slopeOf(list.map(gcx), list.map((g) => g.y1));
    rows.push({
      glyphs: list,
      h,
      x0: Math.min(...list.map((g) => g.x0)),
      y0: Math.min(...list.map((g) => g.y0)),
      x1: Math.max(...list.map((g) => g.x1)),
      y1: Math.max(...list.map((g) => g.y1)),
      angle,
      score: 0,
    });
  }
  for (const r of rows) r.score = rowScore(r);
  return rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

/**
 * How much a row looks like a plate's number: two to seven marks (a code of its height may stand in it), one height,
 * feet on one line, gaps even, digit-shaped (taller than wide), large; a long row of letters (a dealer's name) is not.
 */
export function rowScore(r: GlyphRow): number {
  const n = r.glyphs.length;
  if (n < 2 || n > 8) return 0;
  if (Math.abs(r.angle) > 25) return 0;
  const hs = r.glyphs.map(gh);
  const spread = Math.sqrt(hs.reduce((s, h) => s + (h - r.h) ** 2, 0) / n) / r.h;
  // The feet: how far each stands off the line through them.
  const rad = (r.angle * Math.PI) / 180;
  const feet = r.glyphs.map((g) => g.y1 - Math.tan(rad) * (gcx(g) - r.glyphs[0].x0));
  const fm = feet.reduce((a, b) => a + b, 0) / n;
  const off = Math.sqrt(feet.reduce((s, f) => s + (f - fm) ** 2, 0) / n) / r.h;
  // Digits are taller than wide (a 1 is narrow; none is wider than tall).
  const shape = r.glyphs.filter((g) => gw(g) <= gh(g) * 0.95).length / n;
  const gaps = r.glyphs.slice(1).map((g, i) => g.x0 - r.glyphs[i].x1);
  const gm = median(gaps);
  const even = gaps.length >= 2 ? gaps.filter((g) => Math.abs(g - gm) <= Math.max(2, r.h * 0.25)).length / gaps.length : 0.7;
  const count = [0, 0, 0.55, 0.85, 1, 1, 1, 0.75, 0.5][n];
  return count * Math.max(0, 1 - spread * 3) * Math.max(0, 1 - off * 4) * (0.4 + 0.6 * shape) * (0.6 + 0.4 * even) * Math.sqrt(r.h);
}

/**
 * The row split where a code of the number's height stands before it (older plates: "B 38203") — the widest gap,
 * when it is clearly wider than the others and leaves one or two marks on its left.
 */
export function splitCode(r: GlyphRow): { code: Glyph[]; number: Glyph[] } {
  const g = r.glyphs;
  if (g.length < 3) return { code: [], number: g };
  const gaps = g.slice(1).map((x, i) => x.x0 - g[i].x1);
  let at = 0;
  for (let i = 1; i < gaps.length; i++) if (gaps[i] > gaps[at]) at = i;
  const others = gaps.filter((_, i) => i !== at);
  const usual = median(others);
  if (at <= 1 && gaps[at] > Math.max(usual * 1.8, r.h * 0.45)) return { code: g.slice(0, at + 1), number: g.slice(at + 1) };
  return { code: [], number: g };
}

/**
 * Only the characters of a cut (v0.32): pieces about `px` tall, on one line, none running off the cut's sides — the
 * plate's frame and the bars of its border, half a neighbour at the edge, the small words under the number all go
 * (each of them, left in, made a reading of the number fail or misread it).
 */
export function keepMarks(ink: Uint8Array, W: number, H: number, px: number): Uint8Array {
  const labels = new Int32Array(W * H);
  const gs = glyphsOf(ink, W, H, labels);
  const keep = gs.map((g) => {
    const h = gh(g);
    if (h < px * 0.55 || h > px * 1.45 || gw(g) > h * 1.3) return false;
    return g.x0 > 0 && g.y0 > 0 && g.x1 < W - 1 && g.y1 < H - 1;
  });
  const mid = median(gs.filter((_, i) => keep[i]).map(gcy));
  gs.forEach((g, i) => {
    if (keep[i] && Math.abs(gcy(g) - mid) > px * 0.45) keep[i] = false;
  });
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) if (labels[i] && keep[labels[i] - 1]) out[i] = 1;
  return out;
}

/**
 * How slanted a cut's characters stand (a plate shot from the side leans them as italics; a reading of leaning digits
 * gives nothing at all): the shear (x moved by s × its height from the middle) that makes their strokes upright — the
 * one whose columns of ink are sharpest. Upright, a little, is preferred.
 */
export function slantOf(ink: Uint8Array, W: number, H: number): number {
  const cy = H / 2;
  let best = 0;
  let bestScore = -1;
  for (let k = -10; k <= 10; k++) {
    const s = k * 0.05;
    const off = Math.ceil((Math.abs(s) * H) / 2) + 1;
    const cols = new Float64Array(W + 2 * off);
    for (let y = 0; y < H; y++) {
      const dx = s * (y - cy) + off;
      for (let x = 0; x < W; x++) if (ink[y * W + x]) cols[Math.round(x + dx)]++;
    }
    let score = 0;
    for (const c of cols) score += c * c;
    score *= 1 - Math.abs(s) * 0.08;
    if (score > bestScore) (bestScore = score), (best = s);
  }
  return best;
}

/** A cut's ink sheared by `s` (see slantOf): wider by what the shear moves. */
export function sheared(ink: Uint8Array, W: number, H: number, s: number): { ink: Uint8Array; W: number } {
  if (!s) return { ink, W };
  const off = Math.ceil((Math.abs(s) * H) / 2) + 1;
  const W2 = W + 2 * off;
  const out = new Uint8Array(W2 * H);
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    const dx = s * (y - cy) + off;
    for (let x2 = 0; x2 < W2; x2++) {
      const x = Math.round(x2 - dx);
      if (x >= 0 && x < W && ink[y * W + x]) out[y * W2 + x2] = 1;
    }
  }
  return { ink: out, W: W2 };
}

/**
 * The holes in each character of a cut, left to right (v0.32): the white closed inside a mark — an 8 has two, a 0, 6 and 9
 * one, a 1, 2, 3, 5 and 7 none. A hole of a speck's size is grain, not a hole.
 */
export function holesOf(ink: Uint8Array, W: number, H: number): number[] {
  const labels = new Int32Array(W * H);
  const marks = glyphsOf(ink, W, H, labels);
  const order = marks.map((g, i) => ({ g, id: i + 1 })).sort((a, b) => a.g.x0 - b.g.x0);
  return order.map(({ g, id }) => {
    // The mark's box with a ring of white around it: the white reached from the ring is outside; the rest is holes.
    const bw = gw(g) + 2;
    const bh = gh(g) + 2;
    const white = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const sx = g.x0 + x - 1;
        const sy = g.y0 + y - 1;
        const inside = sx >= 0 && sy >= 0 && sx < W && sy < H && labels[sy * W + sx] === id;
        white[y * bw + x] = inside ? 0 : 1;
      }
    const pieces = glyphsOf(white, bw, bh);
    const least = Math.max(4, g.area * 0.02);
    return pieces.filter((p) => !(p.x0 === 0 && p.y0 === 0) && p.area >= least && p.x0 > 0 && p.y0 > 0 && p.x1 < bw - 1 && p.y1 < bh - 1).length;
  });
}

/** How many holes each digit has (a 4 may be drawn closed or open). */
const HOLES: Record<string, number[]> = { '0': [1], '1': [0], '2': [0], '3': [0], '4': [0, 1], '5': [0], '6': [1], '7': [0], '8': [2], '9': [1] };

/** A reading of digits that its marks' holes allow (as many marks as digits, each with its digit's holes). */
export function fitsHoles(digits: string, holes: number[]): boolean {
  return digits.length === holes.length && [...digits].every((d, i) => HOLES[d]?.includes(holes[i]) ?? false);
}

/** A row found, with all the marks of the picture's ink it was found in (its code and word are looked for among them). */
export interface FoundRow extends GlyphRow {
  all: Glyph[];
}

/** How much two boxes cover each other (0–1, of the smaller). */
function cover(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (w <= 0 || h <= 0) return 0;
  const area = (x: Box) => (x.x1 - x.x0 + 1) * (x.y1 - x.y0 + 1);
  return (w * h) / Math.min(area(a), area(b));
}

/**
 * The likeliest number rows of a photo, its ink taken several ways (as text finders do — each way shows some plates
 * that the others miss): by the light around each point, and by each of several shades of grey across the photo (grey
 * digits on a silver plate in a dark frame come out whole only at one shade between the two). A row found in more than
 * one way is kept once, at its best.
 */
export function plateRows(Y: Float32Array, W: number, H: number, keep = 6): FoundRow[] {
  const minH = Math.max(9, Math.round(H * 0.012));
  const found: FoundRow[] = [];
  const take = (ink: Uint8Array) => {
    const all = glyphsOf(ink, W, H);
    for (const r of rowsOf(all.filter((g) => charLike(g, H, minH)))) found.push({ ...r, all });
  };
  take(inkOf(Y, W, H, Math.max(10, Math.round(Math.min(W, H) / 24))));
  // The shades: between the photo's darkest and lightest (a twentieth of it each side left out).
  const hist = new Uint32Array(256);
  for (const v of Y) hist[Math.min(255, Math.max(0, v | 0))]++;
  const at = (q: number) => {
    let s = 0;
    for (let i = 0; i < 256; i++) if ((s += hist[i]) >= Y.length * q) return i;
    return 255;
  };
  const lo = at(0.05);
  const hi = at(0.95);
  const ink = new Uint8Array(Y.length);
  for (let k = 1; k <= 7; k++) {
    const t = lo + ((hi - lo) * k) / 8;
    for (let i = 0; i < Y.length; i++) ink[i] = Y[i] < t ? 1 : 0;
    take(ink);
  }
  found.sort((a, b) => b.score - a.score);
  const out: FoundRow[] = [];
  for (const r of found) {
    if (out.some((o) => cover(o, r) > 0.5)) continue;
    out.push(r);
    if (out.length >= keep) break;
  }
  return out;
}

/** A box of marks: where they are together. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const boxOf = (gs: Glyph[]): Box => ({
  x0: Math.min(...gs.map((g) => g.x0)),
  y0: Math.min(...gs.map((g) => g.y0)),
  x1: Math.max(...gs.map((g) => g.x1)),
  y1: Math.max(...gs.map((g) => g.y1)),
});

/**
 * The code's marks in a cut of the plate beside its number (v0.32) — the cut level with the number, its digits `px` tall,
 * their feet at `foot` (the code on an older plate stands on them; a screw head may sit on top of it): one or two marks
 * of a code's size side by side (a word of three or more is the emirate's), nearest the number (`toward`: the cut's
 * side the number is on) and largest. None — undefined.
 */
export function codeWord(ink: Uint8Array, W: number, H: number, px: number, foot: number, toward: 'right' | 'bottom'): Glyph[] | undefined {
  const marks = glyphsOf(ink, W, H).filter((g) => {
    const h = gh(g);
    const w = gw(g);
    if (g.x0 <= 0 || g.y0 <= 0 || g.x1 >= W - 1 || g.y1 >= H - 1) return false;
    if (w > h * 1.25 || w < h * 0.1) return false;
    const fill = g.area / (w * h);
    if (fill < 0.12 || (fill > 0.92 && w > h * 0.35)) return false;
    const sized = h >= px * 0.4 && h <= px * 1.12;
    const capped = toward === 'right' && Math.abs(g.y1 - foot) <= px * 0.2 && h <= px * 1.5;
    return sized || capped;
  });
  let best: Glyph[] | undefined;
  let bestScore = 0;
  for (const w of rowsOfAny(marks, 0.7)) {
    if (w.length > 2) continue;
    const b = boxOf(w);
    const tall = Math.min(px, b.y1 - b.y0 + 1) / px;
    const away = toward === 'right' ? W - 1 - b.x1 : H - 1 - b.y1;
    const score = tall / (1 + away / px);
    if (score > bestScore) (best = w), (bestScore = score);
  }
  return best;
}

/**
 * The emirate's word in a cut of the plate beside its number (v0.32): a row of three to nine small marks (a fifth to
 * two thirds of a digit, `px`), the one nearest the number's side of the cut (`toward`).
 */
export function wordIn(ink: Uint8Array, W: number, H: number, px: number, toward: 'right' | 'bottom' | 'top'): Box | undefined {
  const marks = glyphsOf(ink, W, H).filter((g) => {
    const h = gh(g);
    if (g.x0 <= 0 || g.y0 <= 0 || g.x1 >= W - 1 || g.y1 >= H - 1) return false;
    return h >= px * 0.18 && h <= px * 0.66 && gw(g) <= h * 1.6;
  });
  let best: Box | undefined;
  let near = Infinity;
  for (const w of rowsOfAny(marks, 0.9)) {
    if (w.length < 3 || w.length > 9) continue;
    const b = boxOf(w);
    const away = toward === 'right' ? W - 1 - b.x1 : toward === 'bottom' ? H - 1 - b.y1 : b.y0;
    if (away < near) (best = b), (near = away);
  }
  return best;
}

/** Marks joined into words (two or one), whatever their count — the same rule as a row's, words of one mark kept. */
export function rowsOfAny(glyphs: Glyph[], gap: number): Glyph[][] {
  const gs = [...glyphs].sort((a, b) => a.x0 - b.x0);
  const parent = gs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) if (besideEachOther(gs[i], gs[j], gap)) parent[find(j)] = find(i);
  const groups = new Map<number, Glyph[]>();
  gs.forEach((g, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), g]));
  return [...groups.values()].map((w) => w.sort((a, b) => a.x0 - b.x0));
}
