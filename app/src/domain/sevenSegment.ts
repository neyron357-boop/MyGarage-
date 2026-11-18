/*
 * The digits of a seven-segment display read by their segments (v0.44 — the LCD odometers of a Hiace, an Urvan, an
 * L200…). The reading engine knows print: to it a seven-segment "8" is seven bars apart. On a line cut out of a photo,
 * in black and white two ways (by the light around each point, and by one threshold for all — two readings to agree):
 * the row of the digits found, its slant taken out (LCD digits lean), the ink gathered into digits by where it stands
 * along the row, and each digit told by which of its seven places are inked. A small mark at the foot of the row is a
 * decimal point (a trip meter's tenths), a short one in its middle a clock's colon. Pure: points in, digits out.
 */

/**
 * The places of a digit's segments: a top, b upper right, c lower right, d bottom, e lower left, f upper left, g
 * middle — as parts of the digit's width (u) and height (v).
 */
const ZONES: Record<string, [number, number, number, number]> = {
  a: [0.22, 0.78, 0, 0.14],
  b: [0.7, 1, 0.12, 0.42],
  c: [0.7, 1, 0.58, 0.88],
  d: [0.22, 0.78, 0.86, 1],
  e: [0, 0.3, 0.58, 0.88],
  f: [0, 0.3, 0.12, 0.42],
  g: [0.22, 0.78, 0.43, 0.57],
};
const ORDER = 'abcdefg';
/** Which segments make which digit (and the usual variants: a 6 and a 9 without their tails, a 7 with its f). */
const DIGITS: Record<string, string> = {
  abcdef: '0',
  bc: '1',
  abdeg: '2',
  abcdg: '3',
  bcfg: '4',
  acdfg: '5',
  acdefg: '6',
  abc: '7',
  abcdefg: '8',
  abcdfg: '9',
  cdefg: '6',
  abcfg: '9',
  abcf: '7',
};

/** Ink by the light around each point (Bradley's): `k` darker than the mean within `r` — or lighter, for light digits. */
export function inkAround(Y: ArrayLike<number>, W: number, H: number, light: boolean, r: number, k = 0.15): Uint8Array {
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += Y[y * W + x];
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(W, x + r + 1);
      const mean = (S[yb * (W + 1) + xb] - S[ya * (W + 1) + xb] - S[yb * (W + 1) + xa] + S[ya * (W + 1) + xa]) / ((yb - ya) * (xb - xa));
      const v = Y[y * W + x];
      ink[y * W + x] = (light ? v > mean * (1 + k) + 4 : v < mean * (1 - k) - 4) ? 1 : 0;
    }
  }
  return ink;
}

/** Ink by one threshold for all the line (Otsu's): the darker side — or the lighter, for light digits. */
export function inkOtsu(Y: ArrayLike<number>, W: number, H: number, light: boolean): Uint8Array {
  const hist = new Float64Array(256);
  for (let i = 0; i < W * H; i++) hist[Math.max(0, Math.min(255, Y[i] | 0))]++;
  const n = W * H;
  let all = 0;
  for (let t = 0; t < 256; t++) all += t * hist[t];
  let wB = 0;
  let sB = 0;
  let best = 0;
  let at = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB || wB === n) continue;
    sB += t * hist[t];
    const mB = sB / wB;
    const mF = (all - sB) / (n - wB);
    const between = wB * (n - wB) * (mB - mF) ** 2;
    if (between > best) (best = between), (at = t);
  }
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = (light ? Y[i] > at : Y[i] <= at) ? 1 : 0;
  return ink;
}

interface Blob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
  pts: number[];
}

/** The blobs of ink (each point with its eight neighbours); `keep` — with their points (a whole photo's are many). */
function blobsOf(ink: Uint8Array, W: number, H: number, keep = true): Blob[] {
  const seen = new Uint8Array(ink.length);
  const q = new Int32Array(ink.length);
  const out: Blob[] = [];
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    seen[s] = 1;
    const b: Blob = { x0: W, y0: H, x1: 0, y1: 0, n: 0, pts: [] };
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      const y = (i - x) / W;
      if (keep) b.pts.push(i);
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (ink[j] && !seen[j]) (seen[j] = 1), (q[tail++] = j);
        }
    }
    b.n = tail;
    out.push(b);
  }
  return out;
}

