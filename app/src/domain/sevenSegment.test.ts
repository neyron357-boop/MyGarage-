import { describe, expect, it } from 'vitest';
import { cropOf, inkAround, inkOtsu, segDigits, segRows } from './sevenSegment';

const SEG: Record<string, string> = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

/** A seven-segment number drawn into a line's points (1 — ink): segments `t` thick, `gap` apart at their ends, leaning by `lean`. */
function draw(text: string, { w = 30, h = 54, t = 6, pitch = 42, gap = 0, lean = 0, W = 400, H = 100, top = 22 } = {}) {
  const ink = new Uint8Array(W * H);
  const mid = top + h / 2;
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const xx = Math.round(x - lean * (y - mid));
        if (xx >= 0 && xx < W && y >= 0 && y < H) ink[y * W + xx] = 1;
      }
  };
  let x = 20;
  for (const ch of text) {
    if (ch === '.') {
      fill(x - pitch * 0.25, top + h - t, x - pitch * 0.25 + t, top + h);
      continue;
    }
    if (ch === ':') {
      fill(x + 4, top + h * 0.3, x + 4 + t, top + h * 0.3 + t);
      fill(x + 4, top + h * 0.65, x + 4 + t, top + h * 0.65 + t);
      x += 18;
      continue;
    }
    if (ch === ' ') {
      x += pitch;
      continue;
    }
    const s = SEG[ch];
    const g = gap;
    const hh = h / 2;
    if (s.includes('a')) fill(x + t + g, top, x + w - t - g, top + t);
    if (s.includes('b')) fill(x + w - t, top + t + g, x + w, top + hh - t / 2 - g);
    if (s.includes('c')) fill(x + w - t, top + hh + t / 2 + g, x + w, top + h - t - g);
    if (s.includes('d')) fill(x + t + g, top + h - t, x + w - t - g, top + h);
    if (s.includes('e')) fill(x, top + hh + t / 2 + g, x + t, top + h - t - g);
    if (s.includes('f')) fill(x, top + t + g, x + t, top + hh - t / 2 - g);
    if (s.includes('g')) fill(x + t + g, top + hh - t / 2, x + w - t - g, top + hh + t / 2);
    x += pitch;
  }
  return { ink, W, H };
}

const read = (d: { ink: Uint8Array; W: number; H: number }) => segDigits(d.ink, d.W, d.H);

describe('seven-segment digits (v0.44)', () => {
  it('reads an LCD odometer’s digits — every digit, its segments joined or apart', () => {
    expect(read(draw('123456'))).toBe('123456');
    expect(read(draw('0789', { gap: 2 }))).toBe('0789');
    expect(read(draw('087654', { gap: 2 }))).toBe('087654');
  });

  it('digits that lean (italic LCDs) are stood upright first', () => {
    expect(read(draw('204518', { lean: 0.18, gap: 1 }))).toBe('204518');
  });

  it('a trip meter’s tenths and a clock’s colon are told — not taken for the mileage', () => {
    expect(read(draw('345.6'))).toBe('345.6');
    expect(read(draw('10:32', { gap: 1 }))).toBe('10:32');
  });

  it('in grey with a shade across it: black and white by the light around, and by one threshold', () => {
    const { ink, W, H } = draw('5730', { gap: 2 });
    // Dark segments on a pale LCD that gets lighter to the right, with grain.
    const Y = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) Y[i] = (ink[i] ? 60 : 170 + ((i % W) / W) * 60) + (((i * 7919) % 13) - 6);
    expect(read({ ink: inkAround(Y, W, H, false, 20), W, H })).toBe('5730');
    expect(read({ ink: inkOtsu(Y, W, H, false), W, H })).toBe('5730');
    // Light digits on a dark screen.
    const L = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) L[i] = ink[i] ? 230 : 25;
    expect(read({ ink: inkOtsu(L, W, H, true), W, H })).toBe('5730');
  });

  it('on a whole dashboard: the LCD number’s row is found among the scale, the needle and the icons, and read', () => {
    const W = 900;
    const H = 600;
    // The odometer's six digits low in the middle, a little apart at their segments.
    const lcd = draw('204518', { gap: 2, W, H, top: 420 });
    const ink = lcd.ink;
    const put = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * W + x] = 1;
    };
    // A speedometer's ring, its needle, a few icons and tick marks.
    for (let a = 0; a < Math.PI * 1.5; a += 0.002) {
      const x = Math.round(450 + Math.cos(a + Math.PI * 0.75) * 200);
      const y = Math.round(250 + Math.sin(a + Math.PI * 0.75) * 200);
      if (x >= 0 && x < W && y >= 0 && y < H) for (let k = 0; k < 4; k++) ink[y * W + x + k] = 1;
    }
    for (let k = 0; k < 180; k++) put(450 + Math.round(k * 0.8), 300 - Math.round(k * 0.5), 453 + Math.round(k * 0.8), 303 - Math.round(k * 0.5));
    put(80, 60, 110, 90);
    put(800, 60, 830, 80);
    for (let i = 0; i < 10; i++) put(200 + i * 50, 160, 204, 180);
    const rows = segRows(ink, W, H);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row.digits).toBe(6);
    expect(row.y0).toBeGreaterThanOrEqual(415);
    expect(row.y1).toBeLessThanOrEqual(480);
    const crop = cropOf(ink, W, H, row, (row.y1 - row.y0) * 0.3);
    expect(segDigits(Uint8Array.from(crop.data), crop.W, crop.H)).toBe('204518');
  });

  it('nothing on the line — nothing read', () => {
    expect(segDigits(new Uint8Array(100 * 40), 100, 40)).toBe('');
  });
});
