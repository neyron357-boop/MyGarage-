import type { Line, Page, Worker as OcrWorker } from 'tesseract.js';
import { db } from '../db/db';
import type { Vehicle } from '../domain/types';
import { checkDigitOk, fixByCheckDigit, mulkiyaYear, pickVin, VIN_CHARS, vinChars, vinsInText, voteVin, type VinPick, type VinRead } from '../domain/vin';
import { mulkiyaOf, vinPhotoOf } from './cover';
import { mediaBlob } from './media';

/*
 * A car's VIN and model year read off its photos — the VIN plate and the Mulkiya — on the phone itself
 * (Tesseract; its engine and English model are the app's own files: it reads offline and no photo leaves the
 * phone). Each photo is read the way a careful person reads it:
 *   - a VIN plate or label: its lines of text found by their outlines (the glass, dust, glare and hand around them
 *     are not read at all), each turned level, evened out against glare and read as nothing but VIN characters,
 *     several ways — light letters turned dark, the wrong way up turned over;
 *   - a card (the Mulkiya): turned the right way up (the side that reads the most real words), read whole in grey;
 *     every line that looks like a VIN or carries its label ("Chassis No.", "VIN") cut out, enlarged and read again
 *     as VIN characters only; if no VIN proved itself yet, the whole card in black on white (a gold card's
 *     pattern), then its lines found by their outlines.
 * What was read is judged by the VIN's own rules (domain/vin.ts): a VIN goes into the car's card by itself only
 * when it proves itself; anything less is offered to be looked at, and a different VIN already there stays.
 */

const BASE = () => new URL('ocr/', document.baseURI).href;

let worker: Promise<OcrWorker> | undefined;
let idle: number | undefined;