/** The rows the digits stand in: the longest run of rows with ink (gaps of a few rows bridged — a "1"'s middle). */
function rowBand(ink: Uint8Array, W: number, H: number): [number, number] | undefined {
  const rows = new Array<boolean>(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) c += ink[y * W + x];
    rows[y] = c >= Math.max(2, W * 0.01);
  }
  const bridge = Math.max(1, Math.round(H * 0.06));
  let best: [number, number] | undefined;
  let start = -1;
  let lastInk = -1;
  for (let y = 0; y <= H; y++) {
    if (y < H && rows[y]) {
      if (start < 0 || y - lastInk > bridge + 1) {
        if (start >= 0 && (!best || lastInk - start > best[1] - best[0])) best = [start, lastInk];
        start = y;
      }
      lastInk = y;
    }
  }
  if (start >= 0 && (!best || lastInk - start > best[1] - best[0])) best = [start, lastInk];
  return best;
}

/** How sharply the ink stands in columns once leaned back by `s` (x moved by s × rows above the middle): upright is sharpest. */
function sharpness(pts: number[], W: number, mid: number, s: number, width: number): number {
  const cols = new Float64Array(width + W);
  for (const i of pts) {
    const x = i % W;
    const y = (i - x) / W;
    const xx = Math.round(x + s * (y - mid)) + (width >> 1);
    if (xx >= 0 && xx < cols.length) cols[xx]++;
  }
  let sum = 0;
  for (const c of cols) sum += c * c;
  return sum;
}

/**
 * The digits of the seven-segment number on a line in black and white (ink 1): '?' a mark that is none of the ten
 * digits, '.' a decimal point, ':' a clock's colon, ' ' between what are not digits (a «km» beside them).
 */
export function segDigits(ink: Uint8Array, W: number, H: number): string {
  const band = rowBand(ink, W, H);
  if (!band) return '';
  const [top, bottom] = band;
  const Hd = bottom - top + 1;
  if (Hd < 10) return '';
  const blobs = blobsOf(ink, W, H).filter((b) => b.n >= Math.max(3, Hd * Hd * 0.003) && b.y1 >= top && b.y0 <= bottom && b.y1 - b.y0 < Hd * 1.15);
  if (!blobs.length) return '';
  // The digits' lean: the slant that stands their bars upright (LCD digits lean right, up to about 15°).
  const mid = (top + bottom) / 2;
  const pts = blobs.flatMap((b) => b.pts);
  let lean = 0;
  let sharpest = -1;
  for (let s = -0.1; s <= 0.32; s += 0.03) {
    const v = sharpness(pts, W, mid, s, Math.ceil(Hd));
    if (v > sharpest) (sharpest = v), (lean = s);
  }
  const ux = (i: number) => {
    const x = i % W;
    return x + lean * ((i - x) / W - mid);
  };
  const placed = blobs
    .map((b) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const i of b.pts) {
        const x = ux(i);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return { b, lo, hi };
    })
    .sort((p, q) => p.lo - q.lo);
  // Small marks stand on their own (a decimal point between two digits is not a part of either); a digit's bars are
  // gathered along the row: its segments stand close, digits a little further apart.
  const small = (p: { b: Blob; lo: number; hi: number }) => p.hi - p.lo < Hd * 0.18 && p.b.y1 - p.b.y0 < Hd * 0.18;
  const cells: { lo: number; hi: number; parts: Blob[]; mark: boolean }[] = [];
  const gap = Hd * 0.1;
  for (const p of placed.filter((x) => !small(x))) {
    const last = cells[cells.length - 1];
    if (last && p.lo <= last.hi + gap) {
      last.hi = Math.max(last.hi, p.hi);
      last.parts.push(p.b);
    } else cells.push({ lo: p.lo, hi: p.hi, parts: [p.b], mark: false });
  }
  // Marks one above the other (a colon's two dots) are one mark.
  const marks: { lo: number; hi: number; parts: Blob[]; mark: boolean }[] = [];
  for (const p of placed.filter(small)) {
    const same = marks.find((m) => p.lo <= m.hi && p.hi >= m.lo);
    if (same) same.parts.push(p.b);
    else marks.push({ lo: p.lo, hi: p.hi, parts: [p.b], mark: true });
  }
  let out = '';
  for (const c of [...cells, ...marks].sort((p, q) => p.lo - q.lo)) {
    const y0 = Math.min(...c.parts.map((b) => b.y0));
    const y1 = Math.max(...c.parts.map((b) => b.y1));
    const tall = y1 - y0 + 1;
    const wide = c.hi - c.lo + 1;
    if (c.mark) {
      // Two dots one above the other — a clock's colon; one at the row's foot — a decimal point; else nothing.
      out += c.parts.length >= 2 ? ':' : y0 > top + Hd * 0.7 ? '.' : ' ';
      continue;
    }
    if (tall < Hd * 0.7) {
      out += ' ';
      continue;
    }
    // A narrow mark the height of the row: a "1" (its two bars on the right of where a digit stands).
    if (wide < Hd * 0.3) {
      out += '1';
      continue;
    }
    let on = '';
    for (const z of ORDER) {
      const [u0, u1, v0, v1] = ZONES[z];
      const xa = c.lo + u0 * wide;
      const xb = c.lo + u1 * wide;
      const ya = y0 + v0 * tall;
      const yb = y0 + v1 * tall;
      let inked = 0;
      let all = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          // The point of the line under this place of the upright digit.
          const sx = Math.round(x - lean * (y - mid));
          if (sx < 0 || sx >= W || y < 0 || y >= H) continue;
          all++;
          inked += ink[y * W + sx];
        }
      }
      if (all && inked / all >= 0.22) on += z;
    }
    out += DIGITS[on] ?? '?';
  }
  return out;
}

