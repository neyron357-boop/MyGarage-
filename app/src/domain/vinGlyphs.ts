/*
 * The app's own reader of a VIN's characters (v0.35). The OCR engine reads words of any language; on a VIN plate it
 * mixes up the characters a VIN is full of — 6 / G / 0, D / B / 8, S / 8, J / U, V / Y — differently at every size.
 * A VIN has only 33 characters and plates are printed in a handful of typefaces, so each character cut out of a found
 * row is compared with samples of all 33 (book: domain/vinGlyphBook.ts — many typefaces, and characters off real
 * plates): by its skeleton (the line through the middle of its strokes — thin print and bold alike), its holes (a 6
 * has one, a G none, an 8 two) and how wide it is. Pure work on black and white; the photo's work is
 * services/vinReader.ts.
 */

import { glyphsOf } from './plateGlyphs';

/** The grid a character's skeleton is laid on (its height fills it; its width as its shape has it). */
export const SIDE = 24;
const CAP = 6;

/** A character's shape as compared: its skeleton's points on the grid, how far each grid point is from them, its holes, its width (of its height). */
export interface Shape {
  bits: Uint8Array;
  dist: Float32Array;
  pts: number[];
  holes: number;
  wide: number;
}

/** A shape known to be a character (`c`). */
export interface Sample extends Shape {
  c: string;
}

/** One character cut out of a row: its box on the cut and its own ink (1) in that box. */
export interface Mark {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mask: Uint8Array;
}

/** The ink thinned to its skeleton (Zhang–Suen): strokes a point wide, their joins and ends where they were. */
export function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const W = w + 2;
  const H = h + 2;
  const a = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[(y + 1) * W + x + 1] = mask[y * w + x];
  const gone: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of [0, 1]) {
      gone.length = 0;
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!a[i]) continue;
          const p2 = a[i - W];
          const p3 = a[i - W + 1];
          const p4 = a[i + 1];
          const p5 = a[i + W + 1];
          const p6 = a[i + W];
          const p7 = a[i + W - 1];
          const p8 = a[i - 1];
          const p9 = a[i - W - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const n = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let t = 0;
          for (let k = 0; k < 8; k++) if (!n[k] && n[k + 1]) t++;
          if (t !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          gone.push(i);
        }
      for (const i of gone) a[i] = 0;
      if (gone.length) changed = true;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = a[(y + 1) * W + x + 1];
  return out;
}

/** The closed white inside the ink (a speck's worth — grain — is no hole). */
export function holesIn(mask: Uint8Array, w: number, h: number): number {
  const W = w + 2;
  const H = h + 2;
  const white = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) white[y * W + x] = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[(y - 1) * w + x - 1] ? 1 : 0;
  let ink = 0;
  for (const v of mask) ink += v;
  const least = Math.max(3, ink * 0.025, w * h * 0.006);
  return glyphsOf(white, W, H).filter((g) => g.area >= least && g.x0 > 0 && g.y0 > 0 && g.x1 < W - 1 && g.y1 < H - 1).length;
}

/** How far each grid point is from the nearest point of the skeleton (chamfer 3-4, in grid steps, at most CAP). */
function distanceTo(bits: Uint8Array): Float32Array {
  const d = new Float32Array(SIDE * SIDE).fill(CAP * 3);
  for (let i = 0; i < d.length; i++) if (bits[i]) d[i] = 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= SIDE || y >= SIDE ? Infinity : d[y * SIDE + x]);
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      const i = y * SIDE + x;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = SIDE - 1; y >= 0; y--)
    for (let x = SIDE - 1; x >= 0; x--) {
      const i = y * SIDE + x;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  return d.map((v) => Math.min(CAP, v / 3));
}

/** A shape from its skeleton's grid bits (a sample from the book, or one just made). */
export function shapeOfBits(bits: Uint8Array, holes: number, wide: number): Shape {
  const pts: number[] = [];
  bits.forEach((b, i) => b && pts.push(i));
  return { bits, dist: distanceTo(bits), pts, holes, wide };
}

