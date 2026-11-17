import { describe, expect, it } from 'vitest';
import { vinRows } from './vinRows';

/**
 * A picture of `n` characters in a row from (`x`, `y`) at `deg`, each `h` tall, `pitch` apart — drawn as a 0 (a ring),
 * a 1 (a bar) or a C (a ring open on its right), in turn; dark on light (or light on dark), with grain all over and a
 * few blots of other sizes near the top.
 */
function picture(o: { n?: number; deg?: number; h?: number; pitch?: number; light?: boolean; x?: number; y?: number; W?: number; H?: number }) {
  const { n = 17, deg = 0, h = 24, pitch = 20, light = false, x = 60, y = 200, W = 640, H = 400 } = o;
  const ground = light ? 40 : 215;
  const ink = light ? 230 : 30;
  const Y = new Float32Array(W * H).fill(ground);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < Y.length; i++) Y[i] += (rnd() - 0.5) * 16;
  const r = (deg * Math.PI) / 180;
  const ring = (cx: number, cy: number, w: number, hh: number, turn: number, kind: 0 | 1 | 2 = 0) => {
    const reach = Math.max(w, hh);
    for (let py = Math.floor(cy - reach); py <= cy + reach; py++)
      for (let px = Math.floor(cx - reach); px <= cx + reach; px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const u = (px - cx) * Math.cos(turn) + (py - cy) * Math.sin(turn);
        const v = -(px - cx) * Math.sin(turn) + (py - cy) * Math.cos(turn);
        const e = (u / (w / 2)) ** 2 + (v / (hh / 2)) ** 2;
        const inner = (u / (w / 2 - 3)) ** 2 + (v / (hh / 2 - 3)) ** 2;
        const on = kind === 1 ? Math.abs(u) <= 2 && Math.abs(v) <= hh / 2 : e <= 1 && inner > 1 && !(kind === 2 && u > w * 0.15 && Math.abs(v) < hh * 0.2);
        if (on) Y[py * W + px] = ink;
      }
  };
  for (let k = 0; k < n; k++) ring(x + k * pitch * Math.cos(r), y + k * pitch * Math.sin(r), h * 0.62, h, r, ([0, 2, 1] as const)[k % 3]);
  // Other marks: blots of every size here and there (not a row).
  for (let k = 0; k < 12; k++) ring(40 + rnd() * (W - 80), 30 + rnd() * 80, 8 + rnd() * 30, 8 + rnd() * 30, rnd());
  return { Y, W, H };
}

describe('a VIN row found by its characters', () => {
  it('is the row of seventeen marks of one height at an even pitch — level, with its slope and middle', () => {
    const { Y, W, H } = picture({});
    const [row] = vinRows(Y, W, H);
    expect(row.glyphs.length).toBe(17);
    expect(Math.abs(row.angle)).toBeLessThan(2);
    expect(row.dark).toBe(true);
    expect(row.cx).toBeCloseTo(60 + 8 * 20, -1);
    expect(row.cy).toBeCloseTo(200, -1);
    expect(row.pitch).toBeCloseTo(20, 0);
  });

  it('is found at a slant (a phone held askew) and running up the photo (shot sideways)', () => {
    const slant = picture({ deg: 24, y: 150, x: 70, H: 460 });
    const [a] = vinRows(slant.Y, slant.W, slant.H);
    expect(a.glyphs.length).toBe(17);
    expect(a.angle).toBeGreaterThan(20);
    expect(a.angle).toBeLessThan(28);
    const up = picture({ deg: 90, x: 300, y: 20, W: 640, H: 420, pitch: 22 });
    const [b] = vinRows(up.Y, up.W, up.H);
    expect(b.glyphs.length).toBe(17);
    expect(Math.abs(Math.abs(b.angle) - 90)).toBeLessThan(4);
  });

  it('is found light on dark too (a stamped plate, white print on black)', () => {
    const { Y, W, H } = picture({ light: true });
    const [row] = vinRows(Y, W, H);
    expect(row.glyphs.length).toBe(17);
    expect(row.dark).toBe(false);
  });

  it('a short row of a few marks ranks below a VIN-long one', () => {
    const { Y, W, H } = picture({});
    // A second row of five larger marks below the VIN.
    const five = picture({ n: 5, y: 320, h: 36, pitch: 30 });
    for (let y = 290; y < 360; y++) for (let x = 0; x < W; x++) Y[y * W + x] = five.Y[y * W + x];
    const rows = vinRows(Y, W, H);
    expect(rows[0].glyphs.length).toBe(17);
  });
});
