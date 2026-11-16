import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { CAR, rayOfMark, toDrawing, viewOfNormal, VIEW_ANGLES } from '../../domain/damage3d';
import type { DamageMark, DamageView } from '../../domain/types';
import { DAMAGE_COLORS } from '../DamageDiagram';

/*
 * The job card's car in 3D (three.js, loaded only with the job card): a sedan drawn from its own cross-sections —
 * no model file — so it weighs nothing and builds in a moment: the body, the glass, the roof, the wheels; and on the
 * body what a damage is told by (v0.20): the seams of the doors, the bonnet, the boot lid and the bumpers, the door
 * handles, the dark sills and wheel-arch lips, the pillars that make the glass windows, lamps shaped to the corners,
 * mirrors on their arms; a soft shadow under it. One finger turns it round (it coasts a little when let go), two
 * bring it closer or further, to the place between them, and move it (a wheel on a PC); a tap puts a damage point
 * where the finger is — kept, as before, as a side of the car and a place on that side's drawing
 * (domain/damage3d.ts). Turning, zooming or catching the car as it coasts never puts a point. The points are pins
 * over the picture, hidden when their side faces away. Drawn only when something moves.
 */

const L = CAR.length;
const W = CAR.width;
const rad = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A smooth line through (z, value) points: cubic pieces with Catmull–Rom slopes. */
function curve(points: [number, number][]): (z: number) => number {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  return (z) => {
    if (z <= p[0][0]) return p[0][1];
    if (z >= p[p.length - 1][0]) return p[p.length - 1][1];
    let i = 0;
    while (z > p[i + 1][0]) i++;
    const [z0, y0] = p[Math.max(0, i - 1)];
    const [z1, y1] = p[i];
    const [z2, y2] = p[i + 1];
    const [z3, y3] = p[Math.min(p.length - 1, i + 2)];
    const span = z2 - z1;
    const t = (z - z1) / span;
    const m1 = ((y2 - y0) / (z2 - z0 || 1)) * span;
    const m2 = ((y3 - y1) / (z3 - z1 || 1)) * span;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * y2 + (t3 - t2) * m2;
  };
}

/** The top of the body along the car: the nose, the bonnet, the waist under the windows, the boot, the tail. */
const waist = curve([
  [-2.3, 0.8],
  [-2.12, 0.95],
  [-1.6, 1.0],
  [-1.15, 0.985],
  [0, 0.965],
  [0.95, 0.945],
  [1.8, 0.875],
  [2.16, 0.8],
  [2.3, 0.66],
]);
/** The top of the glass: the windscreen, the roof, the rear window. */
const roofLine = curve([
  [-1.36, 0.99],
  [-1.16, 1.2],
  [-0.95, 1.4],
  [-0.5, 1.45],
  [0, 1.45],
  [0.35, 1.42],
  [0.64, 1.22],
  [0.96, 0.96],
]);
export const WHEEL = { r: 0.335, x: W / 2 - 0.135, zs: [1.37, -1.38] };
const ARCH = 0.43;

/** The body's half-width along the car: square in the middle, rounded at the nose and the tail. */
const halfWidth = (z: number) => (W / 2) * Math.pow(1 - Math.pow(Math.min(1, Math.abs((2 * z) / L)), 6), 1 / 6);
/** The bottom of the body: the sills, lifted at the bumpers, and the arches over the wheels. */
function underside(z: number): number {
  const end = Math.max(0, (Math.abs(z) - 1.95) / 0.35);
  let y = 0.24 + 0.14 * end * end;
  for (const zw of WHEEL.zs) {
    const d = z - zw;
    if (Math.abs(d) < ARCH) y = Math.max(y, WHEEL.r + Math.sqrt(ARCH * ARCH - d * d) * 0.95);
  }
  return y;
}

type Ring = number[][];
/** A surface of the car: the point (x, y) of its cross-section at `z`, at the angle `s` round it. */
type Surface = (z: number, s: number) => [number, number];

const E = 2 / 5;
/** The body's height at `z`: its bottom, top, middle and half-height. */
function heights(z: number) {
  const yb = underside(z);
  const yt = Math.max(yb + 0.06, waist(z));
  return { yc: (yb + yt) / 2, hh: (yt - yb) / 2 };
}

/**
 * The body's skin: its cross-section at `z` — a rounded box, a little narrower at the shoulder — at the angle `s`
 * round it: 0 the car's left side halfway up, π/2 the top, π its right side, −π/2 underneath.
 */
/** The cross-section's sizes at a few z's just asked for (a patch asks the same z for each of its rows). */
const sizes: { z: number; hw: number; yc: number; hh: number }[] = [];
function sizeAt(z: number) {
  for (const k of sizes) if (k.z === z) return k;
  const { yc, hh } = heights(z);
  const k = { z, hw: Math.max(0.04, halfWidth(z)), yc, hh };
  sizes.unshift(k);
  if (sizes.length > 6) sizes.pop();
  return k;
}
const skin: Surface = (z, s) => {
  const { hw, yc, hh } = sizeAt(z);
  const c = Math.cos(s);
  const sn = Math.sin(s);
  const shoulder = 1 - 0.07 * Math.pow(Math.max(0, sn), E);
  return [hw * shoulder * Math.sign(c) * Math.pow(Math.abs(c), E), yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), E)];
};

