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
 * no model file — so it weighs nothing and builds in a moment: the body (bonnet, sides, boot, the arches over the
 * wheels), the glass, the roof, the wheels, lights, grille, plates and mirrors; a soft shadow under it. The finger
 * turns it round (it coasts a little when let go); a tap on it puts a damage point there — kept, as before, as a
 * side of the car and a place on that side's drawing (domain/damage3d.ts). The points are pins over the picture,
 * hidden when their side faces away. Drawn only when something moves: no frame is spent on a car standing still.
 */

const L = CAR.length;
const W = CAR.width;
const rad = (d: number) => (d * Math.PI) / 180;

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

/** The body's cross-section at `z`: a rounded box (a little narrower at the shoulder), `m` points round it. */
function bodyRing(z: number, m: number): Ring {
  const hw = Math.max(0.04, halfWidth(z));
  const yb = underside(z);
  const yt = Math.max(yb + 0.06, waist(z));
  const yc = (yb + yt) / 2;
  const hh = (yt - yb) / 2;
  const e = 2 / 5;
  const ring: Ring = [];
  for (let j = 0; j < m; j++) {
    const s = (j / m) * Math.PI * 2;
    const c = Math.cos(s);
    const sn = Math.sin(s);
    const shoulder = 1 - 0.07 * Math.pow(Math.max(0, sn), e);
    ring.push([hw * shoulder * Math.sign(c) * Math.pow(Math.abs(c), e), yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), e), z]);
  }
  return ring;
}

