import { describe, expect, it } from 'vitest';
import { charLike, codeWord, codeWords, fitsHoles, fitsShapes, glyphsOf, holesOf, inkOf, keepMarks, plateRows, rightedByShapes, rowsOf, shapesOf, sheared, slantOf, splitCode, wordIn, type Glyph } from './plateGlyphs';

/** A black-and-white picture from rows of text: '#' ink, anything else white. */
const art = (rows: string[], k = 4) => {
  const W = rows[0].length * k;
  const H = rows.length * k;
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ink[y * W + x] = rows[Math.floor(y / k)][Math.floor(x / k)] === '#' ? 1 : 0;
  return { ink, W, H };
};
/** A mark's outline (a ring 4 thick): a character's ink, not a blot. */
const ring = (x0: number, y0: number, w: number, h: number): [number, number, number, number][] => [
  [x0, y0, w, 4],
  [x0, y0 + h - 4, w, 4],
  [x0, y0, 4, h],
  [x0 + w - 4, y0, 4, h],
];
/** Ink drawn as boxes (filled), on a W × H cut. */
const boxes = (W: number, H: number, list: [number, number, number, number][]) => {
  const ink = new Uint8Array(W * H);
  for (const [x0, y0, w, h] of list) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) ink[y * W + x] = 1;
  return ink;
};

/** A mark as a filled box with a hole (a digit's fill is about half its box). */
const mark = (x0: number, y0: number, w: number, h: number): Glyph => ({ x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, area: Math.round(w * h * 0.5) });
/** A row of `n` marks `h` tall from x, `gap` apart. */
const row = (x: number, y: number, n: number, h: number, gap = h * 0.25, w = h * 0.55) => Array.from({ length: n }, (_, i) => mark(Math.round(x + i * (w + gap)), y, Math.round(w), h));

