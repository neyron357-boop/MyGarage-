import { useCallback, useEffect, useRef } from 'react';
import { animate, spring, type AnimationPlaybackControls } from 'motion';
import { haptic } from './haptics';

/** Things that take a sideways drag themselves: the tab swipe leaves them alone. */
const OWN_SWIPE =
  '.chip-row:not(.wrap), .scroll-tabs, .today-strip, .swipe-row, .note-swipe, .kanban, .strip-row, [data-sort-id], input, textarea, select, [role="slider"], video, audio, [controls]';
/** The strip along the left edge belongs to "Back" (ui/stack). */
const EDGE = 28;
/** A touch becomes a drag after 8 px; sideways only when the first move is clearly sideways. */
const SLOP = 8;
/** Let go past 40 % of the width — or flung that way — and the next tab opens. */
const COMMIT = 0.4;
/** px per ms; and a fling has to be a real move, not a twitch. */
const FLING = 0.4;
const FLING_MIN = 24;
/** The screen scrolled this far under a sideways drag: it was a scroll after all. */
const SCROLL_WINS = 12;

/**
 * The springs that take the finger's speed are physical (stiffness, damping): Motion ignores the velocity of a
 * spring given by its duration. These are the critically damped ones a duration would give (Motion's own
 * conversion): `visualDuration` 0.34 s for a page let go after a drag and 0.24 s for a change of mind, back
 * home quickly. No bounce: a page does not swing past its place (the gap to the next page would open at the
 * edge) — the exception to "a slight bounce after a drag" (AGENTS.md).
 */
const PAGE = { type: 'spring', stiffness: 237.2, damping: 30.8, mass: 1 } as const;
const SNAP = { type: 'spring', stiffness: 476, damping: 43.63, mass: 1 } as const;
/** A tap on a tab: the page comes in from its side, softly — no force behind it. */
const TAP = { type: 'spring', visualDuration: 0.3, bounce: 0 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Reduce Motion: no spring, a short plain settle. */
const PLAIN = { duration: 0.18, ease: EASE_OUT } as const;

const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const reduced = () => reduceQuery?.matches === true;

/** Past the first or the last tab the page gives way less and less (UIScrollView's rubber band). */
function rubber(over: number, size: number): number {
  const d = Math.abs(over);
  return Math.sign(over) * (1 - 1 / ((d * 0.55) / size + 1)) * size;
}
/** Where the finger would be for a page the rubber band holds at y (a page caught there goes on from it). */
function unband(y: number, size: number): number {
  const d = Math.min(Math.abs(y), size * 0.999);
  return (Math.sign(y) * d * size) / (0.55 * (size - d));
}

/** The page's x on screen right now — mid-flight too (Motion may be running it on the compositor). */
function xNow(el: HTMLElement): number {
  const p = el.offsetParent as HTMLElement | null;
  if (!p) return 0;
  return el.getBoundingClientRect().left - (p.getBoundingClientRect().left + p.clientLeft + el.offsetLeft);
}

const touchOf = (list: TouchList, id: number) => Array.from(list).find((t) => t.identifier === id);

/**
 * A speed the spring can take without the page passing its place: a critically damped spring overshoots once its
 * start speed is over ω × the way to go (ω = √stiffness). A throw harder than that only lands sooner.
 */
const capped = (v: number, way: number, stiffness: number) => {
  const max = Math.sqrt(stiffness) * Math.abs(way);
  return Math.max(-max, Math.min(max, v));
};

/** One page from the next: the screen's width — each page keeps its own margins, as on a phone's pager. */
const spanOf = (el: HTMLElement) => el.closest<HTMLElement>('.screen-scroll')?.clientWidth || document.documentElement.clientWidth || el.offsetWidth || 1;

/** The screen's action bar (the job's main button, the notes' composer): it belongs to the page. */
const barOf = (el: HTMLElement) => el.closest('.screen')?.querySelector<HTMLElement>(':scope > .screen-bottom > .sticky-bar') ?? null;

/** A page that left: a still copy, held where it was on the screen beside the page that came in. */
interface Ghost {
  layer: HTMLElement;
  copy: HTMLElement;
  anim?: AnimationPlaybackControls;
  /** The screen's scroll when the copy was taken (a page come back to its copy is put back there). */
  scrollTop: number;
}

function makeGhost(el: HTMLElement, x: number): Ghost | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const r = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'tab-ghost';
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('inert', '');
  const copy = el.cloneNode(true) as HTMLElement;
  // A picture only: not found as the page (its class), no second element with an id.
  copy.removeAttribute('class');
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  Object.assign(copy.style, {
    position: 'absolute',
    margin: '0',
    top: `${r.top}px`,
    left: `${r.left - x}px`,
    width: `${el.offsetWidth}px`,
    transform: `translateX(${x}px)`,
    opacity: '',
    visibility: '',
  });
  layer.append(copy);
  // In the same place of the page (its styles still apply), fixed to the screen: the new tab may open at its
  // top or at its end — the leaving page does not ride along.
  parent.append(layer);
  return { layer, copy, scrollTop: el.closest('.screen-scroll')?.scrollTop ?? 0 };
}