async function engine(): Promise<OcrWorker> {
  window.clearTimeout(idle);
  worker ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${BASE()}worker.min.js`,
      corePath: BASE(),
      langPath: `${BASE()}lang`,
      gzip: true,
    });
  })().catch((e) => {
    worker = undefined;
    throw e;
  });
  return worker;
}

/** The engine is let go a while after the last read (it holds ~100 MB; a phone needs it back). */
function rest() {
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    const w = worker;
    worker = undefined;
    void w?.then((x) => x.terminate()).catch(() => undefined);
  }, 45_000);
}

/* ---------------- The picture, made ready to read ---------------- */

type Angle = 0 | 90 | 180 | 270;

/** The photo turned by `angle`, its long side at most `max` px. */
function draw(bmp: ImageBitmap, angle: Angle, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const quarter = angle === 90 || angle === 270;
  const c = document.createElement('canvas');
  c.width = quarter ? h : w;
  c.height = quarter ? w : h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((angle * Math.PI) / 180);
  g.drawImage(bmp, -w / 2, -h / 2, w, h);
  return c;
}

/** In grey, its contrast stretched (the darkest 1 % black, the lightest 1 % white). */
function grey(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = y;
    hist[y | 0]++;
  }
  const n = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let s = 0; lo < 255 && (s += hist[lo]) < n * 0.01; ) lo++;
  for (let s = 0; hi > 0 && (s += hist[hi]) < n * 0.01; ) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Black on white by the light around each point (Bradley's adaptive threshold): glare, shade and a card's
 * printed pattern do not swallow the letters. Light letters on dark (an embossed plate) are turned the right way.
 */
function blackOnWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += d[(y * w + x) * 4];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 32));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d', { willReadFrequently: true })!;
  const img = g.createImageData(w, h);
  let dark = 0;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      const v = d[(y * w + x) * 4] * area < s * 0.85 ? 0 : 255;
      if (!v) dark++;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  // More ink than paper: light letters on a dark ground — turned to black on white.
  if (dark > (w * h) / 2) for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 - img.data[i];
  g.putImageData(img, 0, 0);
  return out;
}

interface Spot {
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The line's slope (its baseline), radians. */
  tilt: number;
}

/**
 * A line of the picture cut out with room around it, turned level by its baseline (a plate is rarely shot
 * square), enlarged so its letters are about `px` high — on a white ground.
 */
function lineCut(src: HTMLCanvasElement, { box, tilt }: Spot, px = 64): HTMLCanvasElement {
  const h = Math.max(8, box.y1 - box.y0);
  const padY = Math.round(h * 0.6);
  const padX = Math.round(h * 0.8);
  const x0 = Math.max(0, box.x0 - padX);
  const y0 = Math.max(0, box.y0 - padY);
  const x1 = Math.min(src.width, box.x1 + padX);
  const y1 = Math.min(src.height, box.y1 + padY);
  const k = Math.min(5, Math.max(1, px / h));
  const w = Math.round((x1 - x0) * k);
  const hh = Math.round((y1 - y0) * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, hh);
  g.imageSmoothingQuality = 'high';
  g.translate(w / 2, hh / 2);
  g.rotate(-tilt);
  g.drawImage(src, x0, y0, x1 - x0, y1 - y0, -w / 2, -hh / 2, w, hh);
  return c;
}

/** A line's place on the picture and its slope (its baseline; a steep one is a misjudged line, read as level). */
function spotOf(l: Line): Spot {
  const b = l.baseline;
  const tilt = b && b.x1 !== b.x0 ? Math.atan2(b.y1 - b.y0, b.x1 - b.x0) : 0;
  return { box: l.bbox, tilt: Math.abs(tilt) < 0.35 ? tilt : 0 };
}

/** The picture of a line, small, to show beside what was read off it (the sheet a VIN is checked on). */
function snapshot(c: HTMLCanvasElement): string {
  const k = Math.min(1, 720 / c.width, 120 / c.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.width * k));
  out.height = Math.max(1, Math.round(c.height * k));
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.82);
}

/**
 * A moment for the screen between two heavy steps on a picture (they run beside the app, not in the reader's own
 * worker): a tap or a scroll meanwhile is answered, not held until the whole photo is read.
 */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/** Too small to hold a VIN anyone could read (a thumbnail, a blank): not read at all. */
const tooSmall = (b: ImageBitmap) => Math.min(b.width, b.height) < 48 || b.width * b.height < 60_000;

/* ---------------- Lines of text found by their outlines ---------------- */

/** A line of text on a picture: its middle, length and height (px), its slope (degrees), how much it looks like text. */
interface TextLine {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  score: number;
}

/**
 * The lines of text on a photo, found by their outlines rather than by reading it (a photo of a VIN plate is mostly
 * not text — glass, dust, glare, a hand — and a reading of it whole loses the one line that matters):
 *   - outlines in whichever colour shows them best (silver letters on a red plate are faint in grey), dust blurred away;
 *   - joined along each row into lines; each group of lines turned level by its own slope (the one that makes its
 *     rows sharpest), split into its lines at the quiet rows between them, and each line into its pieces;
 *   - best first: dense, long (a VIN is 17 characters), not too thin.
 */
function textLines(c: HTMLCanvasElement): TextLine[] {
  const W = c.width;
  const H = c.height;
  const n = W * H;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const G = new Float32Array(n);
  const C = new Float32Array(n);
  const B = new Float32Array(n);
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < n; i++) C[i] = d[i * 4 + ch];
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        B[i] = (C[i - W - 1] + C[i - W] + C[i - W + 1] + C[i - 1] + C[i] + C[i + 1] + C[i + W - 1] + C[i + W] + C[i + W + 1]) / 9;
      }
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        const gx = B[i - W + 1] + 2 * B[i + 1] + B[i + W + 1] - B[i - W - 1] - 2 * B[i - 1] - B[i + W - 1];
        const gy = B[i + W - 1] + 2 * B[i + W] + B[i + W + 1] - B[i - W - 1] - 2 * B[i - W] - B[i - W + 1];
        const g = Math.abs(gx) + Math.abs(gy);
        if (g > G[i]) G[i] = g;
      }
  }
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    sum += G[i];
    sum2 += G[i] * G[i];
  }
  const mean = sum / n;
  const th = Math.max(30, mean + 1.5 * Math.sqrt(Math.max(0, sum2 / n - mean * mean)));
  const E = new Uint8Array(n);
  for (let i = 0; i < n; i++) E[i] = G[i] > th ? 1 : 0;
  // The letters of a line joined: short gaps along each row filled.
  const M = E.slice();
  const gap = Math.round(W * 0.012);
  for (let y = 0; y < H; y++) {
    let last = -1;
    for (let x = 0; x < W; x++)
      if (E[y * W + x]) {
        if (last >= 0 && x - last - 1 <= gap) M.fill(1, y * W + last + 1, y * W + x);
        last = x;
      }
  }
  const L = new Int32Array(n);
  const q = new Int32Array(n);
  const out: TextLine[] = [];
  let label = 0;
  for (let s = 0; s < n; s++) {
    if (!M[s] || L[s]) continue;
    label++;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    L[s] = label;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      const y = (i - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && M[i - 1] && !L[i - 1]) (L[i - 1] = label), (q[tail++] = i - 1);
      if (x < W - 1 && M[i + 1] && !L[i + 1]) (L[i + 1] = label), (q[tail++] = i + 1);
      if (y > 0 && M[i - W] && !L[i - W]) (L[i - W] = label), (q[tail++] = i - W);
      if (y < H - 1 && M[i + W] && !L[i + W]) (L[i + W] = label), (q[tail++] = i + W);
    }
    if (x1 - x0 >= 30 && y1 - y0 >= 5) groupLines(E, L, W, label, x0, y0, x1, y1, out);
  }
  return out.filter((l) => l.w / l.h >= 4 && l.h >= 8 && l.score > 0).sort((a, b) => b.score - a.score);
}

/** One joined group of outlines: levelled by its own slope, split into its lines and their pieces (see `textLines`). */
function groupLines(E: Uint8Array, L: Int32Array, W: number, label: number, x0: number, y0: number, x1: number, y1: number, out: TextLine[]) {
  const px: number[] = [];
  const py: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (E[i] && L[i] === label) px.push(x), py.push(y);
    }
  if (px.length < 40) return;
  const step = Math.max(1, Math.floor(px.length / 6000));
  let angle = 0;
  let sharpest = -1;
  for (let a = -16; a <= 16; a += 2) {
    const r = (a * Math.PI) / 180;
    const bins = new Map<number, number>();
    for (let k = 0; k < px.length; k += step) {
      const b = Math.round((py[k] * Math.cos(r) - px[k] * Math.sin(r)) / 2);
      bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    let e = 0;
    for (const v of bins.values()) e += v * v;
    if (e > sharpest) (sharpest = e), (angle = a);
  }
  const r = (angle * Math.PI) / 180;
  const sn = Math.sin(r);
  const cs = Math.cos(r);
  const U = px.map((x, k) => x * cs + py[k] * sn);
  const V = px.map((x, k) => py[k] * cs - x * sn);
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const v of V) (vMin = Math.min(vMin, v)), (vMax = Math.max(vMax, v));
  vMin = Math.floor(vMin);
  const raw = new Array<number>(Math.ceil(vMax) - vMin + 1).fill(0);
  for (const v of V) raw[Math.round(v) - vMin]++;
  const rows = raw.map((v, k) => ((raw[k - 1] ?? v) + 2 * v + (raw[k + 1] ?? v)) / 4);
  const peak = Math.max(...rows);
  // Busy rows make a band; a band is split again where a row is much quieter than the lines on both its sides.
  const lines: [number, number][] = [];
  const split = (a: number, b: number) => {
    if (b - a < 12) return void lines.push([a, b]);
    const left = rows.slice(a, b + 1);
    const right = [...left];
    for (let k = 1; k < left.length; k++) left[k] = Math.max(left[k], left[k - 1]);
    for (let k = right.length - 2; k >= 0; k--) right[k] = Math.max(right[k], right[k + 1]);
    let at = -1;
    for (let k = 4; k <= b - a - 4; k++) if (rows[a + k] < 0.45 * Math.min(left[k - 1], right[k + 1]) && (at < 0 || rows[a + k] < rows[a + at])) at = k;
    if (at < 0) lines.push([a, b]);
    else split(a, a + at), split(a + at + 1, b);
  };
  let start = -1;
  rows.forEach((v, k) => {
    const busy = v >= Math.max(1.5, peak * 0.12);
    if (busy && start < 0) start = k;
    if ((!busy || k === rows.length - 1) && start >= 0) split(start, busy ? k : k - 1), (start = -1);
  });
  const push = (u0: number, u1: number, v0: number, v1: number, count: number) => {
    const w = u1 - u0 + 1;
    const h = v1 - v0 + 1;
    if (w < 30) return;
    const dens = count / (w * h);
    const uc = (u0 + u1) / 2;
    const vc = (v0 + v1) / 2;
    out.push({ cx: uc * cs - vc * sn, cy: uc * sn + vc * cs, w, h, angle, score: dens >= 0.08 ? dens * Math.min(w / h, 18) * Math.sqrt(h) : 0 });
  };
  for (const [a, b] of lines) {
    if (b - a < 5) continue;
    const v0 = vMin + a;
    const v1 = vMin + b;
    const bh = v1 - v0 + 1;
    const us: number[] = [];
    V.forEach((v, k) => v >= v0 && v <= v1 && us.push(U[k]));
    us.sort((p, q) => p - q);
    // Its pieces: apart by more than two letters' height. With several, the whole line is one more (a VIN with a gap).
    let from = us[0];
    let prev = us[0];
    let count = 0;
    let pieces = 0;
    for (const u of us) {
      if (u - prev > bh * 2) push(from, prev, v0, v1, count), (from = u), (count = 0), pieces++;
      count++;
      prev = u;
    }
    push(from, prev, v0, v1, count);
    if (pieces) push(us[0], us[us.length - 1], v0, v1, us.length);
  }
}

/** A found line cut out of `src` (`f` times the size of the picture it was found on): level, its letters about `px` high, turned over if `flip`. */
function cutLine(src: HTMLCanvasElement, l: TextLine, f: number, px: number, flip = false): HTMLCanvasElement {
  const w = l.w * f;
  const h = l.h * f;
  const k = Math.min(6, Math.max(0.5, px / h));
  const c = document.createElement('canvas');
  c.width = Math.round((w + 1.8 * h) * k);
  c.height = Math.round(2 * h * k);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  if (flip) g.rotate(Math.PI);
  g.scale(k, k);
  g.rotate((-l.angle * Math.PI) / 180);
  g.translate(-l.cx * f, -l.cy * f);
  g.drawImage(src, 0, 0);
  return c;
}

/** The brightness of each point of a picture. */
function luma(c: HTMLCanvasElement): Float64Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const Y = new Float64Array(c.width * c.height);
  for (let i = 0; i < Y.length; i++) Y[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return Y;
}

/** A grey picture of `c`'s size from its brightness (0–255). */
function paint(c: HTMLCanvasElement, v: (i: number) => number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  const g = out.getContext('2d', { willReadFrequently: true })!;
  const img = g.createImageData(c.width, c.height);
  for (let i = 0; i < c.width * c.height; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v(i);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}

/** Light letters on a darker ground (a windscreen label, a stamped plate)? Its middle band's brightest are the rare ones. */
function lightLetters(c: HTMLCanvasElement): boolean {
  const Y = luma(c);
  const from = Math.floor(c.height * 0.3) * c.width;
  const to = Math.floor(c.height * 0.7) * c.width;
  let n = 0;
  let s = 0;
  for (let i = from; i < to; i++) (s += Y[i]), n++;
  const m = s / Math.max(1, n);
  let m2 = 0;
  let m3 = 0;
  for (let i = from; i < to; i++) (m2 += (Y[i] - m) ** 2), (m3 += (Y[i] - m) ** 3);
  return m3 > 0 && m2 > 0;
}

/** Local sums of a picture's brightness (and its square), for the mean and spread around each point. */
function around(Y: Float64Array, W: number, H: number, r: number) {
  const S = new Float64Array((W + 1) * (H + 1));
  const S2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let a = 0;
    let b = 0;
    for (let x = 0; x < W; x++) {
      const v = Y[y * W + x];
      a += v;
      b += v * v;
      const k = (y + 1) * (W + 1) + x + 1;
      S[k] = S[y * (W + 1) + x + 1] + a;
      S2[k] = S2[y * (W + 1) + x + 1] + b;
    }
  }
  return (x: number, y: number) => {
    const xa = Math.max(0, x - r);
    const xb = Math.min(W, x + r + 1);
    const ya = Math.max(0, y - r);
    const yb = Math.min(H, y + r + 1);
    const k = (yb - ya) * (xb - xa);
    const t = (A: Float64Array) => A[yb * (W + 1) + xb] - A[ya * (W + 1) + xb] - A[yb * (W + 1) + xa] + A[ya * (W + 1) + xa];
    const mean = t(S) / k;
    return { mean, spread: Math.sqrt(Math.max(1, t(S2) / k - mean * mean)) };
  };
}

/** The line in grey, evened out: each point against the light around it — dark letters on a light ground, whatever the glare. */
function evened(c: HTMLCanvasElement, light: boolean): HTMLCanvasElement {
  const Y = luma(c);
  const W = c.width;
  const at = around(Y, W, c.height, Math.max(6, Math.round(c.height * 0.45)));
  return paint(c, (i) => {
    const { mean, spread } = at(i % W, Math.floor(i / W));
    const z = ((Y[i] - mean) / Math.max(12, spread)) * (light ? -1 : 1);
    return Math.max(0, Math.min(255, 190 + z * 70));
  });
}

/**
 * The line in black and white by the light around each point, letters black — and the specks (dust on the glass,
 * grain) taken off: only marks of a letter's size stay.
 */
function inked(c: HTMLCanvasElement, light: boolean, letter: number): HTMLCanvasElement {
  const Y = luma(c);
  const W = c.width;
  const H = c.height;
  // Stretched to full range first (the darkest and lightest 1 % apart).
  const sorted = Float64Array.from(Y).sort();
  const lo = sorted[Math.floor(Y.length * 0.01)];
  const span = Math.max(1, sorted[Math.floor(Y.length * 0.99)] - lo);
  for (let i = 0; i < Y.length; i++) Y[i] = Math.max(0, Math.min(255, ((Y[i] - lo) * 255) / span));
  const at = around(Y, W, H, Math.max(6, Math.round(H * 0.45)));
  const ink = new Uint8Array(Y.length);
  for (let i = 0; i < Y.length; i++) {
    const m = at(i % W, Math.floor(i / W)).mean;
    ink[i] = (light ? Y[i] > m + 10 : Y[i] < m - 10) ? 1 : 0;
  }
  despeck(ink, W, H, letter);
  return paint(c, (i) => (ink[i] ? 0 : 255));
}

/** The line in black and white by one threshold for all of it (Otsu's) — the rarer of the two is the letters. */
function inkedAtOnce(c: HTMLCanvasElement, letter: number): HTMLCanvasElement {
  const Y = luma(c);
  const hist = new Array<number>(256).fill(0);
  for (const v of Y) hist[v | 0]++;
  let all = 0;
  for (let k = 0; k < 256; k++) all += k * hist[k];
  let wB = 0;
  let sB = 0;
  let best = -1;
  let t = 128;
  for (let k = 0; k < 256; k++) {
    wB += hist[k];
    const wF = Y.length - wB;
    if (!wB || !wF) continue;
    sB += k * hist[k];
    const between = wB * wF * (sB / wB - (all - sB) / wF) ** 2;
    if (between > best) (best = between), (t = k);
  }
  let bright = 0;
  for (const v of Y) if (v > t) bright++;
  const lightInk = bright < Y.length / 2;
  const ink = new Uint8Array(Y.length);
  for (let i = 0; i < Y.length; i++) ink[i] = Y[i] > t === lightInk ? 1 : 0;
  despeck(ink, c.width, c.height, letter);
  return paint(c, (i) => (ink[i] ? 0 : 255));
}

/** Marks too small or too tall to be part of a letter `letter` px high, taken off. */
function despeck(ink: Uint8Array, W: number, H: number, letter: number) {
  const seen = new Uint8Array(ink.length);
  const q = new Int32Array(ink.length);
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    seen[s] = 1;
    let y0 = H;
    let y1 = 0;
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      const y = (i - x) / W;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (ink[j] && !seen[j]) (seen[j] = 1), (q[tail++] = j);
        }
    }
    const tall = y1 - y0 + 1;
    if (tail < letter * letter * 0.02 || tall < letter * 0.35 || tall > letter * 1.8) for (let k = 0; k < tail; k++) ink[q[k]] = 0;
  }
}

/* ---------------- Reading ---------------- */

/** How Tesseract is to take the picture: a sparse page, a line, a raw line (no layout guesses), one word, a block of lines. */
const MODES = { page: '11', line: '7', raw: '13', word: '8', block: '6' } as const;

/**
 * One reading: a whole page (sparse text: a card's fields lie apart), or VIN characters only — a line (or raw: a
 * second opinion on the same line), one word (a VIN alone on its line), a few lines together.
 */
async function page(w: OcrWorker, image: HTMLCanvasElement, mode: keyof typeof MODES = 'page'): Promise<Page> {
  await w.setParameters({
    tessedit_pageseg_mode: MODES[mode] as never,
    tessedit_char_whitelist: mode === 'page' ? '' : VIN_CHARS,
    user_defined_dpi: '300',
  });
  return (await w.recognize(image, {}, { text: true, blocks: true })).data;
}

const linesOf = (p: Page) => (p.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((pa) => pa.lines));

/** How sure the reading was of each character of a VIN read off a line (its symbols, in order), when they line up. */
function charConfidence(p: Page, vin: string): number[] | undefined {
  const symbols = linesOf(p)
    .flatMap((l) => l.words.flatMap((w) => w.symbols))
    .map((s) => ({ c: vinCharsOne(s.text), conf: s.confidence }))
    .filter((s) => s.c);
  const text = symbols.map((s) => s.c).join('');
  const at = text.indexOf(vin);
  return at < 0 ? undefined : symbols.slice(at, at + 17).map((s) => Math.round(s.conf));
}
const vinCharsOne = (s: string) => {
  const u = s.toUpperCase();
  return u === 'O' || u === 'Q' ? '0' : u === 'I' ? '1' : /^[A-Z0-9]$/.test(u) ? u : '';
};

/** How much real reading a page holds: the letters of its confident words (the right way up reads the most). */
function sense(p: Page): number {
  let n = 0;
  for (const l of linesOf(p)) for (const w of l.words) if (w.confidence >= 70 && /[A-Za-z0-9]{3,}/.test(w.text)) n += w.text.length;
  return n;
}

/** The lines worth reading again: a VIN-looking run, or a VIN's label (and the line under it) — with their slope. */
function vinLines(p: Page): Spot[] {
  const lines = linesOf(p);
  const out: Spot[] = [];
  lines.forEach((l, i) => {
    const t = l.text.toUpperCase();
    const run = t.replace(/[^A-Z0-9]/g, '');
    const label = /CHASS|VIN\b|V1N|FRAME/.test(t);
    if (label || (run.length >= 12 && (run.match(/\d/g)?.length ?? 0) >= 4)) out.push(spotOf(l));
    if (label && lines[i + 1]) out.push(spotOf(lines[i + 1]));
  });
  return out.slice(0, 6);
}

export interface PhotoRead {
  reads: VinRead[];
  years: number[];
  /** The picture of the line each VIN was read off (a small JPEG address), to check it by. */
  crops: Record<string, string>;
}

/**
 * What one photo says: every VIN read off it (and put right by its check digit where one swap does it), and the
 * years. `kind` — a VIN plate or label (its lines are found by their outlines first) or a card (read whole first:
 * its "Model" year too).
 */
export async function readPhoto(blob: Blob, source: string, kind: 'plate' | 'card' = 'card'): Promise<PhotoRead> {
  const bmp = await createImageBitmap(blob);
  if (tooSmall(bmp)) {
    bmp.close();
    return { reads: [], years: [], crops: {} };
  }
  const w = await engine();
  const reads: VinRead[] = [];
  const years: number[] = [];
  const cuts = new Map<string, HTMLCanvasElement>();
  /** What a reading said; `line` — it read a line cut out (that cut is the VIN's picture), else a page drawn on `src`. */
  const take = (p: Page, src: HTMLCanvasElement, line = false) => {
    for (const vin of vinsInText(p.text)) {
      reads.push({ vin, source, conf: charConfidence(p, vin) });
      const fixed = fixByCheckDigit(vin);
      if (fixed) reads.push({ vin: fixed, source, from: vin });
      if (cuts.has(vin)) continue;
      const at = line ? undefined : linesOf(p).find((l) => vinChars(l.text).includes(vin));
      const cut = line ? src : at && lineCut(src, spotOf(at));
      if (!cut) continue;
      cuts.set(vin, cut);
      if (fixed && !cuts.has(fixed)) cuts.set(fixed, cut);
    }
    const y = mulkiyaYear(p.text);
    if (y) years.push(y);
  };
  // A VIN proves itself on a photo when it adds up and was read so twice (one lucky misreading may add up too).
  const proven = () => {
    const seen = new Set<string>();
    for (const r of reads) {
      if (r.from || !checkDigitOk(r.vin)) continue;
      if (seen.has(r.vin)) return true;
      seen.add(r.vin);
    }
    return false;
  };

  /** The photo read whole, the way a card is: turned the right way up, then its VIN-looking lines read again. */
  const byPage = async () => {
    // 1. Which way up: small and quick, the sides tried in turn; the first that clearly reads ends the search.
    let angle: Angle = 0;
    let best = -1;
    for (const a of [0, 90, 270, 180] as Angle[]) {
      await breathe();
      const p = await page(w, grey(draw(bmp, a, 1000)), 'page');
      const s = sense(p);
      if (s > best) {
        best = s;
        angle = a;
      }
      if (s >= 40 || vinsInText(p.text).length) break;
    }
    // 2. The whole photo, right way up, as large as it is.
    await breathe();
    const full = grey(draw(bmp, angle, 1920));
    const whole = await page(w, full);
    take(whole, full);
    // 3. Each VIN-looking line, levelled and enlarged, read as VIN characters only — several ways (a line, raw;
    //    grey, black on white; larger): one of them reading it right is enough for its check digit to show which.
    const again = async (p: Page, src: HTMLCanvasElement) => {
      for (const spot of vinLines(p)) {
        const cut = lineCut(src, spot);
        take(await page(w, cut, 'line'), cut, true);
        if (proven()) continue;
        take(await page(w, cut, 'raw'), cut, true);
        if (proven()) continue;
        take(await page(w, blackOnWhite(cut), 'line'), cut, true);
        if (proven()) continue;
        const large = lineCut(src, spot, 96);
        take(await page(w, large, 'line'), large, true);
      }
    };
    await again(whole, full);
    // 4. Nothing proved itself yet: the whole photo in black on white, and its lines.
    if (!proven()) {
      await breathe();
      const p = await page(w, blackOnWhite(full));
      take(p, full);
      await again(p, full);
    }
  };

  /**
   * The lines found by their outlines (`textLines`; the photo as it is and turned a quarter — a label is often shot
   * sideways), best first. A first look at each, as one word of evened grey, this way up and (when that read no VIN)
   * turned over: the way a VIN was read — or that read the most like one — is gone on with, several more ways
   * (black and white by the light around or at once, light letters turned dark, a few lines together when the line
   * is tall) until a VIN proves itself; a line that reads like nothing either way is not a VIN's.
   */
  const byLines = async () => {
    const scale = (max: number) => Math.min(1, max / Math.max(bmp.width, bmp.height));
    const f = scale(1920) / scale(1200);
    const found: { l: TextLine; angle: Angle }[] = [];
    for (const angle of [0, 90] as Angle[]) {
      await breathe();
      for (const l of textLines(draw(bmp, angle, 1200))) found.push({ l, angle });
    }
    found.sort((a, b) => b.l.score - a.l.score);
    const srcs = new Map<Angle, HTMLCanvasElement>();
    const px = 56;
    for (const { l, angle } of found.slice(0, 6)) {
      const src = srcs.get(angle) ?? draw(bmp, angle, 1920);
      srcs.set(angle, src);
      const light = lightLetters(cutLine(src, l, f, px));
      const look = async (flip: boolean) => {
        const cut = cutLine(src, l, f, px, flip);
        const before = reads.length;
        const p = await page(w, evened(cut, light), 'word');
        take(p, cut, true);
        return { flip, cut, vin: reads.length > before, chars: vinChars(p.text).length };
      };
      const asIs = await look(false);
      if (proven()) return;
      const over = asIs.vin ? undefined : await look(true);
      if (proven()) return;
      const way = [asIs, over].find((x) => x?.vin) ?? [asIs, over].filter((x) => x && x.chars >= 12).sort((a, b) => b!.chars - a!.chars)[0];
      if (!way) continue;
      const { cut, flip } = way;
      const tries: (() => Promise<Page>)[] = [
        () => page(w, inked(cut, light, px), 'line'),
        () => page(w, inkedAtOnce(cut, px), 'line'),
        () => page(w, evened(cut, light), 'line'),
        () => page(w, inked(cut, !light, px), 'line'),
      ];
      if (l.w / l.h < 10) tries.push(() => page(w, inked(cutLine(src, l, f, px * 2, flip), light, px), 'block'));
      for (const read of tries) {
        take(await read(), cut, true);
        if (proven()) return;
      }
    }
  };

  try {
    if (kind === 'plate') {
      await byLines();
    } else {
      await byPage();
      if (!proven()) await byLines();
    }
    // The readings voted into one, character by character, by how sure each was (domain/vin.ts `voteVin`).
    if (!proven()) {
      const voted = voteVin(reads.filter((r) => !r.from));
      if (voted && !reads.some((r) => r.vin === voted)) {
        reads.push({ vin: voted, source });
        // Its picture: that of a reading it was voted from.
        const from = reads.find((r) => !r.from && cuts.has(r.vin) && [...r.vin].filter((c, i) => c !== voted[i]).length <= 4);
        if (from) cuts.set(voted, cuts.get(from.vin)!);
      }
    }
  } finally {
    bmp.close();
    rest();
  }
  // One small picture per line cut (several VINs read off one line share it).
  const shots = new Map<HTMLCanvasElement, string>();
  const crops: Record<string, string> = {};
  for (const [vin, cut] of cuts) {
    if (!shots.has(cut)) shots.set(cut, snapshot(cut));
    crops[vin] = shots.get(cut)!;
  }
  return { reads, years, crops };
}

/** What each photo said — read once (a photo never changes: a turned one is a new photo). The last few are kept. */
const said = new Map<string, PhotoRead>();
async function readOnce(id: string, kind: 'plate' | 'card'): Promise<PhotoRead | undefined> {
  const known = said.get(id);
  if (known) return known;
  const blob = await mediaBlob(id);
  if (!blob) return undefined;
  const r = await readPhoto(blob, id, kind);
  said.set(id, r);
  if (said.size > 12) said.delete(said.keys().next().value!);
  return r;
}

/* ---------------- The car's card ---------------- */

export interface CarVinRead extends VinPick {
  /** Photos read. */
  photos: number;
  /** Put into the car's card by itself (proven, and the card had none). */
  filled: ('vin' | 'year')[];
  /** What the card had, to put back ("Undo"). */
  before: Pick<Vehicle, 'vin' | 'year'>;
  /** The card already has another VIN / year: kept as it was, to be decided. */
  differs: { vin?: string; year?: number };
  /** The picture of the line the VIN was read off. */
  crop?: string;
}

/**
 * The car's VIN and year read off its photos: the VIN plate, then the Mulkiya's back (where its "Chassis No." and
 * "Model" are), its front only when the back said nothing. What proved itself fills what the card is missing;
 * the rest is returned to be looked at.
 */
export async function readCarVin(vehicleId: string): Promise<CarVinRead> {
  const vehicle = await db.vehicles.get(vehicleId);
  if (!vehicle) throw new Error('vehicle not found');
  const plate = await vinPhotoOf(vehicleId);
  const mulkiya = await mulkiyaOf(vehicleId);
  const queue = [plate, mulkiya.mulkiya_back, mulkiya.mulkiya].filter((x): x is string => !!x);
  const reads: VinRead[] = [];
  const years: number[] = [];
  const crops: Record<string, string> = {};
  let photos = 0;
  for (const id of queue) {
    // The Mulkiya's front only when its back (read before it) gave nothing.
    const back = mulkiya.mulkiya_back;
    if (id === mulkiya.mulkiya && back && (reads.some((r) => r.source === back) || years.length)) break;
    const r = await readOnce(id, id === plate ? 'plate' : 'card');
    if (!r) continue;
    reads.push(...r.reads);
    years.push(...r.years);
    for (const [vin, crop] of Object.entries(r.crops)) crops[vin] ??= crop;
    photos++;
    // A VIN that adds up and its own year: the rest of the photos would only confirm it.
    const p = pickVin(reads, years, vehicle);
    if (p.sure && p.why === 'check' && p.yearSure) break;
  }
  const pick = pickVin(reads, years, vehicle);
  const before = { vin: vehicle.vin, year: vehicle.year };
  const patch: Partial<Vehicle> = {};
  const differs: CarVinRead['differs'] = {};
  if (pick.vin && pick.sure) {
    if (!vehicle.vin) patch.vin = pick.vin;
    else if (vehicle.vin.toUpperCase() !== pick.vin) differs.vin = pick.vin;
  }
  if (pick.year && pick.yearSure) {
    if (!vehicle.year) patch.year = pick.year;
    else if (vehicle.year !== pick.year) differs.year = pick.year;
  }
  if (Object.keys(patch).length) await db.vehicles.update(vehicleId, patch);
  return { ...pick, photos, filled: Object.keys(patch) as ('vin' | 'year')[], before, differs, crop: pick.vin ? crops[pick.vin] : undefined };
}

/** The VIN and year the user looked at and kept (the sheet), or put back as they were ("Undo"). */
export async function setCarVin(vehicleId: string, values: Pick<Vehicle, 'vin' | 'year'>): Promise<void> {
  const vin = values.vin?.trim().toUpperCase() || undefined;
  await db.vehicles.update(vehicleId, { vin, year: values.year });
}