/**
 * A character's shape from its ink (`w`×`h`, 1 — ink): thinned where it is (at its own size: a thin stroke is not lost
 * on the way down), laid on the grid by its height, in the middle across.
 */
export function shapeOf(mask: Uint8Array, w: number, h: number): Shape | undefined {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return undefined;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bh < 6) return undefined;
  const own = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) own[y * bw + x] = mask[(y + y0) * w + x + x0];
  const skel = thin(own, bw, bh);
  const k = (SIDE - 1) / Math.max(bh - 1, 1);
  const gw = Math.min(SIDE - 1, (bw - 1) * k);
  const ox = (SIDE - 1 - gw) / 2;
  const bits = new Uint8Array(SIDE * SIDE);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      if (!skel[y * bw + x]) continue;
      const gx = Math.round(ox + Math.min(gw, x * k));
      const gy = Math.round(y * k);
      bits[gy * SIDE + gx] = 1;
    }
  return shapeOfBits(bits, holesIn(own, bw, bh), bw / bh);
}

/** How unlike two shapes are: how far each one's skeleton lies from the other's, holes that differ, widths. */
export function unlike(a: Shape, b: Shape): number {
  let ab = 0;
  for (const p of a.pts) ab += b.dist[p];
  let ba = 0;
  for (const p of b.pts) ba += a.dist[p];
  const lines = (ab / Math.max(1, a.pts.length) + ba / Math.max(1, b.pts.length)) / 2;
  return lines + (a.holes === b.holes ? 0 : 0.9 * Math.min(2, Math.abs(a.holes - b.holes))) + 2.5 * Math.max(0, Math.abs(a.wide - b.wide) - 0.08);
}

/** Each character's likeness to a mark, likeliest first: the nearest sample of it. */
export function likeness(s: Shape, book: Sample[]): { c: string; d: number }[] {
  const best = new Map<string, number>();
  for (const t of book) {
    const d = unlike(s, t);
    if (d < (best.get(t.c) ?? Infinity)) best.set(t.c, d);
  }
  return [...best.entries()].map(([c, d]) => ({ c, d })).sort((a, b) => a.d - b.d);
}

/** Pieces of ink of a cut row, left to right, each with the labels it is made of (see `piecesOf`). */
export interface Pieces {
  marks: (Mark & { ids: number[] })[];
  labels: Int32Array;
  W: number;
  /** The characters' height (of the tallest pieces). */
  cap: number;
}

/**
 * The pieces of ink of a cut row (`W`×`H`, its letters about `px` tall), left to right: only the band the letters
 * stand in (the busiest `px` rows; what is above and below — a plate's frame, a strip's edge, the next line — is cut
 * away first, so a letter touching it comes off whole), no specks, nothing too large to be a letter; pieces one above
 * another joined (a broken stroke, dot print). A piece may still be half a letter (an engraved M's two sides) or a
 * maker's emblem: which pieces make which characters is the reading's to find (`readPieces`).
 */