function dropGhost(g: Ghost) {
  g.anim?.stop();
  g.layer.remove();
}

/** A copy that goes with the page, `off` px beside it (a screen to the left or right), until it is off screen. */
interface Follower {
  ghost: Ghost;
  off: number;
}

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  /** Where the finger "is" for the page at the start: a page held by the rubber band counts from its unbanded x. */
  base: number;
  width: number;
  axis?: 'x' | 'y';
  /** The finger stopped a page on its way: if this turns out no drag, it goes on to its place. */
  caught: boolean;
  /** [time, x] of the last moves, for the speed at release. */
  samples: [number, number][];
  x: number;
  scrollTop: number;
}

interface Handoff {
  /** Where the old page was let go, and its speed (px/s). */
  x: number;
  v: number;
  /** +1: the next tab (the page went left), -1: the previous one. */
  dir: 1 | -1;
  span: number;
  /** The leaving page's spring as numbers: the new page joins it where it is by then, at its speed. */
  path: ReturnType<typeof spring> | null;
  /** The copy of the leaving page — its clock is the leaving group's. */
  ghost: Ghost | null;
  /** The copies going out with it, beside the leaving page (`off` from it). */
  group: Follower[];
  /** The action bar there was before: a new one comes in with its page. */
  bar: HTMLElement | null;
}

/**
 * Tabs under a row of pills move like pages. While the finger is on it, the page is the finger: 1:1 sideways,
 * with a rubber band where there is no tab that way. Let go past 40 % of the width, or flung, and the next tab
 * opens: the old page goes on out at once with the finger's speed (a still copy, on the compositor, while the
 * new tab is being built), and the new one comes in beside it, a screen apart, at the same point of the same
 * spring — the two move together; the screen's action bar comes in with its page. A finger can catch the page
 * on its way: the copy of the leaving page is caught with it and stays beside it — drag back and the old tab
 * comes back exactly where its copy was. Let go short: everything springs back. A tab tapped in the row comes
 * in from its side, softly.
 *
 * The axis is the first move's (8 px), so scrolling up and down is not disturbed (and if the screen scrolls
 * after all, the page goes back); the page is `touch-action: pan-y`, the strip along the left edge stays with
 * "Back", rows with their own swipe and sideways strips are left alone. Under the finger everything is written
 * to the page's transform (Motion), never to React state. Reduce Motion: the page still follows the finger;
 * it settles without a spring, and a tapped tab only fades in.
 *
 * `panel` goes on the tab's page — keyed by the tab, so that each tab gets a page of its own.
 */
