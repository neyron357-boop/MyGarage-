import { IconCashBanknoteFilled, IconDotsFilled, IconLayoutKanbanFilled, IconPlus, IconSearch, type Icon } from '@tabler/icons-react';
import { animate, type AnimationPlaybackControls } from 'motion';
import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { haptic } from './haptics';
import { hintNavigation, scrollToTop } from './stack';
import { mayLeave } from './unsaved';

// Filled symbols, as Apple asks for tab bars (the magnifier of Search stays a line, as in iOS).
const TABS: { to: string; icon: Icon; key: string }[] = [
  { to: '/', icon: IconLayoutKanbanFilled, key: 'nav.board' },
  { to: '/search', icon: IconSearch, key: 'nav.search' },
  { to: '/money', icon: IconCashBanknoteFilled, key: 'nav.money' },
  { to: '/more', icon: IconDotsFilled, key: 'nav.more' },
];
const MORE_PATHS = ['/more', '/customers', '/vehicles', '/parts', '/reports', '/settings'];

/** The tab a screen belongs to: its own root, or the tab it was opened from (a job, a customer). */
function tabOf(pathname: string): string | undefined {
  if (MORE_PATHS.some((p) => pathname.startsWith(p))) return '/more';
  return TABS.find((s) => s.to === pathname)?.to;
}

/**
 * The phone tab bar of iOS 26: a floating Liquid Glass capsule that never moves with the screens.
 *
 * The tab you are in sits on a lens. A tap opens a tab and the lens springs there. Press and slide
 * along the bar and the lens comes under the finger and stays there — slow, fast, a pause, back again;
 * the tab under the finger is tinted, and the one where the finger lets go opens (only that one, once;
 * unsaved edits are asked about first, as for a tap). Slid far off the bar the tint goes out and letting
 * go opens nothing; taken by the system (pointercancel) the lens goes home. A finger on the lens while
 * it is still moving catches it where it is. A screen opened from a tab (a job from the board) keeps
 * that tab lit; tapping it goes back to the tab's first screen, tapping it there scrolls to the top.
 * "+" (new job) is its own tinted glass circle: a tab bar is for places.
 */
