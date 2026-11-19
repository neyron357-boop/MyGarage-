/*
 * What a finger let go of is doing (v0.57, the Apple audit): its speed at the moment it lifts, where that speed
 * would carry the thing, and a spring that starts at that speed — so a drag and the motion after it are one move.
 * For the sheet (ui/sheetSwipe), a row's swipe (ui/swipe) and Back from the edge (ui/stack). The tab pages and the
 * tab bar have their own (Motion, ui/tabSwipe and ui/tabBar).
 */

/** The finger's last ~60 ms: its speed then, not the average of the whole drag (a slow drag ended by a flick is a flick). */
export class Velocity {
  private pts: { p: number; t: number }[] = [];
  reset(p: number, t: number) {
    this.pts = [{ p, t }];
  }
  add(p: number, t: number) {
    this.pts.push({ p, t });
    while (this.pts.length > 2 && t - this.pts[0].t > 60) this.pts.shift();
  }
  /** px per ms along the axis; 0 when the finger stood still before it lifted. */
  now(t: number): number {
    const first = this.pts[0];
    const last = this.pts[this.pts.length - 1];
    if (!first || !last || last === first) return 0;
    // Held still for a moment before lifting: no fling.
    if (t - last.t > 60) return 0;
    const dt = last.t - first.t;
    return dt > 0 ? (last.p - first.p) / dt : 0;
  }
}

/**
 * Where a fling at `v` (px/ms) comes to rest — Apple's projection from "Designing Fluid Interfaces" (UIScrollView's
 * deceleration): the target is chosen from this point, not from where the finger lifted.
 */
export function project(v: number, rate = 0.998): number {
  return (v * rate) / (1 - rate);
}

/** Past an edge the thing gives way less and less (UIScrollView's rubber band): `over` px of finger → this many. */
export function rubber(over: number, size: number, c = 0.55): number {
  const d = Math.abs(over);
  return Math.sign(over) * ((d * size * c) / (size + c * d));
}

const LINEAR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)');

/**
 * A critically damped spring (Apple's damping 1 — no bounce) from `from` to `to`, starting at the finger's speed `v`
 * (px/ms, same axis), as a WAAPI easing: `linear()` sampled from the spring, run on the compositor. `response` — the
 * spring's period in seconds (Apple's "response"). The speed is capped where the spring would pass its target (a
 * screen or a sheet must not swing past its place). Without `linear()` (Safari < 17.2) — UIKit's curve.
 */
export function springEase(from: number, to: number, v: number, response = 0.4, fallback = 'cubic-bezier(0.32, 0.72, 0, 1)'): { easing: string; ms: number } {
  const way = to - from;
  const w = (2 * Math.PI) / response;
  if (!LINEAR_OK || Math.abs(way) < 0.5) return { easing: fallback, ms: Math.round(response * 1000 * 0.9) };
  // The finger's speed in "the way per second"; past ω the spring would overshoot.
  const v0 = Math.max(-w, Math.min(w, (v * 1000) / way));
  // Offset from the target: d(t) = (−1 + (v0 − ω)·t)·e^(−ωt); progress = 1 + d.
  const at = (t: number) => 1 + (-1 + (v0 - w) * t) * Math.exp(-w * t);
  // Done within half a percent of the way (2 px of a phone's width): the tail after it is not seen, only waited for.
  let end = 0.05;
  while (end < 1.2 && Math.abs(1 - at(end)) > 0.005) end += 0.005;
  const n = 32;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) pts.push(i === n ? '1' : String(Math.round(at((end * i) / n) * 10000) / 10000));
  return { easing: `linear(${pts.join(', ')})`, ms: Math.round(end * 1000) };
}

/** The y of an element's transform right now — mid-animation too (what the eye sees, to go on from it). */
export function translateYNow(el: HTMLElement): number {
  const tr = getComputedStyle(el).transform;
  if (!tr || tr === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(tr).m42;
  } catch {
    return 0;
  }
}
