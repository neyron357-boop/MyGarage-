import { boxOf, codeWords, cover, fitsShapes, glyphsOf, inkOf, keepMarks, rightedByShapes, shapesOf, sheared, slantOf, splitCode, wordIn, type Box, type FoundRow, type Glyph } from '../domain/plateGlyphs';
import type { Emirate } from '../domain/types';
import { emirateLike } from '../domain/uaePlate';
import { rowFinder } from './plateRowsOff';
import { breathe, engine } from './vinReader';

/*
 * A plate read by its characters (v0.32): its number found as the row of the photo's largest even marks
 * (domain/plateGlyphs.ts), cut level and large, read for digits only — twice, two ways of light; the code found as a
 * mark or two beside it (on its left, over it, or before it on an older plate) and read for letters only; the emirate's
 * word as the row of small marks near it. Each part read alone, for what it can be, is read far better than the whole
 * plate as a line of any text (v0.28's way, still there behind this one — services/plateReader.ts).
 */

type Worker = Awaited<ReturnType<typeof engine>>;

export interface GlyphPlate {
  number: string;
  /** Both readings gave it, as many digits as its marks. */
  sure: boolean;
  code: string;
  codeSure: boolean;
  emirate?: Emirate;
  /** The number's row on the looked-at picture (to read more beside it, to mark it). */
  row: FoundRow;
  numberBox: Box;
  codeBox?: Box;
}

const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The brightness of a picture's points. */
function lumaOf(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const Y = new Float32Array(c.width * c.height);
  for (let i = 0; i < Y.length; i++) Y[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return Y;
}

/**
 * A box of the looked-at picture cut from the larger one: turned level by `angle`, scaled so its marks (`h` tall on the
 * looked-at picture) are `px` tall, with room around (`padX`, `padY` of `h`), on white.
 */
function cutBox(src: HTMLCanvasElement, b: Box, angle: number, f: number, h: number, px: number, padX: number, padY: number): HTMLCanvasElement {
  const k = Math.min(8, Math.max(0.3, px / (h * f)));
  const w = (b.x1 - b.x0 + 1 + 2 * padX * h) * f;
  const hh = (b.y1 - b.y0 + 1 + 2 * padY * h) * f;
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w * k));
  c.height = Math.max(8, Math.round(hh * k));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  g.scale(k, k);
  g.rotate((-angle * Math.PI) / 180);
  g.translate((-(b.x0 + b.x1 + 1) / 2) * f, (-(b.y0 + b.y1 + 1) / 2) * f);
  g.drawImage(src, 0, 0);
  return c;
}

/** The threshold between a cut's two shades (Otsu's). */
function otsu(Y: Float32Array): number {
  const hist = new Float64Array(256);
  for (const v of Y) hist[Math.min(255, Math.max(0, v | 0))]++;
  const n = Y.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0;
  let wb = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wb += hist[i];
    if (!wb) continue;
    const wf = n - wb;
    if (!wf) break;
    sb += i * hist[i];
    const between = wb * wf * (sb / wb - (sum - sb) / wf) ** 2;
    if (between > best) (best = between), (t = i);
  }
  return t;
}

/** Ink as black on white, with room around it (a quarter of its height). */
function paintInk(ink: Uint8Array, W: number, H: number): HTMLCanvasElement {
  const pad = Math.round(H * 0.25);
  const out = document.createElement('canvas');
  out.width = W + 2 * pad;
  out.height = H + 2 * pad;
  const g = out.getContext('2d', { willReadFrequently: true })!;
  const img = g.createImageData(out.width, out.height);
  img.data.fill(255);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ink[y * W + x]) {
        const o = ((y + pad) * out.width + x + pad) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
      }
  g.putImageData(img, 0, 0);
  return out;
}


/** A cut's ink: its characters' points, its size. */
interface Ink {
  ink: Uint8Array;
  W: number;
  H: number;
  /** The shear it was stood upright by (see slantOf). */
  slant?: number;
  /**
   * The shade between the plate's ground and its characters' paint, as the number's cut shows them (v0.33): the code
   * and the emirate's word are printed in the same paint on the same plate — this tells their ink from their ground
   * where the plate is in shade (at night the whole plate is darker than a cut's middle shade).
   */
  level?: number;
}

const count = (ink: Uint8Array) => ink.reduce((s, v) => s + v, 0);

