import { describe, expect, it } from 'vitest';
import { project, rubber, springEase, Velocity } from './fling';

describe('a finger let go (v0.57)', () => {
  it('its speed is the last ~60 ms, not the whole drag', () => {
    const v = new Velocity();
    v.reset(0, 0);
    // A slow drag (10 px in 500 ms) ended by a flick (60 px in 40 ms).
    for (let t = 50; t <= 500; t += 50) v.add(t / 50, t);
    v.add(40, 520);
    v.add(70, 540);
    expect(v.now(545)).toBeGreaterThan(1);
  });

  it('a finger held still before it lifts has no speed', () => {
    const v = new Velocity();
    v.reset(0, 0);
    v.add(30, 20);
    v.add(60, 40);
    expect(v.now(200)).toBe(0);
  });

  it('a fling carries on as Apple projects it; a standing finger stays', () => {
    expect(project(1)).toBeCloseTo(499, 0);
    expect(project(1, 0.99)).toBeCloseTo(99, 0);
    expect(project(0)).toBe(0);
    expect(project(-0.5)).toBeLessThan(0);
  });

  it('past an edge the thing gives way less and less, never past its size', () => {
    const a = rubber(50, 100);
    const b = rubber(100, 100);
    const c = rubber(1000, 100);
    expect(a).toBeLessThan(50);
    expect(b - a).toBeLessThan(a);
    expect(c).toBeLessThan(100);
    expect(rubber(-50, 100)).toBeCloseTo(-a, 6);
  });

  it('without linear() (here, as in Safari < 17.2) the spring falls back to the given curve', () => {
    const s = springEase(0, 300, 1, 0.4, 'ease-out');
    expect(s.easing).toBe('ease-out');
    expect(s.ms).toBeGreaterThan(200);
  });
});
