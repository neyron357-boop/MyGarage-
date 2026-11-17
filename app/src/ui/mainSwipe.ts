import type { NavigateFunction } from 'react-router-dom';
import { haptic } from './haptics';
import { ownsSideways } from './swipe';

/*
 * Swipes between the tab bar's places (v0.30, the user's call): a sideways swipe on a tab's own screen (Board, Search,
 * Money, More) opens the tab beside it — the new one slides in from its side, the screen follows the finger a little
 * on the way. What takes a sideways drag itself keeps it: a card or a row with its own swipe, a strip of chips, the
 * pages of a tab with pages of its own (Money's) — those hand the swipe on here only past their first or last page
 * (`useTabSwipe`'s `onEdge`). The strip along the left edge is "Back"'s.
 */

/** The tab bar's places, in its order. */
export const MAIN_TABS = ['/', '/search', '/money', '/more'] as const;

/** What a sideways swipe never takes from. */
const OWN =
  '.chip-row:not(.wrap), .scroll-tabs, .today-strip, .swipe-row, .note-swipe, .kanban, .strip-row, [data-sort-id], input, textarea, select, [role="slider"], video, audio, [controls], .tab-panel, .job-panel, [data-own-swipe], .tab-bar-wrap';
const EDGE = 28;
const SLOP = 10;
/** Let go this far — or flung — and the next tab opens. */
const COMMIT = 72;
const FLING = 0.45;
const FLING_MIN = 30;
/** How much of the finger's way the screen follows (a hint of the move, not a page turn). */
const FOLLOW = 0.28;

/** Where `dir` (1 — to the right of the bar, −1 — to the left) leads from `path`, if anywhere. */
export function mainTabBeside(path: string, dir: 1 | -1): string | undefined {
  const i = MAIN_TABS.indexOf(path as (typeof MAIN_TABS)[number]);
  if (i < 0) return undefined;
  return MAIN_TABS[i + dir];
}

/** The navigation hint the stack's slide takes (set by the caller just before navigating). */
export type SlideHint = 'tab-next' | 'tab-prev';

/** Open the tab beside: the new one slides in from that side. */
export function stepMainTab(navigate: NavigateFunction, hint: (h: SlideHint) => void, path: string, dir: 1 | -1): boolean {
  const to = mainTabBeside(path, dir);
  if (!to) return false;
  haptic('selection');
  hint(dir > 0 ? 'tab-next' : 'tab-prev');
  navigate(to);
  return true;
}

/**
 * The swipe on the stack's root: `top` — the screen in front (its element and path), `go` — open the tab beside.
 * Returns the remover.
 */
export function watchMainSwipe(root: HTMLElement, top: () => { el: HTMLElement | null; path: string }, go: (dir: 1 | -1) => void): () => void {
  let g: { id: number; x0: number; y0: number; axis?: 'x' | 'y'; el: HTMLElement; samples: [number, number][]; dx: number } | null = null;
  const reset = (el: HTMLElement) => {
    el.animate([{ transform: el.style.transform || 'none' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    el.style.transform = '';
  };
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 1) return void (g = null);
    const t = e.touches[0];
    const now = top();
    if (!now.el || !MAIN_TABS.includes(now.path as (typeof MAIN_TABS)[number])) return;
    if (t.clientX < EDGE || t.clientX > window.innerWidth - 8) return;
    if (ownsSideways(e.target, t.clientX, OWN)) return;
    g = { id: t.identifier, x0: t.clientX, y0: t.clientY, el: now.el, samples: [[e.timeStamp, 0]], dx: 0 };
  };
  const move = (e: TouchEvent) => {
    if (!g) return;
    const t = Array.from(e.touches).find((x) => x.identifier === g!.id);
    if (!t) return;
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(dx, dy) < SLOP) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
      if (g.axis === 'y') return void (g = null);
    }
    g.dx = dx;
    g.samples.push([e.timeStamp, dx]);
    if (g.samples.length > 6) g.samples.shift();
    // Where there is no tab that way, it gives way less (a rubber band).
    const path = top().path;
    const way = mainTabBeside(path, dx < 0 ? 1 : -1) ? FOLLOW : FOLLOW / 3;
    g.el.style.transform = `translate3d(${dx * way}px,0,0)`;
  };
  const end = (e: TouchEvent) => {
    const s = g;
    g = null;
    if (!s || s.axis !== 'x' || !Array.from(e.changedTouches).some((x) => x.identifier === s.id)) return;
    const [t0, x0] = s.samples[0];
    const [t1, x1] = s.samples[s.samples.length - 1];
    const v = t1 - t0 >= 8 ? (x1 - x0) / (t1 - t0) : 0;
    const dir: 1 | -1 = s.dx < 0 ? 1 : -1;
    const flung = Math.abs(v) > FLING && Math.sign(v) === Math.sign(s.dx) && Math.abs(s.dx) > FLING_MIN;
    if ((Math.abs(s.dx) > COMMIT || flung) && mainTabBeside(top().path, dir)) go(dir);
    else reset(s.el);
  };
  const cancel = () => {
    if (g?.axis === 'x') reset(g.el);
    g = null;
  };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: true });
  root.addEventListener('touchend', end, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    root.removeEventListener('touchstart', start);
    root.removeEventListener('touchmove', move);
    root.removeEventListener('touchend', end);
    root.removeEventListener('touchcancel', cancel);
  };
}