/** The glass at `z`: an arch from the waist up to the roof line, narrower at the top; `k` + 1 points, right to left. */
function glassArch(z: number, k: number, from = 0, to = Math.PI, lift = 0): Ring {
  const hwb = Math.max(0.05, halfWidth(z) - 0.12);
  const hwt = Math.max(0.04, hwb - 0.16);
  const yb = waist(z) - 0.03;
  const h = Math.max(0.01, roofLine(z) - yb);
  const out: Ring = [];
  for (let j = 0; j <= k; j++) {
    const s = from + ((to - from) * j) / k;
    const c = Math.cos(s);
    const up = Math.pow(Math.max(0, Math.sin(s)), 0.5);
    const hws = (hwb + (hwt - hwb) * up) * (1 + lift / 2);
    out.push([hws * Math.sign(c) * Math.pow(Math.abs(c), 0.5), yb + h * up + lift, z]);
  }
  return out;
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

/** The car itself: meshes in one group, and those a tap can land on. */
function buildCar(): { car: Group; touchable: Object3D[]; dispose: () => void } {
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
  const lamp = mat(new MeshPhongMaterial({ color: 0xc9d4e0, emissive: 0x39424d, specular: 0xffffff, shininess: 150 }));
  const tail = mat(new MeshPhongMaterial({ color: 0xe03131, emissive: 0x4a0b0b, specular: 0xffffff, shininess: 100 }));
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
  add(
    loft(
      stations(-zEnd, zEnd, 110).map((z) => bodyRing(z, 44)),
      true,
      true,
    ),
    paint,
  );
  add(
    loft(
      stations(-1.36, 0.96, 60, false).map((z) => glassArch(z, 26)),
      false,
    ),
    glass,
  );
  // The roof: the top of the glass between the windscreen and the rear window, in the car's colour, lying on it.
  add(
    loft(
      stations(-0.96, 0.37, 30, false).map((z) => glassArch(z, 18, Math.PI / 2 - 1.02, Math.PI / 2 + 1.02, 0.008)),
      false,
    ),
    paint,
  );
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
  // Lights, grille, plates, mirrors.
  for (const side of [-1, 1]) {
    add(new SphereGeometry(1, 20, 12).scale(0.17, 0.055, 0.06), lamp, [side * 0.46, 0.665, 2.262]);
    add(new SphereGeometry(1, 20, 12).scale(0.16, 0.06, 0.06), tail, [side * 0.47, 0.79, -2.262]);
    add(new SphereGeometry(1, 16, 10).scale(0.05, 0.065, 0.11), paint, [side * 0.935, 1.01, 0.7]);
  }
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
  /** Turn to a side (or the three-quarter view), smoothly unless `now`. */
  turnTo(view: CarView, now?: boolean): void;
  /** Turn to face a point. */
  face(mark: DamageMark): void;
  dispose(): void;
}

interface Anchor {
  key: string;
  point: Vector3;
  normal: Vector3;
}

/**
 * The 3D car in `host` (its canvas and the points' pins go in there): a tap on the car — `onTap` with the side and
 * the place on its drawing (not when `locked`); a tap on a pin — `onPick`; a turn by the finger — `onTurn`.
 */
export function createCarScene(
  host: HTMLElement,
  opts: { onTap: (at: { view: DamageView; x: number; y: number }) => void; onPick: (id: string) => void; onTurn: () => void; locked: boolean },
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
  const camera = new PerspectiveCamera(30, 1, 0.1, 80);
  const target = new Vector3(0, 0.62, 0);
  const { car, touchable, dispose: disposeCar } = buildCar();
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
  let width = 1;
  let height = 1;

  // The distance that keeps the whole car in sight from this angle (its box's corners inside the picture).
  const corners = [-1, 1].flatMap((x) => [0, 1.5].flatMap((y) => [-1, 1].map((z) => new Vector3(x * 0.98, y - target.y, z * 2.33))));
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
  const place = () => {
    const t = rad(turn);
    const r = rad(rise);
    const dir = new Vector3(Math.sin(t) * Math.cos(r), Math.sin(r), Math.cos(t) * Math.cos(r));
    camera.position.copy(target).addScaledVector(dir, fit(dir));
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
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

  /* Drawing: one frame when asked; frames on while a turn eases or coasts. */
  let frame = 0;
  let tween: { from: [number, number]; to: [number, number]; t0: number; ms: number } | null = null;
  let coast: { vt: number; vr: number; last: number } | null = null;
  const draw = (now: number) => {
    frame = 0;
    let more = false;
    if (tween) {
      const k = Math.min(1, (now - tween.t0) / tween.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      turn = tween.from[0] + (tween.to[0] - tween.from[0]) * e;
      rise = tween.from[1] + (tween.to[1] - tween.from[1]) * e;
      if (k < 1) more = true;
      else tween = null;
    } else if (coast) {
      const dt = Math.min(48, now - coast.last);
      coast.last = now;
      turn += coast.vt * dt;
      rise = Math.min(89, Math.max(2, rise + coast.vr * dt));
      const fade = Math.pow(0.9935, dt);
      coast.vt *= fade;
      coast.vr *= fade;
      if (Math.abs(coast.vt) + Math.abs(coast.vr) > 0.004) more = true;
      else coast = null;
    }
    place();
    renderer.render(scene, camera);
    placePins();
    if (more) frame = requestAnimationFrame(draw);
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(draw);
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

  /* The finger: a drag turns the car round (and over, from the side to above), a tap puts a point. */
  let drag: { id: number; x0: number; y0: number; x: number; y: number; t0: number; moved: boolean; v: [number, number, number][] } | null = null;
  const onDown = (e: PointerEvent) => {
    if (drag) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, v: [] };
    tween = null;
    coast = null;
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
      drag.moved = true;
      opts.onTurn();
    }
    if (!drag.moved) return;
    turn -= dx * 0.42;
    rise = Math.min(89, Math.max(2, rise + dy * 0.32));
    drag.v.push([e.timeStamp, dx, dy]);
    if (drag.v.length > 6) drag.v.shift();
    request();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (performance.now() - d.t0 < 700) tap(e.clientX, e.clientY);
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
  const tap = (cx: number, cy: number) => {
    if (opts.locked) return;
    const r = canvas.getBoundingClientRect();
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

  const turnTo = (view: CarView, now = false) => {
    const to = VIEW_ANGLES[view];
    // The short way round.
    let goal = to.turn;
    while (goal - turn > 180) goal -= 360;
    while (goal - turn < -180) goal += 360;
    coast = null;
    if (now) {
      tween = null;
      turn = goal;
      rise = to.rise;
    } else tween = { from: [turn, rise], to: [goal, to.rise], t0: performance.now(), ms: 520 };
    request();
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
      const r = Math.min(80, Math.max(8, (Math.asin(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI + 12));
      let goal = t;
      while (goal - turn > 180) goal -= 360;
      while (goal - turn < -180) goal += 360;
      coast = null;
      tween = { from: [turn, rise], to: [goal, r], t0: performance.now(), ms: 520 };
      request();
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      disposeCar();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      pinsHost.remove();
    },
  };
}