/** Where a seven-segment number may stand on a picture: a row of its digits, as a box. */
export interface SegRow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** How many digit-like groups stand in it. */
  digits: number;
}

/**
 * Where seven-segment numbers stand on a whole picture in black and white (ink 1): the ink's bars and digit-shaped
 * blobs gathered into digits (a digit's segments stand within a bar's thickness of each other, digits further apart),
 * then rows of four digits or more of one height and one line, evenly spaced — an odometer's place, whatever else the
 * dashboard shows (the needle, the scale, the icons do not make such a row).
 */
export function segRows(ink: Uint8Array, W: number, H: number): SegRow[] {
  // Each point's blob, and each blob's box and size: a whole photo has many blobs, their points are not all kept.
  const label = new Int32Array(W * H).fill(-1);
  const all = blobsOf(ink, W, H, false);
  {
    // The blobs again, now writing their number into each point (the same order as blobsOf finds them).
    const q = new Int32Array(W * H);
    let k = 0;
    for (let s = 0; s < ink.length; s++) {
      if (!ink[s] || label[s] >= 0) continue;
      let head = 0;
      let tail = 0;
      q[tail++] = s;
      label[s] = k;
      while (head < tail) {
        const i = q[head++];
        const x = i % W;
        const y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (ink[j] && label[j] < 0) (label[j] = k), (q[tail++] = j);
          }
      }
      k++;
    }
  }
  // The pieces a digit is made of: bars (long, thin, filled) and whole digits or halves of one (segments that touch).
  const parts = all
    .map((b, id) => {
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      return { ...b, id, w, h, long: Math.max(w, h), short: Math.min(w, h), fill: b.n / (w * h) };
    })
    .filter((p) => p.n >= 8 && p.w < W * 0.5 && p.h < H * 0.5 && p.long >= 8 && p.short >= 2 && (p.fill >= 0.5 ? p.long >= 2 * p.short : p.w <= 2 * p.h))
    .sort((p, q) => p.x0 - q.x0);
  // Each piece's ink row by row (its leftmost and rightmost point: the gap between two pieces is measured where they
  // stand side by side, as it is — leaning digits' boxes come nearer than the digits do), and its stroke: the usual
  // length of its runs of ink across and down — a bar's thickness, a whole digit's bars' — the measure of "near".
  type Part = (typeof parts)[number];
  const shapes = new Map<number, { spans: Map<number, [number, number]>; stroke: number }>();
  const median = (v: number[]) => (v.length ? v.sort((p, q) => p - q)[v.length >> 1] : 0);
  const shapeOf = (p: Part) => {
    const kept = shapes.get(p.id);
    if (kept) return kept;
    const spans = new Map<number, [number, number]>();
    const across: number[] = [];
    const down: number[] = [];
    for (let y = p.y0; y <= p.y1; y++) {
      let run = 0;
      for (let x = p.x0; x <= p.x1 + 1; x++) {
        if (x <= p.x1 && label[y * W + x] === p.id) {
          run++;
          const s = spans.get(y);
          if (!s) spans.set(y, [x, x]);
          else s[1] = x;
        } else if (run) {
          across.push(run);
          run = 0;
        }
      }
    }
    for (let x = p.x0; x <= p.x1; x++) {
      let run = 0;
      for (let y = p.y0; y <= p.y1 + 1; y++) {
        if (y <= p.y1 && label[y * W + x] === p.id) run++;
        else if (run) {
          down.push(run);
          run = 0;
        }
      }
    }
    const shape = { spans, stroke: Math.max(1, Math.min(median(across), median(down))) };
    shapes.set(p.id, shape);
    return shape;
  };
  const rowGap = (a: Part, b: Part) => {
    const sb = shapeOf(b).spans;
    let gap = Infinity;
    for (const [y, [l1, r1]] of shapeOf(a).spans) {
      const o = sb.get(y);
      if (!o) continue;
      const [l2, r2] = o;
      gap = Math.min(gap, l2 > r1 ? l2 - r1 : l1 > r2 ? l1 - r2 : 0);
    }
    return gap;
  };
  const bar = (p: Part) => p.fill >= 0.5;
  // Into digits: pieces side by side with a small gap (where they share rows), bars meeting at a corner, and pieces one
  // above the other in one column (a digit's upper and lower halves, apart where its middle bar is not) — "small" by
  // their strokes: digits stand further apart than a digit's own pieces.
  const up = parts.map((_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    const ta = shapeOf(a).stroke;
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j];
      if (b.x0 > a.x1 + Math.max(8, 2 * ta, 0.5 * a.long)) break;
      const tb = shapeOf(b).stroke;
      const t = Math.max(ta, tb);
      const dx = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0;
      const dy = b.y0 > a.y1 ? b.y0 - a.y1 : a.y0 > b.y1 ? a.y0 - b.y1 : 0;
      const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const join =
        (dy === 0 && rowGap(a, b) <= Math.max(2, 0.6 * Math.min(ta, tb))) ||
        (bar(a) && bar(b) && Math.max(dx, dy) <= Math.max(2, 0.8 * t)) ||
        (overlapX >= 0.5 * Math.min(a.w, b.w) && dy <= Math.max(2, 2.2 * t));
      if (join) up[find(j)] = find(i);
    }
  }
  const groups = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  parts.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (!g) groups.set(r, { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
    else (g.x0 = Math.min(g.x0, p.x0)), (g.y0 = Math.min(g.y0, p.y0)), (g.x1 = Math.max(g.x1, p.x1)), (g.y1 = Math.max(g.y1, p.y1));
  });
  // Digit-shaped: as tall as a digit, about half as wide (a "1" narrower; a leaning digit wider).
  const cells = [...groups.values()]
    .map((g) => ({ ...g, w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1 }))
    .filter((c) => c.h >= 14 && c.w / c.h <= 0.95 && c.w / c.h >= 0.06)
    .sort((p, q) => p.x0 - q.x0);
  // Rows: digits on one line (a 1, a 4 or a 7 is shorter — no top or bottom bar — but stands in the same middle),
  // the tallest of them the measure, each not far from the one before.
  const rows: SegRow[] = [];
  const used = new Set<number>();
  const middle = (c: { y0: number; y1: number }) => (c.y0 + c.y1) / 2;
  for (let i = 0; i < cells.length; i++) {
    if (used.has(i)) continue;
    const row = [i];
    let last = cells[i];
    let tallest = cells[i];
    for (let j = i + 1; j < cells.length; j++) {
      const c = cells[j];
      if (used.has(j)) continue;
      const h = Math.max(tallest.h, c.h);
      if (Math.min(tallest.h, c.h) < h * 0.55 || Math.abs(middle(c) - middle(tallest)) > h * 0.3) continue;
      if (c.x0 - last.x1 > h * 0.9) break;
      if (c.x0 <= last.x1) continue;
      row.push(j);
      last = c;
      if (c.h > tallest.h) tallest = c;
    }
    if (row.length < 4) continue;
    for (const k of row) used.add(k);
    const box = row.map((k) => cells[k]);
    rows.push({ x0: Math.min(...box.map((c) => c.x0)), y0: Math.min(...box.map((c) => c.y0)), x1: Math.max(...box.map((c) => c.x1)), y1: Math.max(...box.map((c) => c.y1)), digits: row.length });
  }
  return rows.sort((p, q) => q.digits - p.digits);
}

/** A part of a picture's points (a row found by `segRows`, with room around it). */
export function cropOf<T extends ArrayLike<number>>(src: T, W: number, H: number, box: { x0: number; y0: number; x1: number; y1: number }, pad: number): { data: Float64Array; W: number; H: number } {
  const x0 = Math.max(0, Math.floor(box.x0 - pad));
  const y0 = Math.max(0, Math.floor(box.y0 - pad));
  const x1 = Math.min(W - 1, Math.ceil(box.x1 + pad));
  const y1 = Math.min(H - 1, Math.ceil(box.y1 + pad));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = src[(y0 + y) * W + x0 + x];
  return { data, W: w, H: h };
}
