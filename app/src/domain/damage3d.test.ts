import { describe, expect, it } from 'vitest';
import { CAR, rayOfMark, toDrawing, viewOfNormal, type P3 } from './damage3d';
import type { DamageView } from './types';

describe('a point on the 3D car', () => {
  it('belongs to the side its surface faces', () => {
    expect(viewOfNormal({ x: 0, y: 1, z: 0 })).toBe('top');
    expect(viewOfNormal({ x: 0, y: 0.8, z: 0.6 })).toBe('top'); // the bonnet, the windscreen
    // Facing forward (+z), the car's left is +x.
    expect(viewOfNormal({ x: 1, y: 0.2, z: 0.1 })).toBe('left');
    expect(viewOfNormal({ x: -0.9, y: 0, z: -0.3 })).toBe('right');
    expect(viewOfNormal({ x: 0.2, y: 0.3, z: 0.93 })).toBe('front');
    expect(viewOfNormal({ x: -0.1, y: 0.1, z: -0.99 })).toBe('rear');
  });

  it('lands where its side’s drawing has it — the wheels, the nose, the roof', () => {
    // The front wheel's middle on the left side: the drawing's front wheel (95, 140 of 400 × 200).
    const wheel = toDrawing('left', { x: 0.9, y: 0.33, z: 1.37 });
    expect(wheel.x * 400).toBeCloseTo(94, 0);
    expect(wheel.y * 200).toBeCloseTo(137, 0);
    // The right side is the left one mirrored.
    const right = toDrawing('right', { x: -0.9, y: 0.33, z: 1.37 });
    expect(right.x * 400).toBeCloseTo(405 - 94, 0);
    // From above, the front up: the nose at the drawing's top, the car's left on the left.
    expect(toDrawing('top', { x: 0, y: 1, z: CAR.length / 2 }).y * 400).toBeCloseTo(20, 5);
    expect(toDrawing('top', { x: CAR.width / 2, y: 1, z: 0 }).x * 200).toBeCloseTo(40, 5);
    // From the front, the car's right is on one's left; from the back, on one's right.
    expect(toDrawing('front', { x: -CAR.width / 2, y: 0.6, z: 2.3 }).x * 300).toBeCloseTo(40, 5);
    expect(toDrawing('rear', { x: -CAR.width / 2, y: 0.6, z: -2.3 }).x * 300).toBeCloseTo(260, 5);
    // Off the drawing: kept inside it.
    expect(toDrawing('top', { x: -9, y: 0, z: -9 })).toEqual({ x: 1, y: 1 });
  });
});

describe('a kept mark on the 3D car', () => {
  it('is found by a ray from outside its side through the very point it was tapped at', () => {
    const points: [DamageView, P3][] = [
      ['top', { x: 0.31, y: 1.44, z: -0.4 }],
      ['left', { x: 0.9, y: 0.7, z: 0.8 }],
      ['right', { x: -0.88, y: 0.55, z: -1.6 }],
      ['front', { x: -0.42, y: 0.72, z: 2.25 }],
      ['rear', { x: 0.6, y: 0.86, z: -2.25 }],
    ];
    for (const [view, p] of points) {
      const d = toDrawing(view, p);
      const { from, dir } = rayOfMark(view, d.x, d.y);
      // The ray goes straight in from outside that side…
      const outside = from.x * dir.x + from.y * dir.y + from.z * dir.z;
      expect(outside).toBeLessThan(0);
      // …and through the point: off its line by nothing.
      const t = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y + (p.z - from.z) * dir.z;
      const off = Math.hypot(from.x + dir.x * t - p.x, from.y + dir.y * t - p.y, from.z + dir.z * t - p.z);
      expect(off).toBeLessThan(1e-9);
    }
  });
});