export function useTabSwipe(order: readonly string[], value: string, onChange: (v: string) => void): { panel: (el: HTMLElement | null) => void } {
  const live = useRef({ order, value, onChange });
  live.current = { order, value, onChange };
  // How the next page comes in: after a swipe (beside the old one) or a tap (from its side).
  const at = order.indexOf(value);
  const shown = useRef(at);
  const entry = useRef<'swipe' | 'tap' | null>(null);
  const tapDir = useRef(0);
  if (shown.current !== at) {
    if (entry.current !== 'swipe') {
      entry.current = 'tap';
      tapDir.current = Math.sign(at - shown.current);
    }
    shown.current = at;
  }

  const st = useRef<{ el: HTMLElement | null; anim: AnimationPlaybackControls | null; g: Gesture | null; handoff: Handoff | null; followers: Follower[]; off: (() => void) | null }>({
    el: null,
    anim: null,
    g: null,
    handoff: null,
    followers: [],
    off: null,
  });

  const panel = useCallback((el: HTMLElement | null) => {
    const s = st.current;
    if (s.el === el) return;
    s.off?.();
    s.off = null;
    s.anim?.stop();
    s.anim = null;
    s.g = null;
    s.el = el;
    if (!el) return;

    /** Under the finger: at once (Motion keeps the value, so a spring later starts from here). */
    const place = (x: number) => {
      animate(el, { x }, { duration: 0 });
      for (const f of s.followers) animate(f.ghost.copy, { x: x + f.off }, { duration: 0 });
    };
    /** At rest the page has no transform: nothing fixed inside it is tied to it, no layer is kept. */
    const rest = (a: AnimationPlaybackControls, also?: HTMLElement) =>
      void a.finished.then(() => {
        if (also) also.style.transform = '';
        if (s.anim !== a) return;
        s.anim = null;
        if (s.el === el) el.style.transform = '';
      });
    /** A copy off screen (or home behind the page): gone. */
    const gone = (f: Follower) => {
      const i = s.followers.indexOf(f);
      if (i < 0) return;
      s.followers.splice(i, 1);
      dropGhost(f.ghost);
    };
    /** A copy goes on with the page until it is off screen, then it is gone. */
    const leave = (f: Follower, to: number, how: object) => {
      f.ghost.anim = animate(f.ghost.copy, { x: to }, how);
      void f.ghost.anim.finished.then(() => gone(f));
    };
    const dropFollowers = () => {
      s.followers.forEach((f) => dropGhost(f.ghost));
      s.followers = [];
    };
    /** Back home: the page to 0, its copies with it (on the same spring, from where they are). */
    const settle = (velocity = 0) => {
      const how = reduced() ? PLAIN : { ...SNAP, velocity: capped(velocity, xNow(el), SNAP.stiffness) };
      const a = animate(el, { x: 0 }, how);
      s.anim = a;
      rest(a);
      for (const f of s.followers) leave(f, f.off, how);
    };

    const scroller = el.closest<HTMLElement>('.screen-scroll');
    // The screen scrolled under a sideways drag after all (the browser took it as a scroll): scrolling wins.
    const onScroll = () => {
      const g = s.g;
      if (!g || g.axis !== 'x' || !scroller || Math.abs(scroller.scrollTop - g.scrollTop) < SCROLL_WINS) return;
      endGesture();
      settle();
    };
    const onStart = (e: TouchEvent) => {
      if (s.g) {
        // A second finger is ignored: the first one goes on.
        if (e.touches.length !== 1) return;
        // One finger on the glass and still a gesture: its let-go never came. Closed, back home.
        const g = s.g;
        endGesture();
        if (g.axis === 'x' || g.caught) settle();
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || (e.target as Element | null)?.closest?.(OWN_SWIPE)) return;
      // Something on the screen must not be lost to a page turn (a voice note being recorded).
      if (el.closest('.screen')?.querySelector('[data-hold-page]')) return;
      const width = spanOf(el);
      const moving = !!s.anim || s.followers.some((f) => f.ghost.anim);
      let x = 0;
      if (moving) {
        // A page on its way is caught where it is, with its copies beside it (and whole: a page that was coming
        // in faded is shown at once).
        x = xNow(el);
        s.anim?.stop();
        s.anim = null;
        for (const f of s.followers) f.ghost.anim?.stop();
        animate(el, { x, opacity: 1 }, { duration: 0 });
        place(x);
      }
      const { order: o, value: v } = live.current;
      const i = o.indexOf(v);
      const banded = (x < 0 && i >= o.length - 1) || (x > 0 && i <= 0);
      s.g = {
        id: t.identifier,
        x0: t.clientX,
        y0: t.clientY,
        base: banded ? unband(x, width) : x,
        width,
        caught: moving,
        samples: [[e.timeStamp, x]],
        x,
        scrollTop: scroller?.scrollTop ?? 0,
      };
      // (An icon inside a button is an SVG element: any element takes these listeners.)
      const node = e.target as HTMLElement;
      node.addEventListener('touchmove', onMove, { passive: true });
      node.addEventListener('touchend', onEnd, { passive: true });
      node.addEventListener('touchcancel', onCancel, { passive: true });
      unlisten = () => {
        node.removeEventListener('touchmove', onMove);
        node.removeEventListener('touchend', onEnd);
        node.removeEventListener('touchcancel', onCancel);
      };
    };
    let unlisten: (() => void) | null = null;
    /** The gesture is over: its touch is not followed any more. */
    const endGesture = () => {
      s.g = null;
      unlisten?.();
      unlisten = null;
    };
    const onMove = (e: TouchEvent) => {
      const g = s.g;
      const t = g && touchOf(e.touches, g.id);
      if (!g || !t) return;
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.axis) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (g.axis === 'y') {
          endGesture();
          if (g.caught) settle();
          return;
        }
      }
      const { order: o, value: v } = live.current;
      const i = o.indexOf(v);
      let x = g.base + dx;
      if ((x < 0 && i >= o.length - 1) || (x > 0 && i <= 0)) x = rubber(x, g.width);
      g.x = x;
      place(x);
      g.samples.push([e.timeStamp, x]);
      if (g.samples.length > 10) g.samples.shift();
    };
    const onEnd = (e: TouchEvent) => {
      const g = s.g;
      if (!g || !touchOf(e.changedTouches, g.id)) return;
      endGesture();
      if (g.axis !== 'x') {
        if (g.caught) settle();
        return;
      }
      // The speed over the last 100 ms (a finger that stopped before letting go has none). Moves closer in time
      // than a frame tell no speed: their timestamps would make one of thousands of px per ms.
      const recent = g.samples.filter(([time]) => time >= e.timeStamp - 100);
      const [t0, x0] = recent[0] ?? [0, g.x];
      const [t1, x1] = recent[recent.length - 1] ?? [0, g.x];
      const v = recent.length > 1 && t1 - t0 >= 8 ? (x1 - x0) / (t1 - t0) : 0;
      const x = g.x;
      const { order: o, value: cur, onChange: go } = live.current;
      const dir: 1 | -1 = x < 0 ? 1 : -1;
      const to = o.indexOf(cur) + dir;
      const flung = Math.abs(v) > FLING && Math.sign(v) === Math.sign(x) && Math.abs(x) > FLING_MIN;
      const thrownBack = Math.abs(v) > FLING && Math.sign(v) === -Math.sign(x);
      if (!(x !== 0 && to >= 0 && to < o.length && !thrownBack && (Math.abs(x) > g.width * COMMIT || flung))) {
        settle(v * 1000);
        return;
      }
      const span = g.width;
      const ghost = makeGhost(el, x);
      // The leaving group: the page's copy and the copies already beside it, `off` from the leaving page.
      const h: Handoff = { x, v: v * 1000, dir, span, path: null, ghost, group: s.followers, bar: barOf(el) };
      s.followers = [];
      if (ghost) {
        h.group = [{ ghost, off: 0 }, ...h.group];
        // The copy shows the page from now on (the page itself may be carried by a scroll before it goes).
        el.style.visibility = 'hidden';
      }
      if (!reduced()) {
        // Out at once — on the compositor, while the new tab is built: all of the group by the same way.
        const by = -dir * span - x;
        h.v = capped(h.v, by, PAGE.stiffness);
        const how = { ...PAGE, velocity: h.v };
        for (const f of h.group) f.ghost.anim = animate(f.ghost.copy, { x: [x + f.off, x + f.off + by] }, how);
        h.path = spring({ keyframes: [x, x + by], ...how });
      }
      s.handoff = h;
      entry.current = 'swipe';
      haptic('selection');
      go(o[to]);
      // Should the tab not change after all, nothing is left half way.
      window.setTimeout(() => {
        if (s.handoff !== h || live.current.value !== cur) return;
        s.handoff = null;
        entry.current = null;
        el.style.visibility = '';
        if (ghost) dropGhost(ghost);
        s.followers = h.group.filter((f) => f.ghost !== ghost);
        if (s.el === el) settle();
      }, 600);
    };
    const onCancel = () => {
      const g = s.g;
      if (!g) return;
      endGesture();
      if (g.axis === 'x' || g.caught) settle();
    };

    el.style.touchAction = 'pan-y';
    el.addEventListener('touchstart', onStart, { passive: true });
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    s.off = () => {
      el.removeEventListener('touchstart', onStart);
      scroller?.removeEventListener('scroll', onScroll);
      unlisten?.();
    };

    // How the page comes in.
    const how = entry.current;
    entry.current = null;
    const h = s.handoff;
    s.handoff = null;
    if (how !== 'swipe' || !h) {
      // A tap, a link, the first look: copies of earlier pages have nothing to go with any more.
      h?.group.forEach((f) => dropGhost(f.ghost));
      dropFollowers();
      if (how === 'tap' && tapDir.current) {
        const a = reduced()
          ? animate(el, { opacity: [0, 1] }, { duration: 0.2, ease: EASE_OUT })
          : animate(el, { x: [tapDir.current * 28, 0], opacity: [0, 1] }, { ...TAP, opacity: { duration: 0.22, ease: EASE_OUT } });
        s.anim = a;
        rest(a);
      }
      tapDir.current = 0;
      return;
    }
    // Where the leaving page is by now, and how fast it goes (the new tab took a moment to build).
    let gx = h.x;
    let gv = h.v;
    let done = false;
    if (h.path && h.ghost?.anim) {
      const t = h.ghost.anim.time * 1000;
      const now = h.path.next(t);
      gx = now.value;
      gv = (h.path.next(t + 1).value - gx) * 1000;
      done = now.done;
    }
    const from = gx + h.dir * h.span;
    // A copy where the new page is — the old tab come back to its copy — gives way to it, and the page comes back
    // to the scroll it was taken at (a tab that opens at its top or at its end has moved the screen meanwhile).
    const home = h.group.find((f) => Math.abs(f.off - h.dir * h.span) < 1);
    const cameBack = !!home;
    if (home && scroller) scroller.scrollTop = home.ghost.scrollTop;
    // The group, now beside the new page.
    const top = Math.max(0, el.getBoundingClientRect().top);
    const group: Follower[] = [];
    for (const f of h.group) {
      const off = f.off - h.dir * h.span;
      if (f === home || done) {
        dropGhost(f.ghost);
        continue;
      }
      // A copy shows only below where the new page begins (a tab that opens at its top brings the header back
      // down over the place where the old page was).
      if (top > 0) f.ghost.layer.style.clipPath = `inset(${top}px 0 0 0)`;
      group.push({ ghost: f.ghost, off });
    }
    s.followers = group;
    if (done) return;
    const bar = barOf(el);
    const newBar = bar && bar !== h.bar ? bar : null;
    if (reduced()) {
      // No spring: all settle plainly, together.
      for (const f of group) {
        f.ghost.anim = animate(f.ghost.copy, { x: [from + f.off, f.off] }, PLAIN);
        void f.ghost.anim.finished.then(() => gone(f));
      }
      const a = animate(el, { x: [from, 0] }, PLAIN);
      s.anim = a;
      rest(a);
      return;
    }
    // The same spring from the same point: side by side to the end (the copies go on by the spring already
    // running since the let-go). A page come back to its copy shows at once; a new one shows over its first
    // frames (it was not there under the finger).
    const a = animate(el, cameBack ? { x: [from, 0] } : { x: [from, 0], opacity: [0, 1] }, { ...PAGE, velocity: gv, opacity: { duration: 0.12, ease: EASE_OUT } });
    s.anim = a;
    rest(a);
    for (const f of group) void f.ghost.anim?.finished.then(() => gone(f));
    if (newBar) rest(animate(newBar, { x: [from, 0] }, { ...PAGE, velocity: gv }), newBar);
  }, []);

  // The screen closes: nothing of a page left behind. (The page's own listeners go with it: React hands the
  // ref null then. Not here — React's strict mode runs this cleanup once with the page still on screen.)
  useEffect(
    () => () => {
      const s = st.current;
      s.anim?.stop();
      s.followers.forEach((f) => dropGhost(f.ghost));
      s.followers = [];
      s.handoff?.group.forEach((f) => dropGhost(f.ghost));
      s.handoff = null;
    },
    [],
  );

  return { panel };
}
