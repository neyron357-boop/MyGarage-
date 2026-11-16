import { describe, expect, it } from 'vitest';
import { code128Modules, code39Modules, readBarcodeRow, vinOfBarcode } from './barcode';

/** A fixed pseudo-random sequence (the same rows every run). */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * A row of brightness as a camera would see a module pattern: `px` samples a module (any fraction), blurred over
 * `blur` samples, with noise, a slope of light along it, quiet margins — dark bars on light, or the other way round.
 */
function shot(modules: string, o: { px: number; blur?: number; noise?: number; slope?: number; invert?: boolean; seed?: number; dark?: number; light?: number }): number[] {
  const rnd = seeded(o.seed ?? 7);
  const quiet = 14;
  const n = Math.round((modules.length + 2 * quiet) * o.px);
  const dark = o.dark ?? 40;
  const light = o.light ?? 215;
  // Each sample is the mean of the modules it covers (a sensor's cell is not a point).
  const ideal = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const taps = 5;
    for (let k = 0; k < taps; k++) {
      const m = Math.floor((i + (k + 0.5) / taps) / o.px) - quiet;
      sum += m >= 0 && m < modules.length && modules[m] === '1' ? dark : light;
    }
    ideal[i] = sum / taps;
  }
  const r = Math.max(0, Math.round(o.blur ?? 0));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const wgt = r + 1 - Math.abs(k);
      sum += ideal[j] * wgt;
      cnt += wgt;
    }
    let v = sum / cnt + (rnd() - 0.5) * 2 * (o.noise ?? 0) + (o.slope ?? 0) * (i / n - 0.5);
    if (o.invert) v = 255 - v;
    out[i] = Math.max(0, Math.min(255, v));
  }
  return out;
}

const VIN = 'JN8AY2NY8G9156675';

describe('a barcode read off a row of brightness (v0.25)', () => {
  it('Code 39 — the VIN’s own: sharp, coarse and fine, any fraction of a sample to a module', () => {
    for (const px of [1.6, 2, 2.3, 3, 4.5, 7]) for (const ratio of [2, 2.5, 3]) expect(readBarcodeRow(shot(code39Modules(VIN, ratio), { px })), `px ${px} ratio ${ratio}`).toContain(VIN);
  });

  it('…blurred, noisy, in sloping light, dim — as a phone shoots a plate', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(readBarcodeRow(shot(code39Modules(VIN), { px: 2.2, blur: 1, noise: 10, slope: 60, seed })), `seed ${seed}`).toContain(VIN);
      expect(readBarcodeRow(shot(code39Modules(VIN), { px: 3, blur: 2, noise: 14, slope: -90, seed })), `seed ${seed} soft`).toContain(VIN);
      expect(readBarcodeRow(shot(code39Modules(VIN), { px: 2.5, blur: 1, noise: 6, dark: 90, light: 150, seed })), `seed ${seed} dim`).toContain(VIN);
    }
  });

  it('…right to left (the label upside down) and light bars on dark (an etched plate)', () => {
    expect(readBarcodeRow(shot(code39Modules(VIN), { px: 2.4, blur: 1 }).reverse())).toContain(VIN);
    expect(readBarcodeRow(shot(code39Modules(VIN), { px: 2.4, blur: 1, invert: true }))).toContain(VIN);
    expect(readBarcodeRow(shot(code39Modules(VIN), { px: 2.4, invert: true }).reverse())).toContain(VIN);
  });

  it('Code 128 — with its checksum; a symbol misread is no message at all', () => {
    for (const px of [1.6, 2, 2.6, 3, 5]) expect(readBarcodeRow(shot(code128Modules(VIN), { px, blur: px > 2 ? 1 : 0, noise: 6 })), `px ${px}`).toContain(VIN);
    expect(readBarcodeRow(shot(code128Modules('Order #1042 / K 40404'), { px: 3 }))).toContain('Order #1042 / K 40404');
    expect(readBarcodeRow(shot(code128Modules(VIN), { px: 3 }).reverse())).toContain(VIN);
    // The check symbol swapped for another: the sum no longer adds up.
    const m = code128Modules(VIN);
    const bad = m.slice(0, 11 * 18) + code128Modules('A').slice(11, 22) + m.slice(11 * 19);
    expect(readBarcodeRow(shot(bad, { px: 3 }))).toEqual([]);
  });

  it('nothing out of what is not a barcode: noise, stripes, a row of letters’ edges', () => {
    const rnd = seeded(11);
    for (let t = 0; t < 40; t++) {
      const noise = Array.from({ length: 1400 }, () => rnd() * 255);
      expect(readBarcodeRow(noise).map(vinOfBarcode).filter(Boolean)).toEqual([]);
      // Even stripes (a grille, a radiator) and uneven ones.
      const stripes = Array.from({ length: 1400 }, (_, i) => (Math.floor(i / (3 + (t % 5))) % 2 ? 40 : 210));
      expect(readBarcodeRow(stripes)).toEqual([]);
      let x = 0;
      const ragged: number[] = [];
      while (ragged.length < 1400) {
        const len = 2 + Math.floor(rnd() * 9);
        for (let k = 0; k < len; k++) ragged.push(x % 2 ? 45 : 205);
        x++;
      }
      expect(readBarcodeRow(ragged).map(vinOfBarcode).filter(Boolean)).toEqual([]);
    }
  });

  it('the VIN of a message: the 17 characters, or behind the maker’s "I" — nothing else', () => {
    expect(vinOfBarcode(VIN)).toBe(VIN);
    expect(vinOfBarcode(`I${VIN}`)).toBe(VIN);
    expect(vinOfBarcode(' jn8ay2ny8g9156675 ')).toBe(VIN);
    expect(vinOfBarcode('JN8AY2NY8G915667')).toBeUndefined();
    expect(vinOfBarcode('JN8AY2NY8G91566750')).toBeUndefined();
    expect(vinOfBarcode('JO8AY2NY8G9156675')).toBeUndefined();
    expect(vinOfBarcode('PART-NO-12345')).toBeUndefined();
  });
});
