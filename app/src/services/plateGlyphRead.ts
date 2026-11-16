import { boxOf, codeWord, fitsHoles, gh, glyphsOf, holesOf, inkOf, keepMarks, plateRows, rowsOfAny, sheared, slantOf, splitCode, wordIn, type Box, type FoundRow, type Glyph } from '../domain/plateGlyphs';
import type { Emirate } from '../domain/types';
import { emirateLike } from '../domain/uaePlate';
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
function cleanInks(cut: HTMLCanvasElement, px: number): Ink[] {
  const W = cut.width;
  const H = cut.height;
  const Y = lumaOf(cut);
  const t = otsu(Y);
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = Y[i] <= t ? 1 : 0;
  const b = inkOf(Y, W, H, Math.max(8, Math.round(px * 0.8)), true, 0.15);
  return [a, b].map((ink) => {
    const kept = keepMarks(ink, W, H, px);
    const clean = count(kept) > 0 ? kept : ink;
    const slant = slantOf(clean, W, H);
    const up = sheared(clean, W, H, slant);
    return { ink: up.ink, W: up.W, H, slant };
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

/** The sizes the characters are read at (px tall): a reading misreads at one size what it reads right at another. */
const SIZES = [34, 48];
/** Sizes for a second look when the first readings do not agree. */
const MORE = [40, 28];

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

/** A plate found by its characters on the looked-at picture (`look`), cut from the larger one (`src`). */
export async function readByGlyphs(look: HTMLCanvasElement, src: HTMLCanvasElement, tracer?: (step: string, data: unknown) => void): Promise<GlyphPlate | undefined> {
  const trace = (step: string, data: unknown) => tracer?.(step, data);
  const snap = (img: HTMLCanvasElement) => (tracer ? img.toDataURL('image/png') : undefined);
  const W = look.width;
  const H = look.height;
  const f = src.width / W;
  const rows = plateRows(lumaOf(look), W, H);
  trace('rows', rows.map((r) => ({ n: r.glyphs.length, h: r.h, x: r.x0, y: r.y0, angle: Math.round(r.angle * 10) / 10, score: Math.round(r.score * 10) / 10 })));
  if (!rows.length) return undefined;
  const w = await engine();
  const PX = 56;

  // The number: the likeliest rows read for digits — each cut two ways, at two sizes (two more when they do not agree);
  // what most readings give wins, a digit per mark (one more or less: two marks run together, one broken in two).
  let best: { row: FoundRow; number: string; reads: Reading[]; code: Glyph[]; digits: Glyph[]; inks: Ink[]; weight: number } | undefined;
  for (const row of rows) {
    await breathe();
    const { code, number: digits } = splitCode(row);
    const inks = cleanInks(cutBox(src, boxOf(digits), row.angle, f, row.h, PX, 0.45, 0.32), PX);
    const reads: Reading[] = [];
    const look = async (sizes: number[]) => {
      for (const size of sizes)
        for (const c of inks) {
          const img = atSize(c, PX, size);
          const p = await readAs(w, img, DIGITS);
          const d = p.text.replace(/\D/g, '');
          trace('digits', { text: p.text, confidence: Math.round(p.confidence), size, marks: digits.length, cut: snap(img) });
          if (d.length >= 1 && d.length <= 5 && !/^0+$/.test(d) && Math.abs(d.length - digits.length) <= 1) reads.push({ text: d, confidence: p.confidence });
        }
    };
    await look(SIZES);
    if (reads.length && !(vote(reads)!.alone && vote(reads)!.n >= 3)) await look(MORE);
    const top = vote(reads);
    if (!top) continue;
    // Sure: two readings or more, and none other as many.
    const sure = top.n >= 2 && top.alone;
    const weight = top.n * row.score * (top.text.length >= 4 ? 1.3 : 1) * (top.text.length === digits.length ? 1.2 : 1);
    if (!best || weight > best.weight) best = { row, number: top.text, reads, code, digits, inks, weight };
    if (sure && top.n >= 3 && top.text.length >= 3) break;
  }
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
    return { cut: cutBox(src, box, row.angle, f, h, PX, 0, 0), foot: -v0 * PX, box };
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
      if (emirate) break look;
    }
  }

  // The code: one or two marks beside the number — on its left (Dubai: under the emirate's word; an older plate: before
  // it, of its height), or over it (a short plate). Looked for in the plate itself, cut beside the number in its own
  // frame and made black and white anew there (in the whole photo's ink the code often runs into the plate's frame).
  // Alone, a letter is hardly read at all: it is set before the number, of the number's height, and the line read as a
  // plate's — letters and digits; what it gives before the number is the code. Marks that read as digits of the
  // number's height are the number's own (one missed when the row was found): it takes them, and the code is looked
  // for once more, beside it.
  let code = '';
  let codeSure = false;
  let codeBox: Box | undefined;
  const numeric = emirate === 'AUH' || emirate === 'SHJ';
  /** The code's ink in a cut beside the number, each way of black and white (its word's box, the rest left out). */
  const codeInksIn = (cut: HTMLCanvasElement, foot: number, toward: 'right' | 'bottom'): Ink[] | undefined => {
    const cw = cut.width;
    const chh = cut.height;
    const Y = lumaOf(cut);
    const t = otsu(Y);
    const a = new Uint8Array(cw * chh);
    for (let i = 0; i < a.length; i++) a[i] = Y[i] <= t ? 1 : 0;
    const b = inkOf(Y, cw, chh, Math.max(8, Math.round(PX * 0.8)), true, 0.15);
    let word: Box | undefined;
    for (const ink of [b, a]) {
      const w = codeWord(ink, cw, chh, PX, foot, toward);
      if (w) {
        word = boxOf(w);
        break;
      }
    }
    if (!word) return undefined;
    const wb = word;
    return [a, b].map((ink, k) => {
      const W2 = wb.x1 - wb.x0 + 1;
      const H2 = wb.y1 - wb.y0 + 1;
      const out = new Uint8Array(W2 * H2);
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) out[y * W2 + x] = ink[(y + wb.y0) * cw + x + wb.x0];
      // Leaning as the number leans: stood up by its slant.
      const up = sheared(out, W2, H2, inks[k]?.slant ?? 0);
      return { ink: up.ink, W: up.W, H: H2 };
    });
  };
  for (let tries = 0; tries < 2 && !numeric; tries++) {
    const len = (digits[digits.length - 1].x1 - digits[0].x0) / Math.max(0.2, Math.cos(rad)) / h;
    let codeInks: Ink[] | undefined;
    let marks = 1;
    let where: Box | undefined;
    for (const side of ['right', 'bottom'] as const) {
      const region = side === 'right' ? frameCut(-4.6, -0.04, -1.75, 0.35) : frameCut(-0.6, len + 0.6, -2.7, -0.92);
      codeInks = codeInksIn(region.cut, region.foot, side);
      if (codeInks) {
        where = region.box;
        // How many marks: the pieces of the word's own ink, one or two.
        marks = Math.min(2, Math.max(1, rowsOfAny(glyphsOf(codeInks[1].ink, codeInks[1].W, codeInks[1].H).filter((g) => gh(g) >= codeInks![1].H * 0.6), 0.7).flat().length));
        break;
      }
    }
    if (!codeInks) break;
    const reads: Reading[] = [];
    const lines: Reading[] = [];
    const whole: Reading[] = [];
    for (const size of SIZES)
      for (let k = 0; k < 2; k++) {
        const line = besides(codeInks[k], inks[k], Math.round(PX * 0.45));
        if (!line) continue;
        const img = atSize(line, PX, size);
        const p = await readAs(w, img, LETTERS + DIGITS);
        const m = /^([A-Z]{0,2})(\d{1,7})$/.exec(p.text.replace(/[^A-Z0-9]/g, ''));
        trace('code', { text: p.text, confidence: Math.round(p.confidence), marks, size, cut: snap(img) });
        if (!m) continue;
        if (m[1] && Math.abs(m[2].length - number.length) <= 1) {
          reads.push({ text: m[1], confidence: p.confidence });
          lines.push({ text: m[2], confidence: p.confidence });
        } else if (!m[1] && m[2].length >= number.length + 1 && m[2].length <= number.length + 2 && m[2].length <= 5) whole.push({ text: m[2], confidence: p.confidence });
      }
    const asDigits = vote(whole);
    if (tries === 0 && asDigits && asDigits.n >= 2 && asDigits.n > reads.length) {
      // Its marks were digits of the number: the number takes them (as one cut, from its new first mark).
      numReads = whole;
      number = asDigits.text;
      const extra = asDigits.text.length - digits.length;
      const left = row.all
        .filter((g) => g.x1 < digits[0].x0 && g.x1 > digits[0].x0 - h * 1.6 * extra && Math.abs(gh(g) - h) <= h * 0.3)
        .sort((a, b) => b.x0 - a.x0)
        .slice(0, extra);
      digits = [...left, ...digits].sort((a, b) => a.x0 - b.x0);
      if (!left.length) digits = [{ ...digits[0], x0: Math.max(0, Math.round(digits[0].x0 - h * 0.7 * extra)) }, ...digits.slice(1)];
      inks = cleanInks(cutBox(src, boxOf(digits), row.angle, f, h, PX, 0.45, 0.32), PX);
      continue;
    }
    numReads = [...numReads, ...lines];
    const top = vote(reads);
    if (!top) break;
    code = top.text;
    codeSure = top.n >= 2 && top.alone;
    codeBox = where;
    break;
  }
  // The number: what most of its readings give (its own and those beside its code); sure when two or more give it and
  // none other as many — or, two as many (a blurred 9 read as often as an 8), the one its marks' holes allow.
  const holes = inks.map((c) => holesOf(c.ink, c.W, c.H));
  const fits = (t: string) => holes.some((x) => fitsHoles(t, x));
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
  const rival = ranked.find(([t, e]) => t !== final.text && fits(t) && (plain ? e.n >= 2 : e.n >= final.n - 1));
  if (rival && !fits(final.text)) (final = { text: rival[0], n: rival[1].n }), (sure = final.n >= 2);
  else if (!sure && final.n >= 2 && fits(final.text) && !ranked.some(([t, e]) => t !== final.text && e.n >= final.n && fits(t))) sure = true;
  trace('number', { reads: numReads.map((r) => r.text), holes, pick: final.text, n: final.n, sure });
  return { number: final.text, sure, code, codeSure, emirate, row, numberBox: boxOf(digits), codeBox };
}