export function piecesOf(ink0: Uint8Array, W: number, H: number, px: number): Pieces {
  // The letters' band: the `px` rows with the most ink, near the middle.
  const rows = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rows[y] += ink0[y * W + x];
  const span = Math.min(H, Math.round(px));
  let top = 0;
  let most = -1;
  for (let y = Math.max(0, Math.round(H / 2 - px)); y + span <= Math.min(H, Math.round(H / 2 + px)); y++) {
    let s = 0;
    for (let k = 0; k < span; k++) s += rows[y + k];
    if (s > most) (most = s), (top = y);
  }
  const y0 = Math.max(0, Math.round(top - px * 0.12));
  const y1 = Math.min(H - 1, Math.round(top + span + px * 0.12));
  const ink = new Uint8Array(W * H);
  ink.set(ink0.subarray(y0 * W, (y1 + 1) * W), y0 * W);
  const labels = new Int32Array(W * H);
  const gs = glyphsOf(ink, W, H, labels);
  const kept = gs
    .map((g, i) => ({ g, id: i + 1 }))
    .filter(({ g }) => {
      if (g.x0 <= 0 || g.x1 >= W - 1) return false;
      if (g.y1 - g.y0 + 1 > px * 1.4 || g.x1 - g.x0 + 1 > px * 1.6) return false;
      return g.area >= Math.max(6, px * px * 0.006);
    })
    .sort((a, b) => a.g.x0 - b.g.x0);
  const marks: Pieces['marks'] = [];
  for (const { g, id } of kept) {
    const last = marks[marks.length - 1];
    const over = last ? Math.min(last.x1, g.x1) - Math.max(last.x0, g.x0) + 1 : 0;
    if (last && over >= Math.min(last.x1 - last.x0 + 1, g.x1 - g.x0 + 1) * 0.5) {
      last.x0 = Math.min(last.x0, g.x0);
      last.x1 = Math.max(last.x1, g.x1);
      last.y0 = Math.min(last.y0, g.y0);
      last.y1 = Math.max(last.y1, g.y1);
      last.ids.push(id);
    } else marks.push({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, ids: [id], mask: new Uint8Array(0) });
  }
  const tall = marks.map((m) => m.y1 - m.y0 + 1).sort((a, b) => a - b);
  const cap = tall[Math.floor(tall.length * 0.75)] ?? px;
  return { marks, labels, W, cap };
}

/**
 * Ink opened (taken in by a point, then let out again): a stroke stays as it was, while a thread of grain joining a
 * letter to the next or to a plate's edge (an engraved strip's texture) is cut — and specks go.
 */
export function opened(ink: Uint8Array, W: number, H: number): Uint8Array {
  const pass = (src: Uint8Array, all: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && src[yy * W + xx]) n++;
          }
        out[i] = all ? (n === 9 ? 1 : 0) : n ? 1 : 0;
      }
    return out;
  };
  return pass(pass(ink, true), false);
}

/** The ink of pieces `a`…`b − 1` together: their box and mask. */
function joined(p: Pieces, a: number, b: number): Mark {
  const ms = p.marks.slice(a, b);
  const x0 = Math.min(...ms.map((m) => m.x0));
  const x1 = Math.max(...ms.map((m) => m.x1));
  const y0 = Math.min(...ms.map((m) => m.y0));
  const y1 = Math.max(...ms.map((m) => m.y1));
  const ids = new Set(ms.flatMap((m) => m.ids));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = p.labels[(y + y0) * p.W + x + x0];
      if (l && ids.has(l)) mask[y * w + x] = 1;
    }
  return { x0, y0, x1, y1, mask };
}

/** A row read by its characters' shapes: the text, and for each character how unlike it is to what it was read as and to the next likeliest. */
export interface ShapeReading {
  text: string;
  chars: { c: string; d: number; next: string; dNext: number; shape?: Shape }[];
  /** Which pieces each character is (from, to — the latter not included). */
  parts: [number, number][];
}

/** A character of pieces: its shape and every character's likeness to it — or nothing when it is no character's height or width. */
function lookAt(p: Pieces, a: number, b: number, book: Sample[]): { shape: Shape; like: { c: string; d: number }[] } | undefined {
  const m = joined(p, a, b);
  const w = m.x1 - m.x0 + 1;
  const h = m.y1 - m.y0 + 1;
  if (h < p.cap * 0.7 || w > p.cap * 1.25) return undefined;
  const shape = shapeOf(m.mask, w, h);
  return shape && { shape, like: likeness(shape, book) };
}

const DIGITS = '0123456789';

