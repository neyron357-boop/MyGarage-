import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { layers } from './historyLayer';

/*
 * The phone's navigation stack, built like UINavigationController.
 *
 * Every screen is its own full-screen sheet with its own scroll view; the document itself never
 * scrolls, so the tab bar and navigation bars stay exactly where they are (no rubber band dragging
 * them, no Safari keyboard shift carrying them away). Opening a screen slides it in from the right
 * over the previous one, which steps back and dims; the previous screen stays mounted — with its
 * scroll position and state — so "Back" is instant and the swipe from the left edge shows the real
 * screen underneath, following the finger. Bottom-tab switches cross-fade; "New job" is presented
 * from the bottom like a new message.
 *
 * The browser history stays the source of truth: the stack follows it (push, replace, back,
 * forward) and asks it to go back when the user swipes or taps "Back".
 */

/** The screens of the bottom tab bar. */
export const TAB_ROOTS = new Set(['/', '/search', '/money', '/more']);
/** Work at the car gets the whole screen: no tab bar under its buttons. */
const FOCUS_RE = /^\/orders\/(new|[^/]+\/(intake|handover|invoice))$/;
/** Presented from the bottom (and dismissed down), like composing a new message. */
const MODAL_RE = /^\/orders\/new$/;

export const showsTabBar = (pathname: string) => !FOCUS_RE.test(pathname);
const isModal = (pathname: string) => MODAL_RE.test(pathname);

/** UIKit's navigation curve and timings. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const PUSH_MS = 460;
const PRESENT_MS = 500;
const DISMISS_MS = 360;
const FADE_MS = 140;
/** How far the covered screen steps back, and how dark it gets. */
const PARALLAX = -0.3;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- How the next navigation should look ---------------- */

type Hint = 'tab' | 'pop';
let hint: Hint | null = null;
/** Tab bar: the next navigation is a tab switch (cross-fade). "pop": it should look like going back. */
export function hintNavigation(h: Hint) {
  hint = h;
}

/* ---------------- Stack model ---------------- */

interface Entry {
  id: string;
  location: Location;
  /** Position in the browser history (react-router keeps it in history.state.idx). */
  idx: number;
}

type Kind = 'push' | 'pop' | 'present' | 'dismiss' | 'fade';

interface Anim {
  seq: number;
  kind: Kind;
  inId: string;
  outId?: string;
  /** The back swipe already moved the screens to the end: just settle. */
  done?: boolean;
}

interface Model {
  entries: Entry[];
  /** A screen on its way out (popped, dismissed or replaced), kept until its animation ends. */
  out: Entry | null;
  anim: Anim | null;
}

let seq = 0;
const historyIdx = () => {
  const i = window.history.state?.idx;
  return typeof i === 'number' ? i : 0;
};