/** The angle round the skin at height `y` on the car's left side at `z` (its right side: π − that). */
function sAtHeight(z: number, y: number): number {
  const { yc, hh } = heights(z);
  const t = clamp((y - yc) / hh, -1, 1);
  return Math.asin(Math.sign(t) * Math.pow(Math.abs(t), 1 / E));
}

/** The glass at `z`: an arch from the waist up to the roof line, narrower at the top (`s` 0 — its left foot, π — its right). */
function glassAt(lift: number): Surface {
  return (z, s) => {
    const hwb = Math.max(0.05, halfWidth(z) - 0.12);
    const hwt = Math.max(0.04, hwb - 0.16);
    const yb = waist(z) - 0.03;
    const h = Math.max(0.01, roofLine(z) - yb);
    const c = Math.cos(s);
    const up = Math.pow(Math.max(0, Math.sin(s)), 0.5);
    const hws = (hwb + (hwt - hwb) * up) * (1 + lift / 2);
    return [hws * Math.sign(c) * Math.pow(Math.abs(c), 0.5), yb + h * up + lift];
  };
}
const glass0 = glassAt(0);

/** A cross-section: `m` points round a surface at `z` (closed, from 0 round to 2π) or `k` + 1 from `from` to `to`. */
const ringOf = (f: Surface, z: number, m: number): Ring => Array.from({ length: m }, (_, j) => [...f(z, (j / m) * Math.PI * 2), z]);
const archOf = (f: Surface, z: number, k: number, from = 0, to = Math.PI): Ring => Array.from({ length: k + 1 }, (_, j) => [...f(z, from + ((to - from) * j) / k), z]);

const pointOn = (f: Surface, z: number, s: number) => {
  const [x, y] = f(z, s);
  return new Vector3(x, y, z);
};
/** The outward normal of a surface at (z, s). */
function normalOn(f: Surface, z: number, s: number): Vector3 {
  const e = 1e-3;
  const [xz1, yz1] = f(z + e, s);
  const [xz0, yz0] = f(z - e, s);
  const [xs1, ys1] = f(z, s + e);
  const [xs0, ys0] = f(z, s - e);
  // (ds) × (dz), dz = (Δx, Δy, 2e), ds = (Δx, Δy, 0).
  const dzx = xz1 - xz0;
  const dzy = yz1 - yz0;
  const dsx = xs1 - xs0;
  const dsy = ys1 - ys0;
  const n = new Vector3(dsy * 2 * e, -dsx * 2 * e, dsx * dzy - dsy * dzx);
  return n.lengthSq() > 1e-20 ? n.normalize() : new Vector3(Math.sign(Math.cos(s)) || 1, 0, 0);
}

/** A surface through rings (one cross-section each, the same number of points), faces outward; `closed` — each ring round. */
function loft(rings: Ring[], closed: boolean, caps = false): BufferGeometry {
  const n = rings.length;
  const m = rings[0].length;
  const pos: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const idx: number[] = [];
  const cols = closed ? m : m - 1;
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + j;
      const d = (i + 1) * m + ((j + 1) % m);
      idx.push(a, b, c, b, d, c);
    }
  if (caps)
    for (const [ring, outward] of [
      [rings[0], -1],
      [rings[n - 1], 1],
    ] as const) {
      // A cap of its own points (its edge sharp, not smoothed into the sides).
      const base = pos.length / 3;
      const cx = ring.reduce((s, p) => s + p[0], 0) / m;
      const cy = ring.reduce((s, p) => s + p[1], 0) / m;
      pos.push(cx, cy, ring[0][2]);
      for (const p of ring) pos.push(p[0], p[1], p[2]);
      for (let j = 0; j < m; j++) {
        const p = base + 1 + j;
        const q = base + 1 + ((j + 1) % m);
        if (outward > 0) idx.push(base, p, q);
        else idx.push(base, q, p);
      }
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Stations along a length, closer together at its ends (where its shape turns fastest). */
function stations(from: number, to: number, count: number, ease = true): number[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return from + (to - from) * (ease ? 0.5 - 0.5 * Math.cos(Math.PI * t) : t);
  });
}

/** How far the details lie off the surface they are on (and are drawn over it). */
const LIFT = 0.0025;

/**
 * A surface as it is drawn: its formula, and where its flat pieces meet — the stations along the car and the angles
 * of the points round each cross-section. What lies on it bends at each such ridge as well: laid straight across
 * one, it would dip under the paint there (the line of a seam broken in the middle of a door).
 */
interface Faceted {
  f: Surface;
  zs: number[];
  ss: number[];
  /** The angles go round a closed cross-section. */
  period?: number;
}

/** Where the ridges of a list lie between a and b (not at them): as `t`, 0 at a, 1 at b. */
function crossings(a: number, b: number, ridges: number[], period?: number): number[] {
  if (a === b) return [];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const ts: number[] = [];
  for (const r of ridges) {
    const first = period ? r + Math.ceil((lo - r) / period) * period : r;
    for (let v = first; v < hi; v += period ?? Infinity) if (v > lo + 1e-9) ts.push((v - a) / (b - a));
  }
  return ts;
}