/**
 * The pieces read as a VIN (seventeen characters) by their shapes: of all the ways to take them in order — each
 * character one to three pieces side by side (an engraved letter falls apart into its strokes), pieces at the row's
 * ends left out (an emblem, a label's last letter) — the one whose characters are most like characters; its last four
 * are digits, as a VIN's are. `want` — the VIN it is known to be (samples taken off a real plate): each place read as
 * that character. Undefined — no way to make seventeen, or its characters too unlike any (`worst` on the whole, any
 * one `most`).
 */
export function readPieces(p: Pieces, book: Sample[], want?: string, worst = 1.5, most = worst * 2): ShapeReading | undefined {
  const count = want?.length ?? 17;
  const n = p.marks.length;
  if (n < count) return undefined;
  const seen = new Map<number, ReturnType<typeof lookAt> | null>();
  const memo = new Map<string, ShapeReading['chars'][number] | null>();
  const one = (a: number, b: number, k: number) => {
    const allowed = want ? want[k - 1] : k > count - 4 ? DIGITS : '';
    const key = `${a}/${b}/${allowed}`;
    if (!memo.has(key)) {
      if (!seen.has(a * 1024 + b)) seen.set(a * 1024 + b, lookAt(p, a, b, book) ?? null);
      const at = seen.get(a * 1024 + b);
      const like = at ? at.like.filter((x) => !allowed || allowed.includes(x.c)) : [];
      memo.set(key, like[0] && at ? { c: like[0].c, d: like[0].d, next: like[1]?.c ?? '?', dNext: like[1]?.d ?? Infinity, shape: at.shape } : null);
    }
    return memo.get(key) ?? undefined;
  };
  // Leaving a piece out at either end costs a little (so pieces that read as characters are taken).
  const SKIP = 0.6;
  let best: { cost: number; chars: ShapeReading['chars']; parts: [number, number][] } | undefined;
  for (let start = 0; start + count <= n; start++) {
    // cost[k][j]: the least cost of k characters out of pieces start…j − 1; from[k][j]: where the last began.
    const cost = Array.from({ length: count + 1 }, () => new Float64Array(n + 1).fill(Infinity));
    const from = Array.from({ length: count + 1 }, () => new Int32Array(n + 1).fill(-1));
    cost[0][start] = 0;
    for (let k = 1; k <= count; k++)
      for (let j = start + 1; j <= n; j++)
        for (let s = Math.max(start, j - 3); s < j; s++) {
          if (cost[k - 1][s] === Infinity) continue;
          const c = one(s, j, k);
          if (!c) continue;
          const t = cost[k - 1][s] + c.d;
          if (t < cost[k][j]) (cost[k][j] = t), (from[k][j] = s);
        }
    for (let end = start + count; end <= n; end++) {
      const total = cost[count][end] + SKIP * (start + n - end);
      if (total === Infinity || (best && total >= best.cost)) continue;
      const chars: ShapeReading['chars'] = [];
      const parts: [number, number][] = [];
      for (let k = count, j = end; k > 0; k--) {
        const s = from[k][j];
        chars.unshift(one(s, j, k)!);
        parts.unshift([s, j]);
        j = s;
      }
      best = { cost: total, chars, parts };
    }
  }
  if (!best || best.chars.some((c) => c.d > most) || best.chars.reduce((t, c) => t + c.d, 0) / count > worst) return undefined;
  if (!want && !whole(p, best.parts, (i) => seen.get(i * 1024 + i + 1) ?? lookAt(p, i, i + 1, book))) return undefined;
  return { text: best.chars.map((c) => c.c).join(''), chars: best.chars, parts: best.parts };
}

/**
 * Seventeen characters that are a VIN's whole, not a stretch of a longer line of words (a part's number, a tyre's
 * code, "ENGINE VK56VD 5552CC" — seventeen of their characters read as a VIN, its last four forced to digits): no
 * gap between two of them a word's space wide, most of them as wide as letters (not the bars of a barcode), and the
 * line not going on past either end — a piece beside the first
 * or the last, as close as the characters stand to each other, that is a character itself (an emblem, a colon, a
 * speck is not).
 */