function next(model: Model, loc: Location, action: string, idx: number, h: Hint | null, gestureFrom: string | null): Model {
  const { entries } = model;
  const top = entries[entries.length - 1];
  const fresh = (): Entry => ({ id: `${loc.key || 'k'}-${++seq}`, location: loc, idx });
  if (!top) return { entries: [fresh()], out: null, anim: null };

  // Entries typed or linked into the address bar have no key of their own ("default"): not an identity.
  const sameKey = (a: Location, b: Location) => a.key !== 'default' && a.key === b.key;
  // Same screen: another tab inside it, a query, or the history step of a sheet.
  if (sameKey(loc, top.location) || loc.pathname === top.location.pathname) {
    return { ...model, entries: [...entries.slice(0, -1), { ...top, location: loc, idx }] };
  }

  // Bottom tabs: a fresh stack for the tab, a quick cross-fade.
  const tabSwitch = h === 'tab' || (TAB_ROOTS.has(top.location.pathname) && TAB_ROOTS.has(loc.pathname) && h !== 'pop');
  if (tabSwitch) {
    const e = fresh();
    return { entries: [e], out: null, anim: { seq: ++seq, kind: 'fade', inId: e.id } };
  }

  // Back to a screen under this one: by the history (Back, swipe) or by opening it again (a flow
  // that ends on its job) — it comes back from underneath with its state.
  let k = -1;
  if (action === 'POP') {
    // The history entry itself; or (the first entry of a session has no key) its place in the history;
    // or, going back, the screen right under this one when it is the same page.
    k = entries.findIndex((e) => sameKey(e.location, loc));
    if (k < 0) k = entries.findIndex((e, i) => i < entries.length - 1 && e.idx === idx && e.location.pathname === loc.pathname);
    const under = entries.length - 2;
    if (k < 0 && under >= 0 && idx <= top.idx && entries[under].location.pathname === loc.pathname) k = under;
  }
  if (k < 0 && action !== 'POP') {
    for (let i = entries.length - 2; i >= 0; i--) {
      if (entries[i].location.pathname === loc.pathname) {
        k = i;
        break;
      }
    }
  }
  if (k >= 0 && k < entries.length - 1) {
    const target = { ...entries[k], location: loc, idx };
    return {
      entries: [...entries.slice(0, k), target],
      out: top,
      anim: { seq: ++seq, kind: isModal(top.location.pathname) ? 'dismiss' : 'pop', inId: target.id, outId: top.id, done: gestureFrom === top.id },
    };
  }

  const e = fresh();
  // Back past the start of the stack (a screen opened from a link), or "Back" with nothing behind.
  if ((action === 'POP' && idx < top.idx) || h === 'pop') {
    return {
      entries: action === 'PUSH' ? [...entries, e] : [e],
      out: top,
      anim: { seq: ++seq, kind: isModal(top.location.pathname) ? 'dismiss' : 'pop', inId: e.id, outId: top.id },
    };
  }
  const kind: Kind = isModal(loc.pathname) ? 'present' : 'push';
  // Replaced (a finished step leads on): the old screen is covered, then let go.
  if (action === 'REPLACE') return { entries: [...entries.slice(0, -1), e], out: top, anim: { seq: ++seq, kind, inId: e.id, outId: top.id } };
  return { entries: [...entries, e], out: null, anim: { seq: ++seq, kind, inId: e.id, outId: top.id } };
}

/* ---------------- Contexts ---------------- */

export interface ScreenInfo {
  /** The navigation bar of the screen is rendered here (outside its scroll view). */
  nav: HTMLElement;
  /** The action bar of the screen is rendered here (pinned to its bottom edge). */
  bottom: HTMLElement;
  scroller: React.RefObject<HTMLDivElement>;
  active: boolean;
  /** Presented from the bottom: its way out is "Cancel", not "‹ Back". */
  modal: boolean;
}

const ScreenContext = createContext<ScreenInfo | null>(null);
/** The phone screen this component is in (null on a PC). */
export function useScreen(): ScreenInfo | null {
  return useContext(ScreenContext);
}

interface StackInfo {
  /** The screen "Back" leads to, if there is one in the stack. */
  previous?: Location;
  back: (fallback?: string) => void;
}

const StackContext = createContext<StackInfo | null>(null);
export function useStack(): StackInfo | null {
  return useContext(StackContext);
}

/** Scroll the screen in front (or the page on a PC) to the top. */
export function scrollToTop(smooth = false) {
  const el = document.querySelector<HTMLElement>('.screen[data-role="top"] .screen-scroll');
  if (el) el.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  else window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}

/** A short name of the screen for the back button ("‹ Board", "‹ Job"); long names become "Back". */
export function useScreenTitle() {
  const { t } = useTranslation();
  return useCallback(
    (pathname: string): string => {
      const map: [RegExp, string][] = [
        [/^\/$/, t('nav.board')],
        [/^\/search$/, t('nav.search')],
        [/^\/money$/, t('nav.money')],
        [/^\/more$/, t('nav.more')],
        [/^\/customers$/, t('nav.customers')],
        [/^\/parts$/, t('nav.parts')],
        [/^\/reports$/, t('nav.reports')],
        [/^\/settings$/, t('nav.settings')],
        [/^\/orders\/[^/]+$/, t('order.title')],
        [/^\/customers\/[^/]+$/, t('nav.customers')],
      ];
      const hit = map.find(([re]) => re.test(pathname))?.[1];
      return hit && hit.length <= 12 ? hit : t('common.back');
    },
    [t],
  );
}

