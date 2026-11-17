import { describe, expect, it } from 'vitest';
import { FONT_SAMPLES } from './vinGlyphBook';
import { holesIn, keep, likeness, opened, piecesOf, readPieces, SIDE, shapeOf, spacedOut, thin, unkeep, type Sample } from './vinGlyphs';

const book: Sample[] = FONT_SAMPLES.map(unkeep);

/** A mask of `w`×`h` drawn by `on(x, y)`. */
const mask = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) m[y * w + x] = 1;
  return m;
};
/** A ring (a 0) `w`×`h`, its stroke `t` thick. */
const ring = (w: number, h: number, t: number) =>
  mask(w, h, (x, y) => {
    const u = (x - (w - 1) / 2) / (w / 2);
    const v = (y - (h - 1) / 2) / (h / 2);
    const iu = (x - (w - 1) / 2) / (w / 2 - t);
    const iv = (y - (h - 1) / 2) / (h / 2 - t);
    return u * u + v * v <= 1 && iu * iu + iv * iv > 1;
  });

/**
 * A row of characters as ink, each drawn from the book's first sample of it (a typeface's skeleton made strokes
 * again: 2 × the grid, 2 points thick) — `px` tall, a third of a letter apart; a wide gap after `gapAfter`.
 */
function row(text: string, opts: { gapAfter?: number } = {}) {
  const k = 2;
  const px = SIDE * k;
  const H = px * 2;
  const glyphs = [...text].map((c) => book.find((s) => s.c === c)!);
  const W = glyphs.length * px + 4 * px;
  const ink = new Uint8Array(W * H);
  let x0 = px;
  glyphs.forEach((g, i) => {
    const xs: number[] = [];
    g.bits.forEach((b, j) => b && xs.push(j % SIDE));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    g.bits.forEach((b, j) => {
      if (!b) return;
      const gx = (j % SIDE) - left;
      const gy = Math.floor(j / SIDE);
      for (let dy = -1; dy <= 2; dy++)
        for (let dx = -1; dx <= 2; dx++) {
          const x = x0 + gx * k + dx;
          const y = H / 2 - px / 2 + gy * k + dy;
          if (x >= 0 && y >= 0 && x < W && y < H) ink[y * W + x] = 1;
        }
    });
    x0 += (right - left) * k + Math.round(px * 0.3) + (i === opts.gapAfter ? px : 0);
  });
  return { ink, W, H, px };
}

describe('a character by its shape', () => {
  it('is thinned to a line a point wide, its holes counted', () => {
    const bar = thin(mask(7, 30, () => true), 7, 30);
    for (let y = 3; y < 27; y++) expect(bar.slice(y * 7, y * 7 + 7).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
    expect(holesIn(ring(20, 30, 4), 20, 30)).toBe(1);
    // An 8: two rings, one on the other.
    const eight = mask(20, 56, (x, y) => (y < 28 ? ring(20, 28, 4)[y * 20 + x] : ring(20, 28, 4)[(y - 28) * 20 + x]) === 1);
    expect(holesIn(eight, 20, 56)).toBe(2);
    // A C: the ring open on its right.
    expect(holesIn(mask(20, 30, (x, y) => ring(20, 30, 4)[y * 20 + x] === 1 && !(x > 12 && Math.abs(y - 15) < 6)), 20, 30)).toBe(0);
  });

  it('a ring is read as a 0 or an O-like letter, a bar as a 1 — and a sample kept is the same sample again', () => {
    const zero = shapeOf(ring(26, 40, 4), 26, 40)!;
    expect(['0', 'D']).toContain(likeness(zero, book)[0].c);
    const one = shapeOf(mask(6, 40, () => true), 6, 40)!;
    expect(likeness(one, book)[0].c).toBe('1');
    const again = unkeep(keep('0', zero));
    expect([...again.bits]).toEqual([...zero.bits]);
    expect(again.holes).toBe(zero.holes);
  });
});

describe('a row read by its characters', () => {
  it('reads the seventeen characters of a VIN, its last four as digits', () => {
    const { ink, W, H, px } = row('JN1TANY62G0123456');
    const r = readPieces(piecesOf(ink, W, H, px), book)!;
    expect(r.text).toBe('JN1TANY62G0123456');
    expect(r.parts).toHaveLength(17);
  });

  it('a letter fallen apart into its strokes is read as one (an engraved M, its two sides apart)', () => {
    const { ink, W, H, px } = row('JMYMRV83W8J723018');
    // Each M's middle cut out: its two sides are pieces of their own.
    const p0 = piecesOf(ink, W, H, px);
    const ms = p0.marks.filter((_, i) => i === 1 || i === 3);
    for (const m of ms) for (let y = 0; y < H; y++) for (let x = m.x0 + Math.round((m.x1 - m.x0) * 0.3); x <= m.x0 + Math.round((m.x1 - m.x0) * 0.7); x++) ink[y * W + x] = 0;
    const p = piecesOf(ink, W, H, px);
    expect(p.marks.length).toBeGreaterThan(17);
    // Its Ms read whole (this typeface's 8 and B are alike — the check digit tells them apart, not the shapes).
    expect(readPieces(p, book)?.text).toMatch(/^JMYMRV[8B]3W[8B]J723018$/);
  });

  it('seventeen characters out of a longer line of words are no VIN', () => {
    const spaced = row('JN1TANY62G0123456', { gapAfter: 7 });
    expect(readPieces(piecesOf(spaced.ink, spaced.W, spaced.H, spaced.px), book)).toBeUndefined();
    // Nineteen characters in a row: the line goes on past any seventeen of them.
    const long = row('2354565R17108962023');
    expect(readPieces(piecesOf(long.ink, long.W, long.H, long.px), book)).toBeUndefined();
  });

  it('a known VIN is laid over the pieces, each place as its own character (learning a plate)', () => {
    const { ink, W, H, px } = row('MA3NC2B16PA603552');
    const r = readPieces(piecesOf(ink, W, H, px), book, 'MA3NC2B16PA603552', 1.6, Infinity)!;
    expect(r.text).toBe('MA3NC2B16PA603552');
    expect(r.chars.every((c) => c.shape)).toBe(true);
  });

  it('its characters are set apart for the engine, each in a cell of its own', () => {
    const { ink, W, H, px } = row('JN1TANY62G0123456');
    const p = piecesOf(ink, W, H, px);
    const r = readPieces(p, book)!;
    const sp = spacedOut(p, r.parts, px);
    expect(sp.W).toBeGreaterThan(17 * px);
    expect(sp.ink.reduce((a, b) => a + b, 0)).toBeGreaterThan(17 * px);
  });

  it('opened ink keeps strokes and loses threads of grain', () => {
    const W = 40;
    const H = 20;
    // A thick stroke and a thread a point wide beside it.
    const ink = mask(W, H, (x, y) => (x >= 5 && x <= 10 && y >= 2 && y <= 17) || (y === 10 && x > 10 && x < 35));
    const o = opened(ink, W, H);
    expect(o[10 * W + 7]).toBe(1);
    expect(o[10 * W + 25]).toBe(0);
  });
});