/** A picture at `k` of its size (its characters a size the reading reads best). */
function scaled(c: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(8, Math.round(c.width * k));
  out.height = Math.max(8, Math.round(c.height * k));
  const g = out.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

/**
 * A cut (its characters `px` tall) as black and white two ways — by one threshold, and by the light around each point —
 * each with only its characters kept (keepMarks: the plate's frame, its border's bars, a neighbour's half, small words
 * go) and stood upright (a plate shot from the side leans its digits; leaning, they are not read at all).
 */
function cleanInks(cut: HTMLCanvasElement, px: number, slantGiven?: number): Ink[] {
  const W = cut.width;
  const H = cut.height;
  const Y = lumaOf(cut);
  const t = otsu(Y);
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = Y[i] <= t ? 1 : 0;
  const b = inkOf(Y, W, H, Math.max(8, Math.round(px * 0.8)), true, 0.15);
  // The plate's two shades: its characters' (the kept marks) and its ground's (what is around them) — their middle.
  const kept0 = keepMarks(a, W, H, px);
  const paint: number[] = [];
  const ground: number[] = [];
  for (let i = 0; i < Y.length; i += 3) (kept0[i] ? paint : a[i] ? null : ground)?.push(Y[i]);
  const mid = (v: number[]) => v.sort((x, y) => x - y)[v.length >> 1];
  const level = paint.length > 20 && ground.length > 20 ? (mid(paint) + mid(ground)) / 2 : undefined;
  return [a, b].map((ink, k) => {
    const kept = k === 0 ? kept0 : keepMarks(ink, W, H, px);
    const clean = count(kept) > 0 ? kept : ink;
    const slant = slantGiven ?? slantOf(clean, W, H);
    const up = sheared(clean, W, H, slant);
    return { ink: up.ink, W: up.W, H, slant, level };
  });
}

/** Where a cut's ink is. */
function inkBox(c: Ink): Box | undefined {
  let x0 = c.W;
  let y0 = c.H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.H; y++)
    for (let x = 0; x < c.W; x++)
      if (c.ink[y * c.W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? undefined : { x0, y0, x1, y1 };
}

/** A cut's ink made `k` times as large (each new point the one it falls on). */
function grown(c: Ink, k: number): Ink {
  const W = Math.max(1, Math.round(c.W * k));
  const H = Math.max(1, Math.round(c.H * k));
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(c.H - 1, Math.floor(y / k));
    for (let x = 0; x < W; x++) ink[y * W + x] = c.ink[sy * c.W + Math.min(c.W - 1, Math.floor(x / k))];
  }
  return { ink, W, H, slant: c.slant };
}

/**
 * Two cuts side by side on one line (their feet level), `gap` px apart: a code before its number, read as one line —
 * the code made as tall as the number's digits (small, beside them, a reading takes it for a speck or a mark).
 */
function besides(code: Ink, b: Ink, gap: number): Ink | undefined {
  const bc = inkBox(code);
  const bb = inkBox(b);
  if (!bc || !bb) return undefined;
  const k = (bb.y1 - bb.y0 + 1) / (bc.y1 - bc.y0 + 1);
  const a = Math.abs(k - 1) > 0.08 ? grown(code, k) : code;
  const ba = inkBox(a);
  if (!ba) return undefined;
  const ha = ba.y1 - ba.y0 + 1;
  const hb = bb.y1 - bb.y0 + 1;
  const H = Math.max(ha, hb);
  const W = ba.x1 - ba.x0 + 1 + gap + (bb.x1 - bb.x0 + 1);
  const ink = new Uint8Array(W * H);
  const put = (c: Ink, box: Box, dx: number) => {
    const dy = H - (box.y1 - box.y0 + 1);
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (c.ink[y * c.W + x]) ink[(y - box.y0 + dy) * W + (x - box.x0 + dx)] = 1;
  };
  put(a, ba, 0);
  put(b, bb, ba.x1 - ba.x0 + 1 + gap);
  return { ink, W, H };
}

/**
 * The order a cut is read in until its readings agree (v0.33): [way of black and white, size] — both ways at two sizes
 * first (a reading misreads at one size what it reads right at another), then two sizes more.
 */
const ORDER: [number, number][] = [
  [0, 34],
  [1, 48],
  [0, 48],
  [1, 34],
  [0, 40],
  [1, 40],
  [0, 28],
  [1, 28],
];

/** A cut's ink at a size of reading (its characters `px` tall as cut). */
const atSize = (c: Ink, px: number, size: number) => scaled(paintInk(c.ink, c.W, c.H), size / px);

/** One reading of a cut: one line, only the characters given. */
async function readAs(w: Worker, img: HTMLCanvasElement, chars: string): Promise<{ text: string; confidence: number }> {
  await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: chars, user_defined_dpi: '300', debug_file: '/dev/null' } as never);
  const r = await w.recognize(img, {}, { text: true });
  return { text: (r.data.text ?? '').trim(), confidence: r.data.confidence ?? 0 };
}

type Reading = { text: string; confidence: number };