/* ---------------- Animation helpers ---------------- */

function slide(el: HTMLElement | null | undefined, from: string, to: string, ms: number, easing = EASE): Promise<void> {
  if (!el) return Promise.resolve();
  el.style.transform = from;
  const a = el.animate([{ transform: from }, { transform: to }], { duration: ms, easing, fill: 'forwards' });
  return a.finished.then(
    () => {
      el.style.transform = to === 'none' ? '' : to;
      a.cancel();
    },
    () => undefined,
  );
}

function fade(el: Element | null | undefined, from: number, to: number, ms: number, easing = EASE): Promise<void> {
  if (!(el instanceof HTMLElement)) return Promise.resolve();
  el.style.opacity = String(from);
  const a = el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing, fill: 'forwards' });
  return a.finished.then(
    () => {
      el.style.opacity = to ? String(to) : '';
      a.cancel();
    },
    () => undefined,
  );
}

const dimOf = (el: HTMLElement | null | undefined) => el?.querySelector<HTMLElement>(':scope > .screen-dim');

/** The new screen first reads the device database; it slides in once it has its content (briefly). */
function contentReady(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (!el.querySelector('.skeleton-page') || performance.now() - start > 160) resolve();
      else window.setTimeout(tick, 16);
    };
    window.setTimeout(tick, 16);
  });
}

/* ---------------- One screen ---------------- */

function Screen({ entry, role, children }: { entry: Entry; role: 'top' | 'below' | 'out'; children: ReactNode }) {
  const [nav] = useState(() => {
    const d = document.createElement('div');
    d.className = 'screen-nav';
    return d;
  });
  const [bottom] = useState(() => {
    const d = document.createElement('div');
    d.className = 'screen-bottom';
    return d;
  });
  const ref = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.append(nav, bottom);
    return () => {
      nav.remove();
      bottom.remove();
    };
  }, [nav, bottom]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Screens under the one in front cannot be reached (focus, taps, screen readers).
    el.toggleAttribute('inert', role !== 'top');
  }, [role]);
  const modal = isModal(entry.location.pathname);
  const info = useMemo<ScreenInfo>(() => ({ nav, bottom, scroller, active: role === 'top', modal }), [nav, bottom, role, modal]);
  return (
    <section ref={ref} className="screen" data-id={entry.id} data-role={role} data-tabbar={showsTabBar(entry.location.pathname)} data-modal={isModal(entry.location.pathname) || undefined}>
      <div className="screen-scroll" ref={scroller}>
        <div className="screen-body">
          <ScreenContext.Provider value={info}>{children}</ScreenContext.Provider>
        </div>
      </div>
      <div className="screen-dim" aria-hidden />
    </section>
  );
}

/* ---------------- The stack ---------------- */

/** Where the back swipe starts: a strip along the left edge, like the iPhone's. */
const EDGE = 24;