/** A line of (z, s) with a point put in wherever it crosses a ridge of the surface. */
function refine(sk: Faceted, line: [number, number][]): [number, number][] {
  const out: [number, number][] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [z0, s0] = line[i - 1];
    const [z1, s1] = line[i];
    const ts = [...crossings(z0, z1, sk.zs), ...crossings(s0, s1, sk.ss, sk.period)].filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x - y);
    for (const t of ts) out.push([lerp(z0, z1, t), lerp(s0, s1, t)]);
    out.push(line[i]);
  }
  return out;
}

/** Values from a to b at most `step` apart, the ridges between them among them. */
function spans(a: number, b: number, step: number, ridges: number[], period?: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / step));
  const ts = [...Array.from({ length: n + 1 }, (_, i) => i / n), ...crossings(a, b, ridges, period)].sort((x, y) => x - y);
  return ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-6).map((t) => lerp(a, b, t));
}

/**
 * Details lying on the car's surfaces — seams, trims, lamps — gathered into one geometry per material (one draw
 * each): strips along lines and patches of a surface, each lifted a little off it along its normal.
 */
function skinLayer() {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const put = (p: Vector3, n: Vector3, lift: number) => {
    pos.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
    nor.push(n.x, n.y, n.z);
  };
  return {
    /** A strip `width` wide along a line of (z, s) on a surface. */
    strip(sk: Faceted, line: [number, number][], width: number, lift = LIFT) {
      const at = refine(sk, line);
      const pts = at.map(([z, s]) => pointOn(sk.f, z, s));
      const ns = at.map(([z, s]) => normalOn(sk.f, z, s));
      const base = pos.length / 3;
      const t = new Vector3();
      const side = new Vector3();
      for (let i = 0; i < pts.length; i++) {
        t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
        side.crossVectors(ns[i], t).normalize().multiplyScalar(width / 2);
        put(pts[i].clone().add(side), ns[i], lift);
        put(pts[i].clone().sub(side), ns[i], lift);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const l = base + i * 2;
        idx.push(l, l + 1, l + 2, l + 1, l + 3, l + 2);
      }
    },
    /** A patch of a surface: a column at each z of `zs`, each of the angles `rows(z)` — as many in every column. */
    patch(sk: Faceted, zs: number[], rows: (z: number) => number[], lift = LIFT) {
      const base = pos.length / 3;
      const cols = zs.map(rows);
      const nv = cols[0].length;
      zs.forEach((z, i) => cols[i].forEach((s) => put(pointOn(sk.f, z, s), normalOn(sk.f, z, s), lift)));
      // Faces outward: the winding is checked against the normal in the middle.
      const i0 = Math.floor((zs.length - 1) / 2);
      const j0 = Math.floor((nv - 1) / 2);
      const pm = pointOn(sk.f, zs[i0], cols[i0][j0]);
      const du = pointOn(sk.f, zs[i0 + 1], cols[i0 + 1][j0]).sub(pm);
      const dv = pointOn(sk.f, zs[i0], cols[i0][j0 + 1]).sub(pm);
      const flip = new Vector3().crossVectors(du, dv).dot(normalOn(sk.f, zs[i0], cols[i0][j0])) < 0;
      for (let i = 0; i < zs.length - 1; i++)
        for (let j = 0; j < nv - 1; j++) {
          const a = base + i * nv + j;
          const b = a + nv;
          if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
          else idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    },
    geometry(): BufferGeometry {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      return g;
    },
  };
}

/** Points along a line: `n` + 1 of them, t from 0 to 1. */
const along = (n: number, fn: (t: number) => [number, number]): [number, number][] => Array.from({ length: n + 1 }, (_, i) => fn(i / n));

/** A tyre: a rounded ring turned about its axle (along x). */
function tyre(): BufferGeometry {
  const rIn = 0.215;
  const rOut = WHEEL.r;
  const w = 0.115;
  const c = 0.05;
  const pts: Vector2[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 5; k++) {
      const a = a0 + (k / 5) * (Math.PI / 2);
      pts.push(new Vector2(cx + c * Math.cos(a), cy + c * Math.sin(a)));
    }
  };
  pts.push(new Vector2(rIn, -w));
  corner(rOut - c, -w + c, -Math.PI / 2);
  corner(rOut - c, w - c, 0);
  pts.push(new Vector2(rIn, w));
  const g = new LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** The soft shadow under the car: a blurred dark patch on the ground. */
function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 2, 0, 0);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.42)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.26)');
  grd.addColorStop(0.85, 'rgba(0,0,0,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * The car itself: meshes in one group, and those a tap can land on; `details` adds what lies on the body (seams, trims,
 * lamps, handles, mirrors) — done after the car is first drawn, so the job card opens as quickly as without them.
 */