/** The readings' vote: what most of them gave (more of them, then surer), how many gave it, and whether it is alone at the top. */
function vote(reads: Reading[]): { text: string; n: number; confidence: number; alone: boolean } | undefined {
  const by = new Map<string, { n: number; c: number }>();
  for (const r of reads) {
    const e = by.get(r.text) ?? { n: 0, c: 0 };
    by.set(r.text, { n: e.n + 1, c: e.c + r.confidence });
  }
  const all = [...by.entries()].sort((a, b) => b[1].n - a[1].n || b[1].c - a[1].c);
  if (!all.length) return undefined;
  const [text, e] = all[0];
  return { text, n: e.n, confidence: e.c, alone: !all[1] || all[1][1].n < e.n };
}

/**
 * A mark with a straight left side (v0.33): the most of its rows begin at its leftmost — a B, a D, an E (an 8, a 0, a 3
 * are round there). Told by the rows of its middle (its corners round in any letter).
 */
function flatLeft(c: Ink): boolean {
  const box = inkBox(c);
  if (!box) return false;
  const h = box.y1 - box.y0 + 1;
  const firsts: number[] = [];
  for (let y = box.y0 + Math.round(h * 0.12); y <= box.y1 - Math.round(h * 0.12); y++) {
    for (let x = box.x0; x <= box.x1; x++)
      if (c.ink[y * c.W + x]) {
        firsts.push(x);
        break;
      }
  }
  if (firsts.length < 6) return false;
  const left = Math.min(...firsts);
  const near = firsts.filter((x) => x <= left + Math.max(2, (box.x1 - box.x0 + 1) * 0.1)).length;
  return near >= firsts.length * 0.75;
}

/** The order a code is read beside its number: [its cut (again ×2, the region's ×2), size] — the two kinds in turn. */
const CODE_ORDER: [number, number][] = [
  [0, 34],
  [2, 48],
  [1, 48],
  [3, 34],
  [0, 48],
  [2, 34],
];

/**
 * The readings of a code weighed by how sure each was (v0.33): a letter read twice unsurely (an L where a D's corner is
 * worn) gives way to one read twice surely. How many gave it, and whether none other weighs as much.
 */
function surest(reads: Reading[]): { text: string; n: number; alone: boolean } | undefined {
  const by = new Map<string, { n: number; w: number }>();
  for (const r of reads) {
    const e = by.get(r.text) ?? { n: 0, w: 0 };
    by.set(r.text, { n: e.n + 1, w: e.w + 0.4 + r.confidence / 100 });
  }
  const all = [...by.entries()].sort((a, b) => b[1].w - a[1].w);
  if (!all.length) return undefined;
  return { text: all[0][0], n: all[0][1].n, alone: !all[1] || all[1][1].w < all[0][1].w * 0.75 };
}

/**
 * A code of one or two letters from its readings, letter by letter (v0.33: "DL", "DD", "D·" — the second letter is what
 * most readings give at its place, weighed by how sure each was). Sure when two readings or more give the whole code
 * and none other weighs as much.
 */