export function PhoneStack({ render, onTop }: { render: (location: Location, entryId: string) => ReactNode; onTop?: (location: Location) => void }) {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const [model, setModel] = useState<Model>(() => ({ entries: [{ id: `${location.key || 'k'}-0`, location, idx: historyIdx() }], out: null, anim: null }));
  const modelRef = useRef(model);
  modelRef.current = model;
  const rootRef = useRef<HTMLDivElement>(null);
  const gestureFrom = useRef<string | null>(null);

  // Follow the history.
  useLayoutEffect(() => {
    const h = hint;
    hint = null;
    const from = gestureFrom.current;
    gestureFrom.current = null;
    setModel((m) => next(m, location, action, historyIdx(), h, from));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, location.pathname, location.search, location.hash]);

  const { entries, out, anim } = model;
  const top = entries[entries.length - 1];
  const below = entries.length > 1 ? entries[entries.length - 2] : undefined;
  // The screen under the one in front stays mounted, except right after a pop (it mounts once the animation ends).
  const mountBelow = below && (!anim || anim.outId === below.id);

  useEffect(() => onTop?.(top.location), [top.location, onTop]);

  const el = (id: string | undefined): HTMLElement | null => (id ? (rootRef.current?.querySelector<HTMLElement>(`:scope > .screen[data-id="${CSS.escape(id)}"]`) ?? null) : null);

  // Run the animation of the last navigation.
  useLayoutEffect(() => {
    if (!anim) return;
    const a = anim;
    const inEl = el(a.inId);
    const outEl = el(a.outId);
    // A screen that leaves the stack keeps its final place until it is unmounted (no flash back into view).
    const outLeaves = !!a.outId && !modelRef.current.entries.some((e) => e.id === a.outId);
    let cancelled = false;
    const clear = (s: HTMLElement) => {
      s.getAnimations().forEach((x) => x.cancel());
      s.style.visibility = '';
      s.style.transform = '';
      s.style.opacity = '';
      s.classList.remove('moving');
      const d = dimOf(s);
      if (d) {
        d.getAnimations().forEach((x) => x.cancel());
        d.style.opacity = '';
      }
    };
    // A navigation in the middle of another one starts from a clean state.
    rootRef.current?.querySelectorAll<HTMLElement>(':scope > .screen').forEach((s) => {
      if (s !== inEl && s !== outEl) clear(s);
    });
    const finish = () => {
      if (cancelled) return;
      if (inEl) clear(inEl);
      if (outEl) {
        if (outLeaves) outEl.style.visibility = 'hidden';
        else clear(outEl);
      }
      setModel((m) => (m.anim?.seq === a.seq ? { ...m, out: null, anim: null } : m));
    };
    // A hidden page does not animate (the next frame would only come when it is shown again).
    if (a.done || reducedMotion() || !inEl || document.hidden) {
      finish();
      return () => {
        cancelled = true;
      };
    }
    // Both screens take part: the one leaving or covered stays visible meanwhile.
    for (const s of [inEl, outEl]) if (s) s.style.visibility = 'visible';
    const w = rootRef.current?.clientWidth || window.innerWidth;
    void (async () => {
      if (a.kind === 'push' || a.kind === 'present') {
        inEl.style.transform = a.kind === 'push' ? 'translate3d(100%,0,0)' : 'translate3d(0,100%,0)';
        await contentReady(inEl);
        if (cancelled) return;
        inEl.classList.add('moving');
        if (a.kind === 'push') {
          await Promise.all([
            slide(inEl, 'translate3d(100%,0,0)', 'none', PUSH_MS),
            slide(outEl, 'none', `translate3d(${PARALLAX * w}px,0,0)`, PUSH_MS),
            fade(dimOf(outEl), 0, 1, PUSH_MS),
          ]);
        } else {
          await Promise.all([slide(inEl, 'translate3d(0,100%,0)', 'none', PRESENT_MS), fade(dimOf(outEl), 0, 0.6, PRESENT_MS)]);
        }
      } else if (a.kind === 'pop') {
        outEl?.classList.add('moving');
        await Promise.all([
          slide(outEl, 'none', 'translate3d(100%,0,0)', PUSH_MS),
          slide(inEl, `translate3d(${PARALLAX * w}px,0,0)`, 'none', PUSH_MS),
          fade(dimOf(inEl), 1, 0, PUSH_MS),
        ]);
      } else if (a.kind === 'dismiss') {
        await Promise.all([slide(outEl, 'none', 'translate3d(0,100%,0)', DISMISS_MS, 'cubic-bezier(0.4, 0, 1, 1)'), fade(dimOf(inEl), 0.6, 0, DISMISS_MS)]);
      } else {
        await fade(inEl, 0, 1, FADE_MS, 'ease-out');
      }
      finish();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim?.seq]);

  const back = useCallback(
    (fallback?: string) => {
      const m = modelRef.current;
      const t = m.entries[m.entries.length - 1];
      const p = m.entries[m.entries.length - 2];
      if (p && t) {
        navigate(Math.min(-1, p.idx - t.idx));
        return;
      }
      hintNavigation('pop');
      navigate(fallback ?? '/', { replace: true });
    },
    [navigate],
  );

  // The back swipe from the left edge.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let dx = 0;
    let lock: 'h' | 'v' | null = null;
    let topEl: HTMLElement | null = null;
    let prevEl: HTMLElement | null = null;
    const width = () => root.clientWidth || window.innerWidth;
    const finger = (e: TouchEvent) => Array.from(e.changedTouches).find((t) => t.identifier === id);
    const reset = () => {
      for (const s of [topEl, prevEl]) {
        if (!s) continue;
        s.style.transform = '';
        s.style.visibility = '';
        s.classList.remove('moving');
        const d = dimOf(s);
        if (d) d.style.opacity = '';
      }
      topEl = prevEl = null;
    };
    const place = (p: number) => {
      const w = width();
      if (topEl) topEl.style.transform = `translate3d(${Math.round(p * w)}px,0,0)`;
      if (prevEl) prevEl.style.transform = `translate3d(${Math.round(PARALLAX * w * (1 - p))}px,0,0)`;
      const d = dimOf(prevEl);
      if (d) d.style.opacity = String(1 - p);
    };

    const start = (e: TouchEvent) => {
      if (id !== -1 || e.touches.length !== 1) return;
      const m = modelRef.current;
      const t = e.touches[0];
      if (t.clientX > EDGE || m.anim || m.entries.length < 2) return;
      const topEntry = m.entries[m.entries.length - 1];
      if (isModal(topEntry.location.pathname) || layers.open > 0 || document.querySelector('.mantine-Modal-content, .mantine-Drawer-content')) return;
      // A signature, a slider or a drawing owns its strokes.
      if ((t.target as Element | null)?.closest?.('canvas, .sig-pad, input[type="range"], [data-no-swipe]')) return;
      id = t.identifier;
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = e.timeStamp;
      dx = 0;
      lock = null;
    };
    const move = (e: TouchEvent) => {
      if (id === -1) return;
      const t = finger(e);
      if (!t) return;
      const mx = t.clientX - x0;
      const my = t.clientY - y0;
      if (!lock) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        lock = mx > 0 && Math.abs(mx) > Math.abs(my) * 1.2 ? 'h' : 'v';
        if (lock === 'v') {
          id = -1;
          return;
        }
        const m = modelRef.current;
        topEl = el(m.entries[m.entries.length - 1]?.id);
        prevEl = el(m.entries[m.entries.length - 2]?.id);
        if (!topEl || !prevEl) {
          id = -1;
          lock = null;
          return;
        }
        prevEl.style.visibility = 'visible';
        topEl.classList.add('moving');
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, mx);
      place(dx / width());
    };
    const end = (e: TouchEvent) => {
      if (id === -1 || !finger(e)) return;
      id = -1;
      if (lock !== 'h' || !topEl || !prevEl) {
        lock = null;
        return;
      }
      lock = null;
      const w = width();
      const p = dx / w;
      const speed = dx / Math.max(1, e.timeStamp - t0);
      const tEl = topEl;
      const pEl = prevEl;
      const commit = e.type !== 'touchcancel' && (p > 0.33 || (speed > 0.5 && p > 0.05));
      const ms = Math.max(160, Math.round(PUSH_MS * (commit ? 1 - p : p)));
      if (commit) {
        void Promise.all([
          slide(tEl, `translate3d(${Math.round(p * w)}px,0,0)`, 'translate3d(100%,0,0)', ms),
          slide(pEl, `translate3d(${Math.round(PARALLAX * w * (1 - p))}px,0,0)`, 'none', ms),
          fade(dimOf(pEl), 1 - p, 0, ms),
        ]).then(() => {
          // The screens are already where going back leaves them; the history catches up.
          tEl.style.transform = 'translate3d(100%,0,0)';
          const m = modelRef.current;
          gestureFrom.current = m.entries[m.entries.length - 1]?.id ?? null;
          back();
          // Nothing to go back to after all: put the screen back.
          window.setTimeout(() => {
            if (gestureFrom.current) {
              gestureFrom.current = null;
              topEl = tEl;
              prevEl = pEl;
              reset();
            }
          }, 600);
        });
      } else {
        void Promise.all([
          slide(tEl, `translate3d(${Math.round(p * w)}px,0,0)`, 'none', ms),
          slide(pEl, `translate3d(${Math.round(PARALLAX * w * (1 - p))}px,0,0)`, `translate3d(${PARALLAX * w}px,0,0)`, ms),
          fade(dimOf(pEl), 1 - p, 1, ms),
        ]).then(() => {
          topEl = tEl;
          prevEl = pEl;
          reset();
        });
      }
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    return () => {
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  const stack = useMemo<StackInfo>(() => ({ previous: below?.location, back }), [below?.location, back]);

  // Stable DOM order (bottom to top) keeps every screen's scroll position; z-index decides what is in front.
  const shown: { entry: Entry; role: 'top' | 'below' | 'out' }[] = [];
  if (mountBelow && below) shown.push({ entry: below, role: 'below' });
  shown.push({ entry: top, role: 'top' });
  if (out) shown.push({ entry: out, role: 'out' });
  const outAbove = anim && (anim.kind === 'pop' || anim.kind === 'dismiss');

  return (
    <StackContext.Provider value={stack}>
      <div className="stack" ref={rootRef} data-out={out ? (outAbove ? 'above' : 'below') : undefined}>
        {shown.map(({ entry, role }) => (
          <Screen key={entry.id} entry={entry} role={role}>
            {render(entry.location, entry.id)}
          </Screen>
        ))}
      </div>
    </StackContext.Provider>
  );
}

/* ---------------- The visible area and the keyboard ---------------- */

const editableFocused = () => {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
  if (a.tagName !== 'INPUT') return false;
  return !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test((a as HTMLInputElement).type);
};

/**
 * The app always covers exactly the visible part of the screen. While the keyboard is up the root
 * shrinks to the area above it (the action bar sits on the keyboard, the tab bar steps away, the
 * field stays in view); when it goes down everything returns.
 *
 * iPhone home-screen apps keep a short viewport after the keyboard until they are restarted (the
 * tab bar floats over a black band — WebKit, iOS 17–18), and iOS 26.0 leaves the visual viewport
 * offset: a forced re-layout of the full-screen root after the keyboard brings the full height back,
 * and the root follows the visual viewport whenever it is moved.
 */
export function useViewportSync() {
  useEffect(() => {
    const html = document.documentElement;
    const vv = window.visualViewport;
    const standalone = html.classList.contains('standalone');
    let maxH = window.innerHeight;
    let width = window.innerWidth;
    let frame = 0;
    let healTimer = 0;
    let kbWas = false;

    const apply = () => {
      frame = 0;
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        maxH = window.innerHeight;
      }
      // iPhone: the keyboard covers the page (visual viewport shrinks); Android: the page itself shrinks.
      const kb = editableFocused() && ((!!vv && window.innerHeight - vv.height > 100) || maxH - window.innerHeight > 150);
      const shifted = !!vv && (kb || vv.offsetTop > 1);
      html.classList.toggle('kb', kb);
      html.classList.toggle('vv', shifted);
      if (shifted && vv) {
        html.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
        html.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
      } else {
        html.style.removeProperty('--vv-top');
        html.style.removeProperty('--vv-h');
      }
      if (!kb) {
        maxH = Math.max(maxH, window.innerHeight);
        if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
      }
      // The field being typed into stays in view in its screen.
      if (kb && !kbWas) {
        const a = document.activeElement as HTMLElement | null;
        window.setTimeout(() => a?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 60);
      }
      kbWas = kb;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const heal = () => {
      if (!standalone || editableFocused() || maxH - window.innerHeight <= 4) return;
      const root = document.querySelector<HTMLElement>('.app-root');
      if (!root) return;
      const scrolls = Array.from(root.querySelectorAll<HTMLElement>('.screen-scroll, .scroll-tabs, .chip-row')).map((e) => [e, e.scrollTop, e.scrollLeft] as const);
      root.style.display = 'none';
      void root.offsetHeight;
      root.style.display = '';
      for (const [e, top, left] of scrolls) {
        e.scrollTop = top;
        e.scrollLeft = left;
      }
      schedule();
    };
    const onFocusOut = () => {
      window.clearTimeout(healTimer);
      healTimer = window.setTimeout(() => {
        apply();
        heal();
      }, 140);
    };
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', onFocusOut);
    apply();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(healTimer);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', onFocusOut);
      html.classList.remove('kb', 'vv');
    };
  }, []);
}