function buildCar(): { car: Group; touchable: Object3D[]; details: () => void; dispose: () => void } {
  const car = new Group();
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const mat = <M extends Material>(m: M) => (mats.push(m), m);
  const geo = <G extends BufferGeometry>(g: G) => (geos.push(g), g);
  const paint = mat(new MeshPhongMaterial({ color: 0xe9ecef, specular: 0x9aa1a9, shininess: 80 }));
  const glass = mat(new MeshPhongMaterial({ color: 0x263240, specular: 0xb8c4d0, shininess: 120 }));
  const rubber = mat(new MeshLambertMaterial({ color: 0x25272a, side: DoubleSide }));
  const metal = mat(new MeshPhongMaterial({ color: 0xc9cdd3, specular: 0xffffff, shininess: 90 }));
  const trim = mat(new MeshPhongMaterial({ color: 0x2c3036, specular: 0x555555, shininess: 40 }));
  const plate = mat(new MeshLambertMaterial({ color: 0xffffff }));
  const touchable: Object3D[] = [];
  const add = (g: BufferGeometry, m: Material, at?: [number, number, number], touch = true) => {
    const mesh = new Mesh(geo(g), m);
    if (at) mesh.position.set(...at);
    car.add(mesh);
    if (touch) touchable.push(mesh);
    return mesh;
  };

  const zEnd = (L / 2) * 0.997;
  // The body and the glass as drawn (their stations and the points round them): what lies on them follows that.
  const BODY: Faceted = { f: skin, zs: stations(-zEnd, zEnd, 110), ss: Array.from({ length: 44 }, (_, j) => (j / 44) * Math.PI * 2), period: Math.PI * 2 };
  const GLASS: Faceted = { f: glass0, zs: stations(-1.36, 0.96, 60, false), ss: Array.from({ length: 27 }, (_, j) => (Math.PI * j) / 26) };
  add(
    loft(
      BODY.zs.map((z) => ringOf(skin, z, BODY.ss.length)),
      true,
      true,
    ),
    paint,
  );
  add(
    loft(
      GLASS.zs.map((z) => archOf(glass0, z, GLASS.ss.length - 1)),
      false,
    ),
    glass,
  );
  // The roof: the top of the glass between the windscreen and the rear window, in the car's colour, lying on it.
  add(
    loft(
      stations(-0.96, 0.37, 30, false).map((z) => archOf(glassAt(0.008), z, 18, Math.PI / 2 - 1.02, Math.PI / 2 + 1.02)),
      false,
    ),
    paint,
  );

  /* What a damage is told by: panels, their seams, trims, lamps. */
  const details = () => {
    // What lies on the surfaces is drawn over them (and lifted a little off them).
    const over = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const seamInk = mat(new MeshBasicMaterial({ color: 0x3a4048, ...over }));
    const trimOn = mat(new MeshPhongMaterial({ color: 0x2c3036, specular: 0x555555, shininess: 40, ...over }));
    const paintOn = mat(new MeshPhongMaterial({ color: 0xe9ecef, specular: 0x9aa1a9, shininess: 80, ...over }));
    const lampOn = mat(new MeshPhongMaterial({ color: 0x4f5964, specular: 0xffffff, shininess: 150, ...over }));
    const lensOn = mat(new MeshPhongMaterial({ color: 0xe4ebf2, emissive: 0x58636f, specular: 0xffffff, shininess: 150, ...over }));
    const tailOn = mat(new MeshPhongMaterial({ color: 0xe03131, emissive: 0x4a0b0b, specular: 0xffffff, shininess: 100, ...over }));
    const seams = skinLayer();
    const trims = skinLayer();
    const pillars = skinLayer();
    const heads = skinLayer();
    const lenses = skinLayer();
    const tails = skinLayer();
    const SEAM = 0.008;
    const handleGeo = geo(new SphereGeometry(1, 14, 8).scale(0.014, 0.017, 0.07));
    const mirrorGeo = geo(new SphereGeometry(1, 18, 12).scale(0.055, 0.06, 0.1));
    const mirrorGlassGeo = geo(new SphereGeometry(1, 14, 8).scale(0.045, 0.048, 0.012));
    const armGeo = geo(new BoxGeometry(0.13, 0.03, 0.06));
    for (const side of [1, -1]) {
      // The same place on either side: the right side is the left one mirrored.
      const S = (s: number) => (side > 0 ? s : Math.PI - s);
      const seam = (line: [number, number][]) => seams.strip(BODY, line.map(([z, s]) => [z, S(s)]), SEAM);
      // The doors: the front one's front edge (the wing before it), the line between them, the rear one's back edge.
      for (const z of [0.93, -0.02, -0.93]) seam(along(16, (t) => [z, lerp(-0.7, 0.62, t)]));
      // … and the pillar between them, up the glass.
      trims.patch(GLASS, spans(0.035, -0.075, 0.05, GLASS.zs), () => spans(S(0), S(0.6), 0.1, GLASS.ss), 0.003);
      // The bonnet and the boot lid: along the wings, and across (to the middle; the other side draws the rest).
      for (const [z0, z1] of [
        [1.0, 2.12],
        [-1.4, -2.12],
      ]) {
        seam(along(24, (t) => [lerp(z0, z1, t), 0.76]));
        seam(along(10, (t) => [z0, lerp(0.76, Math.PI / 2, t)]));
        seam(along(10, (t) => [z1, lerp(0.76, Math.PI / 2, t)]));
      }
      // The bumpers: where each meets the wing and the lamps, round the nose and the tail, and down to the arch.
      for (const [y, zA, zTip] of [
        [0.575, 1.83, zEnd - 0.004],
        [0.625, -1.84, -zEnd + 0.004],
      ]) {
        seam(along(30, (t) => {
          const z = lerp(zA, zTip, t);
          return [z, sAtHeight(z, y)];
        }));
        seam(along(8, (t) => [zA, sAtHeight(zA, lerp(y, 0.34, t))]));
      }
      // The sills under the doors, arch to arch, and the lips of the wheel arches: dark, as on the car.
      // (The body's own stations and points round it give these their shape; few more are needed between them.)
      const lower = (s0: number, s1: number) => () => spans(S(s0), S(s1), 0.3, BODY.ss, BODY.period);
      trims.patch(BODY, spans(-0.92, 0.91, 0.3, BODY.zs), lower(-1.45, -0.7));
      for (const zw of WHEEL.zs) trims.patch(BODY, spans(zw - 0.47, zw + 0.47, 0.12, BODY.zs), lower(-1.45, -1.06));
      // The pillars of the windscreen and of the rear window, in the car's colour: the glass reads as windows.
      pillars.strip(GLASS, along(16, (t) => [lerp(0.37, 0.95, t), S(lerp(0.56, 0.05, t))]), 0.075, 0.003);
      pillars.strip(GLASS, along(16, (t) => [lerp(-0.96, -1.35, t), S(lerp(0.56, 0.05, t))]), 0.12, 0.003);
      // Lamps shaped to the corners: the headlights wrap round from the nose to the wing — a dark housing, a bright
      // lens in it — and the tail lights round the tail.
      for (const [into, z0, z1, y0, y1, lift] of [
        [heads, 2.02, 2.278, 0.612, 0.718, 0.004],
        [lenses, 2.06, 2.262, 0.632, 0.698, 0.006],
        [tails, -2.278, -2.0, 0.725, 0.83, 0.004],
      ] as const)
        into.patch(BODY, spans(z0, z1, 0.04, BODY.zs), (z) => Array.from({ length: 5 }, (_, k) => S(sAtHeight(z, lerp(y0, y1, k / 4)))), lift);
      // Door handles, near each door's back edge.
      for (const z of [0.2, -0.72]) {
        const s = S(sAtHeight(z, 0.79));
        const p = pointOn(skin, z, s).addScaledVector(normalOn(skin, z, s), 0.011);
        const h = new Mesh(handleGeo, metal);
        h.position.copy(p);
        car.add(h);
        touchable.push(h);
      }
      // Mirrors: the housing on an arm, its glass to the back.
      const parts: [BufferGeometry, Material, number, number, number][] = [
        [mirrorGeo, paint, side * 0.965, 1.0, 0.72],
        [armGeo, trim, side * 0.865, 0.968, 0.75],
        [mirrorGlassGeo, glass, side * 0.968, 1.0, 0.622],
      ];
      for (const [g, m, x, y, z] of parts) {
        const mesh = new Mesh(g, m);
        mesh.position.set(x, y, z);
        car.add(mesh);
        touchable.push(mesh);
      }
    }
    add(seams.geometry(), seamInk);
    add(trims.geometry(), trimOn);
    add(pillars.geometry(), paintOn);
    add(heads.geometry(), lampOn);
    add(lenses.geometry(), lensOn);
    add(tails.geometry(), tailOn);
  };

  const tyreGeo = tyre();
  const rimGeo = new CylinderGeometry(0.205, 0.205, 0.2, 30).rotateZ(Math.PI / 2);
  const hubGeo = new CylinderGeometry(0.06, 0.06, 0.215, 16).rotateZ(Math.PI / 2);
  geos.push(tyreGeo, rimGeo, hubGeo);
  for (const z of WHEEL.zs)
    for (const side of [-1, 1]) {
      const at: [number, number, number] = [side * WHEEL.x, WHEEL.r, z];
      for (const [g, m] of [
        [tyreGeo, rubber],
        [rimGeo, metal],
        [hubGeo, trim],
      ] as const) {
        const mesh = new Mesh(g, m);
        mesh.position.set(...at);
        car.add(mesh);
        touchable.push(mesh);
      }
    }
  // The grille and the plates.
  add(new BoxGeometry(0.6, 0.12, 0.06), trim, [0, 0.53, 2.268]);
  add(new BoxGeometry(0.5, 0.11, 0.02), plate, [0, 0.42, 2.305]);
  add(new BoxGeometry(0.5, 0.11, 0.02), plate, [0, 0.6, -2.305]);
  const tex = shadowTexture();
  const shadow = new Mesh(geo(new PlaneGeometry(2.6, 5.6)), mat(new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  shadow.renderOrder = -1;
  car.add(shadow);
  return {
    car,
    touchable,
    details,
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      tex.dispose();
    },
  };
}

/** Whether this device draws WebGL at all (else the job card keeps its drawings). */
export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export type CarView = DamageView | '3d';

export interface CarScene {
  /** The points on the car (the picked one stands out). */
  setMarks(marks: DamageMark[], picked: string | null): void;
  /** Turn to a side (or the three-quarter view), the whole car in sight; smoothly unless `now`. */
  turnTo(view: CarView, now?: boolean): void;
  /** Turn to face a point. */
  face(mark: DamageMark): void;
  /** Back to the whole car (from close up), the side it is turned to kept. */
  resetZoom(): void;
  dispose(): void;
}

interface Anchor {
  key: string;
  point: Vector3;
  normal: Vector3;
}

/** Where the camera is: turned round the car, raised, how close (1 — the whole car), and the point it looks at. */
interface Pose {
  turn: number;
  rise: number;
  zoom: number;
  target: Vector3;
}

/** The point the camera looks at when the whole car is in sight. */
const CENTER = new Vector3(0, 0.62, 0);
const ZOOM_MAX = 5;

/**
 * The 3D car in `host` (its canvas and the points' pins go in there): a tap on the car — `onTap` with the side and
 * the place on its drawing (not when `locked`); a tap on a pin — `onPick`; a turn by the finger — `onTurn`; close up
 * or back to the whole car — `onZoom`.
 */
export function createCarScene(
  host: HTMLElement,
  opts: {
    onTap: (at: { view: DamageView; x: number; y: number }) => void;
    onPick: (id: string) => void;
    onTurn: () => void;
    onZoom?: (closeUp: boolean) => void;
    locked: boolean;
  },
): CarScene {
  const canvas = document.createElement('canvas');
  canvas.className = 'car3d-canvas';
  host.appendChild(canvas);
  const pinsHost = document.createElement('div');
  pinsHost.className = 'car3d-pins';
  host.appendChild(pinsHost);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.05, 80);
  const { car, touchable, details, dispose: disposeCar } = buildCar();
  // The details come right after the car is first on the screen (and the points are found on them again).
  let detailed = false;
  let detailTimer = 0;
  scene.add(car);
  scene.add(new HemisphereLight(0xffffff, 0x7d8996, 1.35));
  const key = new DirectionalLight(0xffffff, 2.6);
  key.position.set(3.5, 7, 4.5);
  scene.add(key);
  const rim = new DirectionalLight(0xdfe8ff, 0.9);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  let turn = VIEW_ANGLES['3d'].turn;
  let rise = VIEW_ANGLES['3d'].rise;
  let zoom = 1;
  const target = CENTER.clone();
  let width = 1;
  let height = 1;

  // The distance that keeps the whole car in sight from this angle (its box's corners inside the picture).
  const corners = [-1, 1].flatMap((x) => [0, 1.5].flatMap((y) => [-1, 1].map((z) => new Vector3(x * 0.98, y - CENTER.y, z * 2.33))));
  const fit = (dir: Vector3) => {
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), dir).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const up = new Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan(rad(camera.fov / 2)) * 0.9;
    const tanH = tanV * camera.aspect;
    let d = 2;
    for (const c of corners) {
      const depth = c.dot(dir);
      d = Math.max(d, depth + Math.abs(c.dot(right)) / tanH, depth + Math.abs(c.dot(up)) / tanV);
    }
    return d;
  };
  const dirNow = () => {
    const t = rad(turn);
    const r = rad(rise);
    return new Vector3(Math.sin(t) * Math.cos(r), Math.sin(r), Math.cos(t) * Math.cos(r));
  };
  const place = () => {
    const dir = dirNow();
    camera.position.copy(target).addScaledVector(dir, fit(dir) / zoom);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  /** Half the picture's height, in metres, where the camera looks (at the point it looks at). */
  const halfHeight = () => (fit(dirNow()) / zoom) * Math.tan(rad(camera.fov / 2));
  const axes = () => {
    place();
    return { right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1) };
  };
  /** Close up, the camera may look at another part of the car — the closer, the further from the middle. */
  const keepNear = () => {
    const room = 1 - 1 / zoom;
    target.set(clamp(target.x, -1.0 * room, 1.0 * room), clamp(target.y, CENTER.y - 0.5 * room, CENTER.y + 0.75 * room), clamp(target.z, -2.3 * room, 2.3 * room));
  };
  let closeUp = false;
  const tellZoom = () => {
    const now = zoom > 1.03;
    if (now !== closeUp) {
      closeUp = now;
      opts.onZoom?.(now);
    }
  };
  /** Closer by `f` (further when < 1) to the place under (cx, cy): it stays under the fingers. */
  const zoomAt = (f: number, cx: number, cy: number) => {
    const next = clamp(zoom * f, 1, ZOOM_MAX);
    if (next === zoom) return;
    const r = canvas.getBoundingClientRect();
    const nx = ((cx - r.left) / Math.max(1, r.width)) * 2 - 1;
    const ny = 1 - ((cy - r.top) / Math.max(1, r.height)) * 2;
    const { right, up } = axes();
    const h = halfHeight();
    const h2 = (h * zoom) / next;
    target.addScaledVector(right, nx * camera.aspect * (h - h2)).addScaledVector(up, ny * (h - h2));
    zoom = next;
    if (zoom <= 1) target.copy(CENTER);
    keepNear();
    tellZoom();
  };
  /** Moved with the fingers (pixels): the car follows them. */
  const panBy = (dx: number, dy: number) => {
    if (zoom <= 1) return;
    const { right, up } = axes();
    const k = (2 * halfHeight()) / Math.max(1, height);
    target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    keepNear();
  };

  /* The pins of the points: placed over the picture every frame, hidden when their side faces away. */
  const raycaster = new Raycaster();
  let marks: DamageMark[] = [];
  let picked: string | null = null;
  const anchors = new Map<string, Anchor>();
  const pins = new Map<string, HTMLButtonElement>();
  const anchorOf = (m: DamageMark): Anchor => {
    const key = `${m.view}:${m.x}:${m.y}`;
    const known = anchors.get(m.id);
    if (known?.key === key) return known;
    let found: Anchor | undefined;
    // Its ray from outside its side; a mark just off the car's outline (the drawings are drawings) is drawn in a little.
    for (let k = 0; k <= 6 && !found; k++) {
      const f = k * 0.12;
      const { from, dir } = rayOfMark(m.view, m.x + (0.5 - m.x) * f, m.y + (0.5 - m.y) * f);
      raycaster.set(new Vector3(from.x, from.y, from.z), new Vector3(dir.x, dir.y, dir.z));
      const hit = raycaster.intersectObjects(touchable, false)[0];
      if (hit?.face) found = { key, point: hit.point.clone(), normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld) };
    }
    if (!found) {
      const { from, dir } = rayOfMark(m.view, m.x, m.y);
      found = { key, point: new Vector3(from.x + dir.x * 5, from.y + dir.y * 5, from.z + dir.z * 5), normal: new Vector3(-dir.x, -dir.y, -dir.z) };
    }
    anchors.set(m.id, found);
    return found;
  };
  const toEye = new Vector3();
  const projected = new Vector3();
  const placePins = () => {
    marks.forEach((m) => {
      const pin = pins.get(m.id);
      if (!pin) return;
      const a = anchorOf(m);
      toEye.copy(camera.position).sub(a.point).normalize();
      const facing = a.normal.dot(toEye) > 0.08;
      projected.copy(a.point).project(camera);
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      pin.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      pin.style.opacity = facing ? '1' : '0';
      pin.style.pointerEvents = facing ? 'auto' : 'none';
    });
  };

  /* Drawing: one frame when asked; frames on while a move eases or the car coasts. */
  let frame = 0;
  let tween: { from: Pose; to: Pose; t0: number; ms: number } | null = null;
  let coast: { vt: number; vr: number; last: number } | null = null;
  const draw = (now: number) => {
    frame = 0;
    let more = false;
    if (tween) {
      const k = Math.min(1, (now - tween.t0) / tween.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      turn = lerp(tween.from.turn, tween.to.turn, e);
      rise = lerp(tween.from.rise, tween.to.rise, e);
      zoom = lerp(tween.from.zoom, tween.to.zoom, e);
      target.lerpVectors(tween.from.target, tween.to.target, e);
      tellZoom();
      if (k < 1) more = true;
      else tween = null;
    } else if (coast) {
      const dt = Math.min(48, now - coast.last);
      coast.last = now;
      turn += coast.vt * dt;
      rise = clamp(rise + coast.vr * dt, 2, 89);
      const fade = Math.pow(0.9935, dt);
      coast.vt *= fade;
      coast.vr *= fade;
      if (Math.abs(coast.vt) + Math.abs(coast.vr) > 0.004) more = true;
      else coast = null;
    }
    place();
    renderer.render(scene, camera);
    placePins();
    if (!detailed) {
      detailed = true;
      detailTimer = window.setTimeout(() => {
        details();
        anchors.clear();
        request();
      }, 0);
    }
    if (more) frame = requestAnimationFrame(draw);
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  /** Ease to a pose (the turn the short way round). */
  const easeTo = (to: Omit<Pose, 'target'> & { target?: Vector3 }) => {
    let goal = to.turn;
    while (goal - turn > 180) goal -= 360;
    while (goal - turn < -180) goal += 360;
    coast = null;
    tween = { from: { turn, rise, zoom, target: target.clone() }, to: { turn: goal, rise: to.rise, zoom: to.zoom, target: (to.target ?? CENTER).clone() }, t0: performance.now(), ms: 520 };
    request();
  };

  const resize = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    request();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  /*
   * The fingers. One: a drag turns the car round (and over, from the side to above); a tap — short, still, the car
   * standing — puts a point. Two: closer or further, to the place between them, and moved along with them; the
   * gesture puts no point, nor does the finger left on the glass after it (it turns the car from where it is).
   */
  const fingers = new Map<number, { x: number; y: number }>();
  let press: { id: number; x0: number; y0: number; x: number; y: number; t0: number; moved: boolean; tap: boolean; v: [number, number, number][] } | null = null;
  let pinch: { d: number; mx: number; my: number } | null = null;
  let wheelEnd = 0;
  const two = () => {
    const [a, b] = [...fingers.values()];
    return { d: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  /** Let go a hair away from the whole car: back to it. */
  const settle = () => {
    if (zoom > 1 && zoom < 1.06) easeTo({ turn, rise, zoom: 1 });
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // A touch that catches the car while it moves only stops it.
    const moving = !!(tween || coast);
    tween = null;
    coast = null;
    if (fingers.size === 1) {
      press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, tap: !moving, v: [] };
    } else if (fingers.size === 2) {
      press = null;
      pinch = two();
    }
  };
  const onMove = (e: PointerEvent) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX;
    f.y = e.clientY;
    if (pinch && fingers.size >= 2) {
      const now = two();
      zoomAt(now.d / pinch.d, now.mx, now.my);
      panBy(now.mx - pinch.mx, now.my - pinch.my);
      pinch = now;
      request();
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    press.x = e.clientX;
    press.y = e.clientY;
    if (!press.moved && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > (e.pointerType === 'mouse' ? 5 : 9)) {
      press.moved = true;
      opts.onTurn();
    }
    if (!press.moved) return;
    // Close up, the same move turns it less (the place looked at stays under the finger longer).
    const k = 1 / Math.sqrt(zoom);
    turn -= dx * 0.42 * k;
    rise = clamp(rise + dy * 0.32 * k, 2, 89);
    press.v.push([e.timeStamp, dx * k, dy * k]);
    if (press.v.length > 6) press.v.shift();
    request();
  };
  const onUp = (e: PointerEvent) => {
    if (!fingers.delete(e.pointerId)) return;
    if (pinch) {
      if (fingers.size >= 2) {
        pinch = two();
        return;
      }
      pinch = null;
      // The finger still down turns the car from where it is now — and puts no point when it lets go.
      const [rest] = [...fingers.entries()];
      press = rest ? { id: rest[0], x0: rest[1].x, y0: rest[1].y, x: rest[1].x, y: rest[1].y, t0: performance.now(), moved: true, tap: false, v: [] } : null;
      settle();
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const d = press;
    press = null;
    // Taken away by the system (a swipe of the phone's own): nothing happens.
    if (e.type === 'pointercancel') return;
    if (!d.moved) {
      if (d.tap && performance.now() - d.t0 < 700) tap(e.clientX, e.clientY);
      return;
    }
    // Let go while moving: the car coasts on a little.
    const recent = d.v.filter(([ts]) => e.timeStamp - ts < 90);
    if (recent.length >= 2) {
      const span = Math.max(16, recent[recent.length - 1][0] - recent[0][0]);
      const sx = recent.reduce((s, [, x]) => s + x, 0);
      const sy = recent.reduce((s, [, , y]) => s + y, 0);
      coast = { vt: (-sx * 0.42) / span, vr: (sy * 0.32) / span, last: performance.now() };
      request();
    }
  };
  /** A wheel (or a trackpad's pinch, which comes as a wheel with ctrl): closer or further, to the place under it. */
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    tween = null;
    coast = null;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-px * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY);
    request();
    window.clearTimeout(wheelEnd);
    wheelEnd = window.setTimeout(settle, 260);
  };
  const tap = (cx: number, cy: number) => {
    if (opts.locked) return;
    const r = canvas.getBoundingClientRect();
    place();
    raycaster.setFromCamera(new Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects(touchable, false)[0];
    if (!hit?.face) return;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const view = viewOfNormal(n);
    opts.onTap({ view, ...toDrawing(view, hit.point) });
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  // A wheel over a point's pin brings the car closer too (the pin lies over the canvas; without this the sheet scrolled).
  pinsHost.addEventListener('wheel', onWheel, { passive: false });

  const turnTo = (view: CarView, now = false) => {
    const to = VIEW_ANGLES[view];
    if (now) {
      tween = null;
      coast = null;
      turn = to.turn;
      rise = to.rise;
      zoom = 1;
      target.copy(CENTER);
      tellZoom();
      request();
    } else easeTo({ turn: to.turn, rise: to.rise, zoom: 1 });
  };

  return {
    setMarks(next, pick) {
      marks = next;
      picked = pick;
      for (const [id, pin] of pins)
        if (!next.some((m) => m.id === id)) {
          pin.remove();
          pins.delete(id);
          anchors.delete(id);
        }
      next.forEach((m, i) => {
        let pin = pins.get(m.id);
        if (!pin) {
          pin = document.createElement('button');
          pin.type = 'button';
          pin.className = 'jc-pin';
          pin.addEventListener('click', () => opts.onPick(m.id));
          pinsHost.appendChild(pin);
          pins.set(m.id, pin);
        }
        pin.textContent = String(i + 1);
        pin.style.background = DAMAGE_COLORS[m.type];
        pin.toggleAttribute('data-picked', m.id === picked);
      });
      request();
    },
    turnTo,
    face(m) {
      const a = anchorOf(m);
      const n = a.normal;
      const t = (Math.atan2(n.x, n.z) * 180) / Math.PI;
      const r = clamp((Math.asin(clamp(n.y, -1, 1)) * 180) / Math.PI + 12, 8, 80);
      easeTo({ turn: t, rise: r, zoom: 1 });
    },
    resetZoom() {
      easeTo({ turn, rise, zoom: 1 });
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.clearTimeout(wheelEnd);
      window.clearTimeout(detailTimer);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      pinsHost.removeEventListener('wheel', onWheel);
      disposeCar();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      pinsHost.remove();
    },
  };
}
