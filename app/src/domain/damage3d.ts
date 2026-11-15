import type { DamageView } from './types';

/*
 * The job card's car in 3D (ui/car3d) and the damage marks as they are kept: a side of the car and a place on its
 * 2D drawing (ui/DamageDiagram.tsx, 0–1 of the drawing) — so the check-in act, its PDF and older marks stay as they
 * are. A point tapped on the 3D car belongs to the side its surface faces and lands where that side's drawing has
 * it; a kept mark is found on the 3D car by a ray from outside that side, straight at its place.
 *
 * The 3D car (metres; z — forward, y — up, x — the car's left: facing forward, its left hand) is drawn to the
 * drawings' proportions.
 */
export const CAR = { length: 4.6, width: 1.82, height: 1.45 } as const;

export interface P3 {
  x: number;
  y: number;
  z: number;
}

const { length: L, width: W, height: H } = CAR;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The side of the car a point on it belongs to, by which way its surface faces (`n` — its outward normal). */
export function viewOfNormal(n: P3): DamageView {
  if (n.y > 0.55) return 'top';
  if (Math.abs(n.x) >= Math.abs(n.z)) return n.x > 0 ? 'left' : 'right';
  return n.z > 0 ? 'front' : 'rear';
}

/**
 * A point on the 3D car → its place on that side's drawing. The drawings: from above, the front up (200 × 400; the
 * body 120 wide, 360 long from 20); from the sides, the front towards the car's nose (400 × 200; the body from 20 to
 * 385, the ground at 166, the roof at 38; the right side the left one mirrored about 202.5); from the front and the
 * back as one stands there (300 × 220; the body 220 wide about 150, the ground at 198, the roof at 40).
 */
export function toDrawing(view: DamageView, p: P3): { x: number; y: number } {
  const along = 20 + ((L / 2 - p.z) / L) * 365;
  const side = (166 - (p.y / H) * 128) / 200;
  const end = (198 - (p.y / H) * 158) / 220;
  switch (view) {
    case 'top':
      // From above, the front up: the car's left on the left.
      return { x: clamp01((40 + ((W / 2 - p.x) / W) * 120) / 200), y: clamp01((20 + ((L / 2 - p.z) / L) * 360) / 400) };
    case 'left':
      return { x: clamp01(along / 400), y: clamp01(side) };
    case 'right':
      return { x: clamp01((405 - along) / 400), y: clamp01(side) };
    case 'front':
      // Standing in front of the car, its right is on one's left.
      return { x: clamp01((150 + (p.x / (W / 2)) * 110) / 300), y: clamp01(end) };
    case 'rear':
      return { x: clamp01((150 - (p.x / (W / 2)) * 110) / 300), y: clamp01(end) };
  }
}

/** A mark kept on a side's drawing → the ray that finds it on the 3D car: from outside that side, straight at it. */
export function rayOfMark(view: DamageView, x: number, y: number): { from: P3; dir: P3 } {
  const far = 6;
  const sideY = ((166 - y * 200) / 128) * H;
  const endY = ((198 - y * 220) / 158) * H;
  const zAlong = (u: number) => L / 2 - ((u - 20) / 365) * L;
  switch (view) {
    case 'top':
      return { from: { x: W / 2 - ((x * 200 - 40) / 120) * W, y: far, z: L / 2 - ((y * 400 - 20) / 360) * L }, dir: { x: 0, y: -1, z: 0 } };
    case 'left':
      return { from: { x: far, y: sideY, z: zAlong(x * 400) }, dir: { x: -1, y: 0, z: 0 } };
    case 'right':
      return { from: { x: -far, y: sideY, z: zAlong(405 - x * 400) }, dir: { x: 1, y: 0, z: 0 } };
    case 'front':
      return { from: { x: ((x * 300 - 150) / 110) * (W / 2), y: endY, z: far }, dir: { x: 0, y: 0, z: -1 } };
    case 'rear':
      return { from: { x: ((150 - x * 300) / 110) * (W / 2), y: endY, z: -far }, dir: { x: 0, y: 0, z: 1 } };
  }
}

/** Where the camera looks from to face a side (degrees: `turn` about the car from its front towards its left, `rise` above the ground). */
export const VIEW_ANGLES: Record<DamageView | '3d', { turn: number; rise: number }> = {
  '3d': { turn: 38, rise: 24 },
  top: { turn: 180, rise: 89 },
  left: { turn: 90, rise: 6 },
  right: { turn: -90, rise: 6 },
  front: { turn: 0, rise: 6 },
  rear: { turn: 180, rise: 6 },
};