describe('a plate found by its characters (v0.32)', () => {
  it('finds dark marks on a light ground, by the light around them, and joins their points', () => {
    const W = 60;
    const H = 40;
    const Y = new Float32Array(W * H).fill(200);
    // Two dark strokes on a light plate, the left half of the photo in shade.
    for (let y = 0; y < H; y++) for (let x = 0; x < 30; x++) Y[y * W + x] = 120;
    for (let y = 12; y < 28; y++) for (const x of [10, 11, 12, 40, 41, 42]) Y[y * W + x] = x < 30 ? 40 : 90;
    const ink = inkOf(Y, W, H, 6);
    // The shade's own edge is a blot, not a character.
    const gs = glyphsOf(ink, W, H).filter((g) => charLike(g, H, 10));
    expect(gs.map((g) => [g.x0, g.x1])).toEqual([
      [10, 12],
      [40, 42],
    ]);
  });

  it('a character is not a speck, a stripe or a blot', () => {
    expect(charLike(mark(0, 0, 12, 24), 400)).toBe(true);
    expect(charLike({ ...mark(0, 0, 3, 24), area: 60 }, 400)).toBe(true); // a «1»
    expect(charLike(mark(0, 0, 4, 4), 400)).toBe(false);
    expect(charLike(mark(0, 0, 80, 20), 400)).toBe(false);
    expect(charLike({ ...mark(0, 0, 20, 24), area: 480 }, 400)).toBe(false);
  });

  it('the number is the row of large even marks — not a long row of small letters, nor a pair', () => {
    const number = row(300, 500, 5, 60);
    const dealer = row(200, 600, 14, 14);
    const pair = row(100, 100, 2, 30);
    const rows = rowsOf([...dealer, ...number, ...pair]);
    expect(rows[0].glyphs).toHaveLength(5);
    expect(rows[0].h).toBe(60);
    expect(rows.some((r) => r.glyphs.length === 14)).toBe(false);
  });

  it('a slanted plate is still one row, its slope by the marks’ feet', () => {
    const slanted = row(100, 200, 5, 50).map((g, i) => ({ ...g, y0: g.y0 + i * 6, y1: g.y1 + i * 6 }));
    const [r] = rowsOf(slanted);
    expect(r.glyphs).toHaveLength(5);
    expect(r.angle).toBeGreaterThan(5);
  });

  it('an older plate: the code of the number’s height before it, a wider gap apart', () => {
    const code = mark(100, 300, 30, 60);
    const digits = row(100 + 30 + 60, 300, 5, 60);
    const [r] = rowsOf([code, ...digits]);
    expect(r.glyphs).toHaveLength(6);
    const s = splitCode(r);
    expect(s.code).toEqual([code]);
    expect(s.number).toHaveLength(5);
    // Even gaps: no code split off.
    expect(splitCode(rowsOf(row(0, 0, 5, 60))[0]).code).toEqual([]);
  });

  it('a cut keeps only its characters: the border’s bars, a neighbour’s half at the edge and small words go', () => {
    const W = 120;
    const H = 60;
    // A bar across the top, three digits 30 tall, half a mark at the left edge, a small word under them.
    const ink = boxes(W, H, [[0, 2, 120, 4], [20, 15, 14, 30], [40, 15, 14, 30], [60, 15, 14, 30], [0, 15, 6, 30], [80, 50, 4, 6], [86, 50, 4, 6]]);
    const kept = keepMarks(ink, W, H, 30);
    const marks = glyphsOf(kept, W, H);
    expect(marks.map((g) => g.x0)).toEqual([20, 40, 60]);
  });

  it('leaning digits are stood upright by the shear that sharpens their columns', () => {
    const W = 80;
    const H = 40;
    // Strokes leaning right: each row up, one more to the right every second row.
    const ink = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (const x0 of [10, 40]) for (let x = 0; x < 4; x++) ink[y * W + x0 + x + Math.round((H - y) / 2)] = 1;
    const s = slantOf(ink, W, H);
    expect(s).toBeCloseTo(0.5, 1);
    const up = sheared(ink, W, H, s);
    // Upright, each stroke covers a few columns only.
    const cols = new Set<number>();
    for (let y = 0; y < H; y++) for (let x = 0; x < up.W; x++) if (up.ink[y * up.W + x]) cols.add(x);
    expect(cols.size).toBeLessThanOrEqual(12);
    expect(slantOf(boxes(W, H, [[10, 5, 5, 30], [40, 5, 5, 30]]), W, H)).toBe(0);
  });

  it('holes tell an 8 from a 9 and a 3, and only readings they allow fit', () => {
    const eight = art(['#####', '#...#', '#####', '#...#', '#####']);
    const nine = art(['#####', '#...#', '#####', '....#', '#####']);
    const three = art(['#####', '....#', '#####', '....#', '#####']);
    const row = (...cs: { ink: Uint8Array; W: number; H: number }[]) => {
      const W = cs.length * 28;
      const ink = new Uint8Array(W * 28);
      cs.forEach((c, i) => {
        for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) ink[(y + 4) * W + i * 28 + x + 4] = c.ink[y * 20 + x];
      });
      return { ink, W, H: 28 };
    };
    const r = row(nine, eight, three);
    const holes = holesOf(r.ink, r.W, r.H);
    expect(holes).toEqual([1, 2, 0]);
    expect(fitsHoles('983', holes)).toBe(true);
    expect(fitsHoles('883', holes)).toBe(false);
    expect(fitsHoles('93', holes)).toBe(false);
  });

  it('the code in a cut beside the number: one or two marks a size smaller, nearest it — not the emirate’s word', () => {
    const W = 260;
    const H = 120;
    const px = 56;
    // DUBAI (five small marks) at the top, R under it nearer the number (the cut's right side), its foot on the line at 96.
    const ink = boxes(W, H, [[40, 10, 10, 18], [54, 10, 10, 18], [68, 10, 10, 18], [82, 10, 10, 18], [96, 10, 10, 18], ...ring(150, 60, 22, 36)]);
    expect(codeWord(ink, W, H, px, 96, 'right')?.map((g) => g.x0)).toEqual([150]);
    expect(wordIn(ink, W, H, px, 'right')).toEqual({ x0: 40, y0: 10, x1: 105, y1: 27 });
    // An older plate: a B of the digits' height with a screw head on it — still the code, standing on the digits' line.
    const old = boxes(W, H, [...ring(200, 20, 30, 76), [205, 12, 8, 8]]);
    expect(codeWord(old, W, H, px, 96, 'right')?.length).toBe(1);
  });

  it('a plate’s rows are found in several ways of ink — grey digits on a silver plate in a dark frame too', () => {
    const W = 300;
    const H = 200;
    const Y = new Float32Array(W * H).fill(200);
    // A dark frame round a silver plate, grey digits on it.
    for (let y = 60; y < 140; y++) for (let x = 40; x < 260; x++) Y[y * W + x] = 50;
    for (let y = 70; y < 130; y++) for (let x = 50; x < 250; x++) Y[y * W + x] = 180;
    for (let i = 0; i < 5; i++) for (let y = 80; y < 120; y++) for (let x = 70 + i * 34; x < 70 + i * 34 + 20; x++) if (x - (70 + i * 34) < 5 || x - (70 + i * 34) > 14 || y < 85 || y > 114) Y[y * W + x] = 120;
    const [first] = plateRows(Y, W, H);
    expect(first.glyphs).toHaveLength(5);
    expect(first.h).toBe(40);
  });

  it('pieces found by runs are the pieces found point by point (8-way), in the same order, with the same labels', () => {
    // The plain way, point by point: the reference.
    const plain = (ink: Uint8Array, W: number, H: number) => {
      const seen = new Uint8Array(ink.length);
      const out: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
      for (let s = 0; s < ink.length; s++) {
        if (!ink[s] || seen[s]) continue;
        const q = [s];
        seen[s] = 1;
        const g = { x0: W, y0: H, x1: 0, y1: 0, area: 0 };
        while (q.length) {
          const i = q.pop()!;
          const x = i % W;
          const y = (i - x) / W;
          g.area++;
          g.x0 = Math.min(g.x0, x);
          g.x1 = Math.max(g.x1, x);
          g.y0 = Math.min(g.y0, y);
          g.y1 = Math.max(g.y1, y);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              const j = yy * W + xx;
              if (xx >= 0 && yy >= 0 && xx < W && yy < H && ink[j] && !seen[j]) (seen[j] = 1), q.push(j);
            }
        }
        out.push(g);
      }
      return out;
    };
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const fill of [0.2, 0.45, 0.6]) {
      const W = 61;
      const H = 47;
      const ink = new Uint8Array(W * H).map(() => (rnd() < fill ? 1 : 0));
      const labels = new Int32Array(W * H);
      const got = glyphsOf(ink, W, H, labels);
      expect(got).toEqual(plain(ink, W, H));
      // Each point of ink labelled with its piece; no other point.
      for (let i = 0; i < ink.length; i++) {
        if (!ink[i]) expect(labels[i]).toBe(0);
        else {
          const g = got[labels[i] - 1];
          const x = i % W;
          const y = (i - x) / W;
          expect(x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1).toBe(true);
        }
      }
    }
  });

  it('shapes tell where the hole is: a 9 high, a 6 low, a 0 tall; a 1 is a bar (v0.33)', () => {
    const six = art(['#####', '#....', '#####', '#...#', '#####']);
    const nine = art(['#####', '#...#', '#####', '....#', '#####']);
    const zero = art(['#####', '#...#', '#...#', '#...#', '#####']);
    const one = art(['..#..', '..#..', '..#..', '..#..', '..#..']);
    const seven = art(['#####', '....#', '...#.', '..#..', '..#..']);
    const row = (...cs: { ink: Uint8Array; W: number; H: number }[]) => {
      const W = cs.length * 28;
      const ink = new Uint8Array(W * 28);
      cs.forEach((c, i) => {
        for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) ink[(y + 4) * W + i * 28 + x + 4] = c.ink[y * 20 + x];
      });
      return { ink, W, H: 28 };
    };
    const r = row(six, nine, zero, one, seven);
    const shapes = shapesOf(r.ink, r.W, r.H);
    expect(fitsShapes('69017', shapes)).toBe(true);
    // A 6 and a 9 swapped, a 0 for a 6, a 7 for a 1: their holes or widths say no.
    expect(fitsShapes('96017', shapes)).toBe(false);
    expect(fitsShapes('09017', shapes)).toBe(false);
    expect(fitsShapes('69077', shapes)).toBe(false);
    // An 8 read where a mark has one hole high: righted to the only digit that fits — a 9.
    expect(rightedByShapes('68017', shapes)).toBe('69017');
    // Nothing wrong: nothing to right.
    expect(rightedByShapes('69017', shapes)).toBeUndefined();
  });

  it('a wide mark with no hole read as a 1: its top tells a 7 (a bar across) from an open 4 (two tips) (v0.46.1)', () => {
    const seven = art(['#####', '....#', '...#.', '..#..', '..#..']);
    const four = art(['#...#', '#...#', '#####', '....#', '....#']);
    const eight = art(['#####', '#...#', '#####', '#...#', '#####']);
    const W = 3 * 28;
    const ink = new Uint8Array(W * 28);
    [eight, seven, four].forEach((c, i) => {
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) ink[(y + 4) * W + i * 28 + x + 4] = c.ink[y * 20 + x];
    });
    const shapes = shapesOf(ink, W, 28);
    expect(shapes.map((s) => s.holes.length)).toEqual([2, 0, 0]);
    expect(shapes[1].top).toBeGreaterThanOrEqual(0.9);
    expect(shapes[2].top).toBeLessThanOrEqual(0.5);
    // V 80769's way: the 8 read as a 3, the 7 as a 1 — both put right (the 3 by its two holes, the 1 by its top).
    expect(rightedByShapes('314', shapes)).toBe('874');
    expect(rightedByShapes('311', shapes)).toBe('874');
    expect(fitsShapes('874', shapes)).toBe(true);
  });

  it('the code’s likely words come in order — a thin bar (a frame’s edge) after a letter (v0.33)', () => {
    const W = 260;
    const H = 120;
    const px = 56;
    // A bar next to the number (the cut's right side) and a letter a little further: the letter first.
    const ink = boxes(W, H, [[246, 40, 6, 50], ...ring(180, 54, 26, 40)]);
    const words = codeWords(ink, W, H, px, 96, 'right');
    expect(words[0].map((g) => g.x0)).toEqual([180]);
    expect(words.some((w) => w[0].x0 === 246)).toBe(true);
  });

  it('a photo’s rows: the quick way alone, or its shades alone (v0.33)', () => {
    const W = 300;
    const H = 200;
    const Y = new Float32Array(W * H).fill(200);
    for (let i = 0; i < 5; i++) for (let y = 80; y < 120; y++) for (let x = 70 + i * 34; x < 70 + i * 34 + 20; x++) if (x - (70 + i * 34) < 5 || x - (70 + i * 34) > 14 || y < 85 || y > 114) Y[y * W + x] = 40;
    expect(plateRows(Y, W, H, 4, 'light')[0]?.glyphs).toHaveLength(5);
    expect(plateRows(Y, W, H, 4, 'shades')[0]?.glyphs).toHaveLength(5);
  });
});