function letterVote(reads: Reading[], marks: number): { text: string; sure: boolean } | undefined {
  const full = reads.filter((r) => r.text.length === marks);
  if (!full.length) return undefined;
  let text = '';
  for (let i = 0; i < marks; i++) {
    const by = new Map<string, number>();
    for (const r of full) by.set(r.text[i], (by.get(r.text[i]) ?? 0) + 0.4 + r.confidence / 100);
    text += [...by.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const whole = surest(full);
  return { text, sure: !!whole && whole.text === text && whole.n >= 2 && whole.alone };
}

/** A code's readings settled: two that agree, read surely enough between them (two unsure ones wait for more). */
const settledCode = (reads: Reading[]) => {
  const top = surest(reads);
  if (!top || top.n < 2) return false;
  const sure = reads.filter((r) => r.text === top.text).reduce((s, r) => s + r.confidence, 0);
  return sure >= 60 && top.alone;
};

/** A plate found by its characters on the looked-at picture (`look`), cut from the larger one (`src`). */
export async function readByGlyphs(
  look: HTMLCanvasElement,
  src: HTMLCanvasElement,
  tracer?: (step: string, data: unknown) => void,
  /** `quick`: a camera's frame (v0.33) — fewer rows on the second look (the next frame is another look). */
  opts?: { quick?: boolean },
): Promise<GlyphPlate | undefined> {
  const trace = (step: string, data: unknown) => tracer?.(step, data);
  const snap = (img: HTMLCanvasElement) => (tracer ? img.toDataURL('image/png') : undefined);
  const W = look.width;
  const f = src.width / W;
  const t0 = performance.now();
  const lap: Record<string, number> = {};
  // First the one quick way of black and white (by the light around each point); the photo's shades only if that one
  // found nothing read surely (v0.33 — they cost several times as much). Found off the page (a worker), where it can be.
  const finder = rowFinder(look);
  const quick = await finder.light(4);
  lap.rows = Math.round(performance.now() - t0);
  trace('rows', quick.map((r) => ({ n: r.glyphs.length, h: r.h, x: r.x0, y: r.y0, angle: Math.round(r.angle * 10) / 10, score: Math.round(r.score * 10) / 10 })));
  const w = await engine();
  const w2 = w;
  const PX = 56;

  // The number: the likeliest rows read for digits — the cut each way of black and white, at a few sizes, until its
  // readings agree (two that agree and that its marks' shapes allow, or three); what most readings give wins, a digit
  // per mark (one more or less: two marks run together, one broken in two).
  let best: { row: FoundRow; number: string; reads: Reading[]; code: Glyph[]; digits: Glyph[]; inks: Ink[]; weight: number } | undefined;
  const tried: FoundRow[] = [];
  const readRows = async (list: FoundRow[]): Promise<boolean> => {
    for (const row of list) {
      if (tried.some((o) => cover(o, row) > 0.5)) continue;
      tried.push(row);
      await breathe();
      const { code, number: digits } = splitCode(row);
      const inks = cleanInks(cutBox(src, boxOf(digits), row.angle, f, row.h, PX, 0.45, 0.32), PX);
      const shapes = inks.map((c) => shapesOf(c.ink, c.W, c.H));
      const fits = (t: string) => shapes.some((x) => fitsShapes(t, x));
      const reads: Reading[] = [];
      for (let i = 0; i < ORDER.length; i++) {
        const [k, size] = ORDER[i];
        const img = atSize(inks[k], PX, size);
        const p = await readAs(w, img, DIGITS);
        const d = p.text.replace(/\D/g, '');
        trace('digits', { text: p.text, confidence: Math.round(p.confidence), size, marks: digits.length, cut: snap(img) });
        if (d.length >= 1 && d.length <= 5 && !/^0+$/.test(d) && Math.abs(d.length - digits.length) <= 1) reads.push({ text: d, confidence: p.confidence });
        const top = vote(reads);
        if (top && ((reads.length >= 2 && top.n === reads.length && fits(top.text)) || (top.n >= 3 && top.alone))) break;
        // Four readings and no digits in them: not a number (a badge, a word).
        if (i >= 3 && !reads.length) break;
      }
      const top = vote(reads);
      if (!top) continue;
      const sure = top.n >= 2 && top.alone;
      const weight = top.n * row.score * (top.text.length >= 4 ? 1.3 : 1) * (top.text.length === digits.length ? 1.2 : 1) * (fits(top.text) ? 1.3 : 1);
      if (!best || weight > best.weight) best = { row, number: top.text, reads, code, digits, inks, weight };
      if (sure && top.text.length >= 3 && (top.n >= 3 || fits(top.text))) return true;
    }
    return false;
  };
  if (!(await readRows(quick))) {
    const t1 = performance.now();
    // One shade at a time, the middle ones first, the page let breathe between them (a tap on a phone is not kept
    // waiting); a camera's frame keeps fewer rows of them (the next frame is another look).
    const all: FoundRow[] = [];
    for (const k of [4, 3, 5, 2, 6, 1, 7]) {
      await breathe();
      all.push(...(await finder.shades(4, [k])));
    }
    all.sort((x, y) => y.score - x.score);
    const more: FoundRow[] = [];
    for (const r of all) {
      if (more.some((o) => cover(o, r) > 0.5)) continue;
      more.push(r);
      if (more.length >= (opts?.quick ? 3 : 6)) break;
    }
    lap.shades = Math.round(performance.now() - t1);
    trace('rows', more.map((r) => ({ n: r.glyphs.length, h: r.h, x: r.x0, y: r.y0, angle: Math.round(r.angle * 10) / 10, score: Math.round(r.score * 10) / 10 })));
    await readRows(more);
  }
  lap.number = Math.round(performance.now() - t0) - lap.rows - (lap.shades ?? 0);
  if (!best) return undefined;
  const { row } = best;
  let { number, digits, inks } = best;
  // The number's readings: its own, then each reading of it beside its code (a digit misread alone — a blurred 9 taken
  // for an 8 — is often read right in the plate's whole line).
  let numReads = best.reads.filter((r) => r.text === number || r.text.length === number.length);
  const h = row.h;

  /** A region of the plate beside the number, in its own frame (u along it, v down; in its heights; its first digit's foot at 0, 0), cut level, its digits `PX` tall. */
  const rad = (row.angle * Math.PI) / 180;
  const frameCut = (u0: number, u1: number, v0: number, v1: number) => {
    const ox = digits[0].x0;
    const oy = digits[0].y1;
    const uc = ((u0 + u1) / 2) * h;
    const vc = ((v0 + v1) / 2) * h;
    const cx = ox + uc * Math.cos(rad) - vc * Math.sin(rad);
    const cy = oy + uc * Math.sin(rad) + vc * Math.cos(rad);
    const bw = (u1 - u0) * h;
    const bh = (v1 - v0) * h;
    const box = { x0: cx - bw / 2, x1: cx + bw / 2 - 1, y0: cy - bh / 2, y1: cy + bh / 2 - 1 };
    /** A box of the cut, back on the looked-at picture (the box round its four corners). */
    const back = (b: Box): Box => {
      const pts = [
        [b.x0, b.y0],
        [b.x1, b.y0],
        [b.x0, b.y1],
        [b.x1, b.y1],
      ].map(([px, py]) => {
        const u = (u0 + px / PX) * h;
        const v = (v0 + py / PX) * h;
        return [ox + u * Math.cos(rad) - v * Math.sin(rad), oy + u * Math.sin(rad) + v * Math.cos(rad)];
      });
      return {
        x0: Math.round(Math.min(...pts.map((q) => q[0]))),
        x1: Math.round(Math.max(...pts.map((q) => q[0]))),
        y0: Math.round(Math.min(...pts.map((q) => q[1]))),
        y1: Math.round(Math.max(...pts.map((q) => q[1]))),
      };
    };
    return { cut: cutBox(src, box, row.angle, f, h, PX, 0, 0), foot: -v0 * PX, box, back };
  };

  // The emirate's word: small marks in a row beside the number — over the code on its left (Dubai), over it (a short
  // plate), under it (older plates); looked for in each, cut and made black and white anew there, read for letters and
  // told apart from a slip by a letter or two (DUBAI in the plate's own lettering reads "DUBRI").
  let emirate: Emirate | undefined;
  const span = (digits[digits.length - 1].x1 - digits[0].x0) / Math.max(0.2, Math.cos(rad)) / h;
  const places = [
    { r: [-4.6, -0.04, -1.75, 0.35], toward: 'right' },
    { r: [-0.6, span + 0.6, -2.7, -0.92], toward: 'bottom' },
    { r: [-2.6, span + 0.6, 0.05, 1.6], toward: 'top' },
  ] as const;
  look: for (const { r, toward } of places) {
    const region = frameCut(r[0], r[1], r[2], r[3]);
    const cw = region.cut.width;
    const chh = region.cut.height;
    const Y = lumaOf(region.cut);
    const t = otsu(Y);
    const a = new Uint8Array(cw * chh);
    for (let i = 0; i < a.length; i++) a[i] = Y[i] <= t ? 1 : 0;
    for (const ink of [inkOf(Y, cw, chh, Math.max(6, Math.round(PX * 0.4)), true, 0.15), a]) {
      const wb = wordIn(ink, cw, chh, PX, toward);
      if (!wb) continue;
      const W2 = wb.x1 - wb.x0 + 1;
      const H2 = wb.y1 - wb.y0 + 1;
      const word = new Uint8Array(W2 * H2);
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) word[y * W2 + x] = ink[(y + wb.y0) * cw + x + wb.x0];
      const p = await readAs(w, atSize({ ink: word, W: W2, H: H2 }, H2, 34), LETTERS);
      trace('word', { text: p.text, confidence: Math.round(p.confidence), toward });
      emirate = emirateLike(p.text);
      // One reading a place: its word read once (a word misread twice is not read better a second time).
      if (emirate) break look;
      continue look;
    }
  }

  // The code: one or two marks beside the number — on its left (Dubai: under the emirate's word; an older plate: before
  // it, of its height), or over it (a short plate). Looked for in the plate itself, cut beside the number in its own
  // frame and made black and white anew there (in the whole photo's ink the code often runs into the plate's frame).
  // Alone, a letter is hardly read at all: it is set before the number, of the number's height, and the line read as a
  // plate's — letters and digits; what it gives before the number is the code. Marks that read as digits of the
  // number's height are the number's own (one missed when the row was found): it takes them, and the code is looked
  // for once more, beside it.
  lap.word = Math.round(performance.now() - t0) - lap.rows - (lap.shades ?? 0) - lap.number;
  let code = '';
  let codeSure = false;
  let codeBox: Box | undefined;
  const numeric = emirate === 'AUH' || emirate === 'SHJ';
  /** The code's ink in a cut beside the number, each way of black and white (its word's box, the rest left out). */
  const codeInksIn = (region: ReturnType<typeof frameCut>, toward: 'right' | 'bottom'): { inks: Ink[]; word: Box; marks: number }[] => {
    const { cut, foot } = region;
    const cw = cut.width;
    const chh = cut.height;
    const Y = lumaOf(cut);
    const t = otsu(Y);
    const a = new Uint8Array(cw * chh);
    for (let i = 0; i < a.length; i++) a[i] = Y[i] <= t ? 1 : 0;
    const b = inkOf(Y, cw, chh, Math.max(8, Math.round(PX * 0.8)), true, 0.15);
    // The plate's own shade between paint and ground first (the number's cut showed it), then the cut's own ways.
    const level = inks[0]?.level;
    const c = level === undefined ? undefined : Y.map((v) => (v < level ? 1 : 0)) as unknown as Uint8Array;
    const plateInk = c && Uint8Array.from(c);
    let words: Glyph[][] = [];
    let found: Uint8Array = b;
    for (const ink of plateInk ? [plateInk, b, a] : [b, a]) {
      words = codeWords(ink, cw, chh, PX, foot, toward);
      found = ink;
      if (words.length) break;
    }
    void found;
    // Each word two ways (v0.33 — each reads some codes the other misses): cut again from the large photo where it is, at
    // its own height (made larger from the region's small cut, an R's opening may shut — an A); and as the region's two
    // ways of black and white show it (or, where one made it a blot or lost it — the plate in shade — the plate's own
    // shade); all stood up as the number stands.
    return words.slice(0, 3).map((w) => {
      const wb = boxOf(w);
      const there = region.back(wb);
      const tall = ((wb.y1 - wb.y0 + 1) / PX) * h;
      const again = cleanInks(cutBox(src, there, row.angle, f, tall, PX, 0.35, 0.3), PX, inks[0]?.slant ?? 0);
      const W2 = wb.x1 - wb.x0 + 1;
      const H2 = wb.y1 - wb.y0 + 1;
      const take = (ink: Uint8Array) => {
        const cut2 = new Uint8Array(W2 * H2);
        let n = 0;
        for (let y = 0; y < H2; y++)
          for (let x = 0; x < W2; x++) {
            const v = ink[(y + wb.y0) * cw + x + wb.x0];
            cut2[y * W2 + x] = v;
            n += v;
          }
        return { cut2, fill: n / (W2 * H2) };
      };
      const here = [a, b].map((ink, k) => {
        let { cut2, fill } = take(ink);
        if ((fill > 0.72 || fill < 0.08) && plateInk) cut2 = take(plateInk).cut2;
        const up = sheared(cut2, W2, H2, inks[k]?.slant ?? 0);
        return { ink: up.ink, W: up.W, H: H2 };
      });
      return { inks: [...again, ...here], word: wb, marks: w.length };
    });
  };
  /** The code's readings beside the number: letters before it (the code), or digits before it (the number's own). */
  const readBeside = async (codeInks: Ink[], marks: number) => {
    const reads: Reading[] = [];
    const lines: Reading[] = [];
    const whole: Reading[] = [];
    // Read until two readings agree (on the code, or on the marks being digits) — at most four.
    for (const [k, size] of CODE_ORDER) {
      if (settledCode(reads) || (vote(whole)?.n ?? 0) >= 2) break;
      const line = besides(codeInks[k], inks[k % 2], Math.round(PX * 0.45));
      if (!line) continue;
      const img = atSize(line, PX, size);
      const p = await readAs(w, img, LETTERS + DIGITS);
      const m = /^([A-Z]{0,2})(\d{1,7})$/.exec(p.text.replace(/[^A-Z0-9]/g, ''));
      trace('code', { text: p.text, confidence: Math.round(p.confidence), marks, size, cut: snap(img) });
      if (!m) continue;
      // Letters, as many as its marks, before digits: the code (the digits a reading of the number when they are as many).
      if (m[1] && m[1].length === marks && m[2].length >= 2) {
        reads.push({ text: m[1], confidence: p.confidence });
        if (Math.abs(m[2].length - number.length) <= 1) lines.push({ text: m[2], confidence: p.confidence });
      } else if (!m[1] && m[2].length === number.length + marks && m[2].length <= 5) whole.push({ text: m[2], confidence: p.confidence });
      else if (!m[1] && marks === 1 && m[2].length === number.length + 1 && m[2].endsWith(number) && /[80]/.test(m[2][0]) && flatLeft(codeInks[0])) {
        // An 8 or a 0 read where the mark's left side is straight: a B or a D (an older plate's code, its own height).
        reads.push({ text: m[2][0] === '8' ? 'B' : 'D', confidence: p.confidence });
      }
    }
    return { reads, lines, whole };
  };
  // A first digit the row missed (v0.33 — run into a mark above it, it was not of the row's height): right before the
  // number, of a digit's height on its line, by the plate's own shade. Read with the number: a digit more before it —
  // the number's own (the code is then looked for beside the longer number).
  if (number.length < 5 && inks[0]?.level !== undefined) {
    const region = frameCut(-1.35, -0.02, -1.15, 0.15);
    const { cut } = region;
    const cw = cut.width;
    const chh = cut.height;
    const level = inks[0].level;
    const Y = lumaOf(cut);
    const ink = Uint8Array.from(Y, (v) => (v < level ? 1 : 0));
    const foot = 1.15 * PX;
    const marks = glyphsOf(ink, cw, chh).filter((g) => {
      const gH = g.y1 - g.y0 + 1;
      const gW = g.x1 - g.x0 + 1;
      return g.x0 > 0 && g.x1 < cw - 1 && gH >= PX * 0.75 && gH <= PX * 1.25 && gW >= gH * 0.18 && gW <= gH * 0.95 && Math.abs(g.y1 - foot) <= PX * 0.2;
    });
    // As near the first digit as the digits are to each other (an older plate's code letter stands further off).
    const gaps = digits.slice(1).map((g, i) => g.x0 - digits[i].x1).sort((a, b) => a - b);
    const usual = ((gaps[gaps.length >> 1] ?? h * 0.25) * PX) / h;
    const mark = marks.sort((a, b) => b.x1 - a.x1)[0];
    const near = mark && cw - 1 - mark.x1 + PX * 0.02 <= Math.max(usual * 1.8, PX * 0.35);
    if (mark && near) {
      const W2 = mark.x1 - mark.x0 + 1;
      const H2 = mark.y1 - mark.y0 + 1;
      const one = new Uint8Array(W2 * H2);
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) one[y * W2 + x] = ink[(y + mark.y0) * cw + x + mark.x0];
      const up = sheared(one, W2, H2, inks[0].slant ?? 0);
      const reads: Reading[] = [];
      for (const [k, size] of ORDER.slice(0, 4)) {
        const line = besides({ ink: up.ink, W: up.W, H: H2 }, inks[k], Math.round(PX * 0.3));
        if (!line) continue;
        const img = atSize(line, PX, size);
        const r = await readAs(w, img, DIGITS);
        const d = r.text.replace(/\D/g, '');
        trace('missed', { text: r.text, confidence: Math.round(r.confidence), size, cut: snap(img) });
        // An 8 or a 0 with a straight left side is a letter (B, D) — a code, not a digit.
        if (d.length === number.length + 1 && d.endsWith(number.slice(-2)) && !(/[80]/.test(d[0]) && flatLeft({ ink: up.ink, W: up.W, H: H2 }))) reads.push({ text: d, confidence: r.confidence });
        if ((vote(reads)?.n ?? 0) >= 2) break;
      }
      const top = vote(reads);
      if (top && top.n >= 2) {
        numReads = reads;
        number = top.text;
        const where = region.back(mark);
        const first = digits[0];
        digits = [{ x0: where.x0, x1: Math.min(where.x1, first.x0 - 1), y0: where.y0, y1: where.y1, area: 0 }, ...digits];
        inks = cleanInks(cutBox(src, boxOf(digits), row.angle, f, h, PX, 0.45, 0.32), PX);
      }
    }
  }
  for (let tries = 0; tries < 2 && !numeric; tries++) {
    const len = (digits[digits.length - 1].x1 - digits[0].x0) / Math.max(0.2, Math.cos(rad)) / h;
    let taken = false;
    let more = false;
    look: for (const side of ['right', 'bottom'] as const) {
      const region = side === 'right' ? frameCut(-4.6, -0.04, -1.75, 0.35) : frameCut(-0.6, len + 0.6, -2.7, -0.92);
      const words = codeInksIn(region, side);
      trace('codeRegion', { side, tries, words: words.length, cut: snap(region.cut) });
      for (const word of words) {
        const { reads, lines, whole } = await readBeside(word.inks, word.marks);
        const asDigits = vote(whole);
        if (tries === 0 && asDigits && asDigits.n >= 2 && asDigits.n > reads.length) {
          // Its marks were digits of the number: the number takes them (as one cut, from its new first mark), and the
          // code is looked for once more, beside it.
          numReads = whole;
          number = asDigits.text;
          const where = region.back(word.word);
          const first = digits[0];
          digits = [{ x0: where.x0, x1: Math.min(where.x1, first.x0 - 1), y0: where.y0, y1: where.y1, area: 0 }, ...digits];
          inks = cleanInks(cutBox(src, boxOf(digits), row.angle, f, h, PX, 0.45, 0.32), PX);
          more = true;
          break look;
        }
        const top = letterVote(reads, word.marks);
        if (!top) continue;
        numReads = [...numReads, ...lines];
        code = top.text;
        codeSure = top.sure;
        codeBox = region.back(word.word);
        taken = true;
        break look;
      }
    }
    if (taken || !more) break;
  }
  // A code of digits (v0.33 — Abu Dhabi: a white number in a red box; Sharjah): on the number's left, light on dark or
  // dark on light; read set before the number at its height with a wide gap (a reading of "1 12345" keeps them apart,
  // "112345" would not tell where the code ends).
  if (numeric) {
    const region = frameCut(-4.6, -0.04, -1.75, 0.35);
    const { cut, foot } = region;
    const cw = cut.width;
    const chh = cut.height;
    const Y = lumaOf(cut);
    const ways2 = [inkOf(Y, cw, chh, Math.max(8, Math.round(PX * 0.8)), false, 0.15), inkOf(Y, cw, chh, Math.max(8, Math.round(PX * 0.8)), true, 0.15)];
    const reads: Reading[] = [];
    look: for (const ink of ways2) {
      for (const w of codeWords(ink, cw, chh, PX, foot, 'right').slice(0, 2)) {
        const wb = boxOf(w);
        const W2 = wb.x1 - wb.x0 + 1;
        const H2 = wb.y1 - wb.y0 + 1;
        const cut2 = new Uint8Array(W2 * H2);
        for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) cut2[y * W2 + x] = ink[(y + wb.y0) * cw + x + wb.x0];
        const codeInk = { ink: sheared(cut2, W2, H2, inks[0]?.slant ?? 0).ink, W: sheared(cut2, W2, H2, inks[0]?.slant ?? 0).W, H: H2 };
        for (const [k, size] of ORDER.slice(0, 4)) {
          const line = besides(codeInk, inks[k], Math.round(PX * 0.9));
          if (!line) continue;
          const img = atSize(line, PX, size);
          const p = await readAs(w2, img, DIGITS);
          // The number is known: what stands before it is the code (a gap read or not).
          const d = p.text.replace(/\s+/g, '');
          const before = d.endsWith(number) ? d.slice(0, d.length - number.length) : '';
          trace('code', { text: p.text, confidence: Math.round(p.confidence), numeric: true, size, cut: snap(img) });
          if (/^\d{1,2}$/.test(before)) reads.push({ text: before, confidence: p.confidence });
          if ((vote(reads)?.n ?? 0) >= 2) break look;
        }
        if (reads.length) {
          codeBox = region.back(wb);
          break look;
        }
      }
    }
    const top = vote(reads);
    if (top) {
      code = top.text;
      codeSure = top.n >= 2 && top.alone;
    }
  }
  // The number: what most of its readings give (its own and those beside its code); sure when two or more give it and
  // none other as many — or, two as many (a blurred 9 read as often as an 8), the one its marks' holes allow.
  lap.code = Math.round(performance.now() - t0) - lap.rows - (lap.shades ?? 0) - lap.number - lap.word;
  trace('time', lap);
  const shapes = inks.map((c) => shapesOf(c.ink, c.W, c.H));
  const fits = (t: string) => shapes.some((x) => fitsShapes(t, x));
  const holes = shapes.map((x) => x.map((m) => m.holes.length));
  const tally = new Map<string, { n: number; c: number }>();
  for (const r of numReads) {
    const e = tally.get(r.text) ?? { n: 0, c: 0 };
    tally.set(r.text, { n: e.n + 1, c: e.c + r.confidence });
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].c - a[1].c);
  let final = ranked[0] ? { text: ranked[0][0], n: ranked[0][1].n } : { text: number, n: 1 };
  let sure = final.n >= 2 && (!ranked[1] || ranked[1][1].n < final.n);
  // The holes, seen the same both ways, outweigh the count: a reading they do not allow (an 8 where one hole is) gives way
  // to one they allow that two readings gave; seen differently, they only part a tie.
  const plain = holes.length === 2 && holes[0].join() === holes[1].join();
  // None of the readings fits the marks' shapes, both ways seen alike: the most read one put right by them, if only one
  // digit could stand at each place it is wrong (a blurred 9 read as an 8 by every reading).
  let righted: string | undefined;
  if (plain && ranked.length && !ranked.some(([t]) => fits(t))) {
    righted = rightedByShapes(ranked[0][0], shapes[0]);
    if (righted) ranked.unshift([righted, { n: ranked[0][1].n, c: ranked[0][1].c }]);
  }
  const rival = ranked.find(([t, e]) => t !== final.text && fits(t) && (plain ? e.n >= 2 : e.n >= final.n - 1));
  if (rival && !fits(final.text)) (final = { text: rival[0], n: rival[1].n }), (sure = final.n >= 2);
  else if (!sure && final.n >= 2 && fits(final.text) && !ranked.some(([t, e]) => t !== final.text && e.n >= final.n && fits(t))) sure = true;
  // Put right by the shapes, it is a guess to look at, not a reading.
  if (final.text === righted) sure = false;
  // Fewer or more digits than its marks, and their shapes do not allow it: not sure (777 read as 11).
  const marksN = shapes[0]?.length ?? 0;
  if (marksN && final.text.length !== marksN && !fits(final.text)) sure = false;
  trace('number', { reads: numReads.map((r) => r.text), holes, pick: final.text, n: final.n, sure, righted });
  return { number: final.text, sure, code, codeSure, emirate, row, numberBox: boxOf(digits), codeBox };
}