export function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const last = useRef('/');
  const current = tabOf(pathname) ?? last.current;
  last.current = current;
  const index = TABS.findIndex((s) => s.to === current);
  const go = (to: string) => {
    if (pathname === to) return scrollToTop(true);
    hintNavigation(current === to ? 'pop' : 'tab');
    navigate(to);
  };
  const nav = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  const dragged = useLensDrag(nav, lens, index, (i) => {
    // A slide is no click: the unsaved-edits guard is asked here, as it is for a tapped tab.
    if (!mayLeave(TABS[i].to)) return false;
    go(TABS[i].to);
    return true;
  });
  return (
    <div className="tab-bar-wrap">
      <nav ref={nav} className="tab-bar glass" aria-label={t('nav.menu')} style={{ '--n': TABS.length } as CSSProperties}>
        <span ref={lens} className="tab-lens" aria-hidden />
        {TABS.map((s) => (
          <button
            key={s.to}
            type="button"
            data-href={s.to}
            className={s.to === current ? 'active' : undefined}
            aria-current={s.to === current ? 'page' : undefined}
            // A slide along the bar opens its tab on release; the click some browsers add after it does not.
            onClick={() => (dragged.current ? undefined : go(s.to))}
          >
            <s.icon stroke={2.2} aria-hidden />
            <span>{t(s.key)}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="tab-plus" aria-label={t('nav.newOrder')} onClick={() => navigate('/orders/new')}>
        <IconPlus size={28} stroke={2.2} aria-hidden />
      </button>
    </div>
  );
}

/* ---------------- The lens ---------------- */

/** A press becomes a slide after this many px sideways (less is a tap). */
const SLOP = 8;
/** The speed a thrown lens keeps (px/s): enough to feel carried, not enough to fly past the bar. */
const MAX_THROW = 600;
/** Finger samples older than this (ms) do not count for the release speed; a pause of STILL throws nothing. */
const VELOCITY_WINDOW = 100;
const STILL = 60;
/** How fast a lens that was not under the finger comes under it (ms, exponential): ~200 ms to the pixel. */
const CATCH_UP = 45;
/** How far past the end tabs the lens may be pulled, as a part of a tab (rubber band). */
const RUBBER = 0.35;
/** A tap or a link moves the lens with no force behind it: no bounce. */
const SETTLE = { type: 'spring', visualDuration: 0.3, bounce: 0 } as const;
/** Let go after a slide: the finger's speed carries into the settle, with a slight bounce. */
const THROW = { type: 'spring', visualDuration: 0.34, bounce: 0.2 } as const;
/** A change of mind: back home quickly. */
const SNAP = { type: 'spring', visualDuration: 0.22, bounce: 0 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const reducedMotion = () => reduceQuery?.matches === true;

/** Past an edge the lens gives way less and less, like a rubber band (UIScrollView's curve). */
function rubber(over: number, size: number): number {
  const d = Math.abs(over);
  return Math.sign(over) * (1 - 1 / ((d * 0.55) / size + 1)) * size;
}

/**
 * Where the lens is, written by Motion: a spring released on the compositor (WAAPI) — it keeps moving
 * while the new tab is being built — that Motion samples when it is interrupted, so a new aim or a
 * finger takes it from its current position and speed. While the finger holds it, `follow` puts it
 * under the finger every move (Motion keeps such a value on the main thread, without springs).
 */
class LensMotion {
  private pos?: AnimationPlaybackControls;
  private size?: AnimationPlaybackControls;
  target = 0;

  constructor(private el: HTMLElement) {}

  /** The lens's x right now, mid-flight too: from its centre on screen (its scale is about the centre). */
  now(barLeft: number, slot: number): number {
    const r = this.el.getBoundingClientRect();
    return r.left + r.width / 2 - barLeft - 2 - slot / 2;
  }

  /** At once: first paint, a new width, the finger. */
  follow(x: number) {
    this.target = x;
    this.pos = animate(this.el, { x }, { duration: 0 });
  }

  /** Stopped where it is (a finger on it). */
  hold() {
    this.pos?.stop();
  }

  /**
   * Spring to x. Without `velocity` Motion keeps the speed it samples from the motion it interrupts (a
   * second tap while the lens flies bends its path, no stop-and-go); a release passes the finger's.
   * Reduce Motion: a short, plain settle instead of a spring.
   */
  to(x: number, how: typeof SETTLE | typeof THROW | typeof SNAP, velocity?: number) {
    this.target = x;
    if (reducedMotion()) {
      this.pos = animate(this.el, { x }, { duration: 0.15, ease: EASE_OUT });
      return;
    }
    this.pos = animate(this.el, { x }, velocity === undefined ? how : { ...how, velocity });
  }

  /** The lens swells under a finger and lifts out of the bar while it slides (iOS 26); decoration, so not with Reduce Motion. */
  swell(state: 'rest' | 'press' | 'drag') {
    if (reducedMotion()) return;
    const [sx, sy] = state === 'drag' ? [1.12, 1.1] : state === 'press' ? [1.06, 1.06] : [1, 1];
    this.size = animate(this.el, { scaleX: sx, scaleY: sy }, state === 'rest' ? { type: 'spring', visualDuration: 0.3, bounce: 0 } : { duration: state === 'press' ? 0.12 : 0.2, ease: EASE_OUT });
  }

  stop() {
    this.pos?.stop();
    this.size?.stop();
  }
}

interface Gesture {
  id: number;
  x0: number;
  /** The bar's box at the press (it does not move while the finger is on it). */
  left: number;
  top: number;
  bottom: number;
  slot: number;
  drag: boolean;
  /** Lens centre minus finger when the slide started; it melts away (CATCH_UP), then the lens is the finger. */
  offset0: number;
  t0: number;
  /** The finger's last x. */
  fx: number;
  /** The tab under the finger (the one that opens on release); -1 while the finger is far off the bar. */
  hover: number;
  /** Every tab the finger was over during the slide (-1: far off the bar). */
  visited: Set<number>;
  /** The finger is far above or below the bar: letting go there opens nothing. */
  off: boolean;
  /** The press stopped the lens mid-way. */
  froze: boolean;
  /** [time, x] of the last moves, for the speed at release. */
  samples: [number, number][];
}

/**
 * The lens and the finger. Positions are the lens's x in px (tab i at i × tab width); everything goes
 * to the lens's transform (Motion) and to data attributes of the bar (`data-press`, `data-drag`,
 * `data-off`, `data-slid`, `data-hover` on the tab under the finger), not to React state — the bar does
 * not re-render while the finger moves. `pick(i)` opens a tab and says whether it did (unsaved edits
 * may hold it back). Returns a ref that is true right after a slide (a click that may follow is no tap).
 */
function useLensDrag(navRef: RefObject<HTMLElement>, lensRef: RefObject<HTMLElement>, index: number, pick: (i: number) => boolean) {
  const dragged = useRef(false);
  const live = useRef({ index, pick });
  live.current = { index, pick };
  const machine = useRef<{ lens: LensMotion; slot: () => number; busy: () => boolean } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = lensRef.current;
    if (!nav || !el) return;
    const n = TABS.length;
    const slot = () => (nav.clientWidth - 4) / n;
    const lens = new LensMotion(el);
    const home = () => Math.max(0, live.current.index) * slot();
    lens.follow(home());
    let g: Gesture | null = null;
    let unblock = 0;
    let raf = 0;

    const tabAt = (x: number, s: Gesture) => Math.min(n - 1, Math.max(0, Math.floor((x - s.left - 2) / s.slot)));
    const hover = (i: number) => {
      if (!g || i === g.hover) return;
      nav.querySelectorAll('button[data-hover]').forEach((b) => b.removeAttribute('data-hover'));
      if (i >= 0) nav.querySelectorAll('button[data-href]')[i]?.setAttribute('data-hover', '');
      if (g.hover >= 0 && i >= 0) haptic('selection');
      g.hover = i;
    };
    const clear = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      delete nav.dataset.press;
      delete nav.dataset.drag;
      delete nav.dataset.off;
      nav.querySelectorAll('button[data-hover]').forEach((b) => b.removeAttribute('data-hover'));
      lens.swell('rest');
    };
    /** Right after a slide: the click a browser may add is no tap (here and in the unsaved-edits guard). */
    const slid = () => {
      dragged.current = true;
      nav.dataset.slid = '';
      window.clearTimeout(unblock);
      unblock = window.setTimeout(() => {
        dragged.current = false;
        delete nav.dataset.slid;
      }, 400);
    };
    const speed = (s: Gesture) => {
      const now = performance.now();
      const last = s.samples[s.samples.length - 1];
      if (!last || now - last[0] > STILL) return 0;
      const [t0, x0] = s.samples[0];
      const v = last[0] > t0 ? ((last[1] - x0) / (last[0] - t0)) * 1000 : 0;
      return Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
    };
    /** The lens where the finger says: its x plus what is left of the offset, rubber past the end tabs. */
    const place = () => {
      const s = g;
      if (!s) return;
      const now = performance.now();
      let offset = s.offset0 * Math.exp(-(now - s.t0) / CATCH_UP);
      if (Math.abs(offset) < 0.5) offset = 0;
      const max = (n - 1) * s.slot;
      let x = s.fx + offset - s.left - 2 - s.slot / 2;
      if (x < 0) x = rubber(x, s.slot * RUBBER);
      else if (x > max) x = max + rubber(x - max, s.slot * RUBBER);
      s.samples.push([now, x]);
      while (s.samples.length > 2 && now - s.samples[0][0] > VELOCITY_WINDOW) s.samples.shift();
      lens.follow(x);
      // Still catching up with a finger that stopped: on, frame by frame, until it is under the finger.
      cancelAnimationFrame(raf);
      raf = offset ? requestAnimationFrame(place) : 0;
    };

    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      if (g) {
        if (e.pointerId === g.id) return;
        // An earlier press whose release never came: drop it.
        g = null;
        clear();
      }
      // A new press: whatever came after the last slide is over (its click, if any, came before this).
      window.clearTimeout(unblock);
      dragged.current = false;
      delete nav.dataset.slid;
      const r = nav.getBoundingClientRect();
      const w = slot();
      const at = lens.now(r.left, w);
      const lensLeft = r.left + 2 + at;
      const onLens = e.clientX >= lensLeft - 6 && e.clientX <= lensLeft + w + 6;
      const froze = onLens && Math.abs(at - lens.target) > 0.5;
      // A finger on a moving lens holds it where it is.
      if (froze) lens.hold();
      g = { id: e.pointerId, x0: e.clientX, left: r.left, top: r.top, bottom: r.bottom, slot: w, drag: false, offset0: 0, t0: 0, fx: e.clientX, hover: -1, visited: new Set(), off: false, froze, samples: [] };
      // The lens answers the touch in the same frame: it swells under the finger.
      if (onLens) {
        nav.dataset.press = '';
        lens.swell('press');
      }
    };

    const move = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.drag) {
        if (Math.abs(e.clientX - g.x0) < SLOP) return;
        g.drag = true;
        slid();
        // Only now: captured from the press, a tap's click would go to the bar instead of the tab.
        try {
          nav.setPointerCapture(e.pointerId);
        } catch {
          // the pointer is gone already; pointercancel follows
        }
        nav.dataset.drag = '';
        lens.swell('drag');
        // From wherever the lens is (under the finger, resting elsewhere, still flying) it comes under it.
        lens.hold();
        g.offset0 = g.left + 2 + lens.now(g.left, g.slot) + g.slot / 2 - e.clientX;
        g.t0 = performance.now();
      }
      g.fx = e.clientX;
      place();
      const h = g.bottom - g.top;
      const off = e.clientY < g.top - h || e.clientY > g.bottom + h;
      if (off !== g.off) {
        g.off = off;
        if (off) nav.dataset.off = '';
        else delete nav.dataset.off;
      }
      hover(off ? -1 : tabAt(e.clientX, g));
      g.visited.add(off ? -1 : g.hover);
    };

    const up = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g;
      g = null;
      clear();
      if (!s.drag) {
        // A tap: its click opens the tab (and ticks on an iPhone through the tab's label). A lens the
        // press stopped mid-way goes on; the click may send it somewhere else at once.
        if (s.froze) lens.to(home(), SETTLE);
        return;
      }
      slid();
      const h = s.bottom - s.top;
      // Let go far above or below the bar: a change of mind — back home, nothing opens.
      if (e.clientY < s.top - h || e.clientY > s.bottom + h) return lens.to(home(), SNAP);
      const i = tabAt(e.clientX, s);
      lens.to(i * s.slot, THROW, speed(s));
      // A sloppy tap — a slide that never left the tab it started on — is a tap: on the tab you are in it
      // goes back to the tab's first screen (or to the top), as a clean tap does. Away and back is a change
      // of mind: nothing.
      const sloppyTap = s.visited.size === 1 && s.visited.has(i);
      if (i === live.current.index && !sloppyTap) return;
      // Held back (unsaved edits: the guard asks first): home until the user decides.
      if (!live.current.pick(i)) lens.to(home(), SNAP);
    };

    const cancel = (e: { pointerId: number }) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g;
      g = null;
      clear();
      if (s.drag) slid();
      lens.to(home(), SNAP);
    };
    // The page lost the finger without a pointercancel (an alert, a Telegram popup, the app sent to the
    // background): the press ends as a cancel, so the bar never stays in its sliding state.
    const abandon = () => {
      if (g) cancel({ pointerId: g.id });
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') abandon();
    };

    // The bar's own capture lost (not the tab's implicit touch capture, handed to the bar when the slide starts).
    const lost = (e: PointerEvent) => {
      if (e.target === nav) cancel(e);
    };

    // Touches that move on the bar are the bar's. Measured: with `touch-action: none` alone, Chrome
    // (Android) still reads a quick slide as a fling and swallows the next tap anywhere for ~2 s.
    const hold = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };

    nav.addEventListener('touchmove', hold, { passive: false });
    nav.addEventListener('pointerdown', down);
    nav.addEventListener('pointermove', move);
    nav.addEventListener('lostpointercapture', lost);
    // Releases on the window: a mouse let go outside the bar (no implicit capture there) still ends the press.
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', abandon);
    document.addEventListener('visibilitychange', hidden);
    // A new width (rotation, the bar coming back after the keyboard): the lens stays on its tab.
    const ro = new ResizeObserver(() => {
      if (!g) lens.follow(home());
    });
    ro.observe(nav);
    machine.current = { lens, slot, busy: () => g?.drag === true };
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      lens.stop();
      window.clearTimeout(unblock);
      nav.removeEventListener('touchmove', hold);
      nav.removeEventListener('pointerdown', down);
      nav.removeEventListener('pointermove', move);
      nav.removeEventListener('lostpointercapture', lost);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', abandon);
      document.removeEventListener('visibilitychange', hidden);
      machine.current = null;
    };
  }, [navRef, lensRef]);

  // Another tab is open (a tap, a link, Back): the lens springs there from wherever it is now.
  useLayoutEffect(() => {
    const m = machine.current;
    if (!m || m.busy()) return;
    const at = Math.max(0, index) * m.slot();
    if (Math.abs(at - m.lens.target) > 0.5) m.lens.to(at, SETTLE);
  }, [index]);

  return dragged;
}