function whole(p: Pieces, parts: [number, number][], at: (i: number) => { like: { d: number }[] } | null | undefined): boolean {
  const box = parts.map(([a, b]) => ({ x0: Math.min(...p.marks.slice(a, b).map((m) => m.x0)), x1: Math.max(...p.marks.slice(a, b).map((m) => m.x1)) }));
  // Most of a VIN's characters are as wide as letters are (a 1 is thin, seventeen of them are a barcode's bars).
  if (box.filter((b) => b.x1 - b.x0 + 1 >= p.cap * 0.35).length < parts.length * 0.6) return false;
  const gaps = box.slice(1).map((x, k) => x.x0 - box[k].x1);
  const usual = [...gaps].sort((a, b) => a - b)[gaps.length >> 1] ?? 0;
  const wide = Math.max(2.5 * usual, 0.45 * p.cap);
  if (gaps.some((g) => g > wide)) return false;
  const goesOn = (i: number, gap: number) => {
    const m = p.marks[i];
    if (!m || gap > wide || m.y1 - m.y0 + 1 < p.cap * 0.7) return false;
    return (at(i)?.like[0]?.d ?? Infinity) <= 1;
  };
  const first = parts[0][0];
  const last = parts[parts.length - 1][1] - 1;
  return !goesOn(first - 1, box[0].x0 - (p.marks[first - 1]?.x1 ?? -Infinity)) && !goesOn(last + 1, (p.marks[last + 1]?.x0 ?? Infinity) - box[box.length - 1].x1);
}

/**
 * The characters of a reading set apart (v0.35): each in a cell of its own, a third of a letter between them, on their
 * line — the engine reads a row of characters it need not part itself much better (it reads them run together as
 * words). Ink (1) of `W`×`H`.
 */
export function spacedOut(p: Pieces, parts: [number, number][], px: number): { ink: Uint8Array; W: number; H: number } {
  const marks = parts.map(([a, b]) => joined(p, a, b));
  const cell = Math.round(px * 1.15);
  const W = cell * marks.length + 2 * px;
  const H = Math.round(px * 1.8);
  const ink = new Uint8Array(W * H);
  const foot = Math.round((H + px) / 2);
  marks.forEach((m, k) => {
    const w = m.x1 - m.x0 + 1;
    const h = m.y1 - m.y0 + 1;
    const ox = px + k * cell + Math.round((cell - w) / 2);
    // Each on the row's line: its own height kept, standing on the foot the others share.
    const oy = foot - h;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (m.mask[y * w + x] && oy + y >= 0 && oy + y < H && ox + x < W) ink[(oy + y) * W + ox + x] = 1;
  });
  return { ink, W, H };
}

/** A book's sample as kept in a file: the character, its holes, its width (hundredths of its height), its skeleton's grid bits (base64). */
export type KeptSample = [c: string, holes: number, wide: number, bits: string];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A sample put down to keep (see `KeptSample`). */
export function keep(c: string, s: Shape): KeptSample {
  const bytes = new Uint8Array(Math.ceil((SIDE * SIDE) / 8));
  s.bits.forEach((b, i) => b && (bytes[i >> 3] |= 1 << (i & 7)));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  return [c, s.holes, Math.round(s.wide * 100), out];
}

/** A kept sample made a sample again. */
export function unkeep([c, holes, wide, text]: KeptSample): Sample {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const n = (B64.indexOf(text[i]) << 18) | (B64.indexOf(text[i + 1]) << 12) | (B64.indexOf(text[i + 2]) << 6) | B64.indexOf(text[i + 3]);
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const bits = new Uint8Array(SIDE * SIDE);
  for (let i = 0; i < bits.length; i++) bits[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return { c, ...shapeOfBits(bits, holes, wide / 100) };
}
