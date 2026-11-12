import { useRef, type TouchEvent } from 'react';
import { haptic } from './haptics';

/** Things that take a sideways drag themselves: the tab swipe leaves them alone. */
const OWN_SWIPE = '.chip-row:not(.wrap), .scroll-tabs, .today-strip, .swipe-row, .kanban, .strip-row, input, textarea, select, [role="slider"]';

/**
 * Tabs under a row of pills move like pages: a swipe to the left opens the next tab, to the right the
 * previous one — the content follows the finger a little, and the tab that opens slides in from the side
 * it comes from (also when its pill is tapped). The swipe is decided by the first points of the move, so
 * scrolling up and down is not disturbed; the strip along the left edge stays with "Back".
 *
 * `enter` is the class for the panel (keyed by the tab, so it mounts anew): `step-next`, `step-prev`,
 * or `fade-enter` the first time.
 */
export function useTabSwipe(order: readonly string[], value: string, onChange: (v: string) => void) {
  const at = order.indexOf(value);
  const prev = useRef(at);
  const dir = useRef<'next' | 'prev' | undefined>(undefined);
  if (prev.current !== at) {
    dir.current = at > prev.current ? 'next' : 'prev';
    prev.current = at;
  }
  const g = useRef<{ x: number; y: number; t: number; axis?: 'x' | 'y'; el: HTMLElement } | null>(null);
  const shift = (el: HTMLElement, dx: number) => {
    el.style.transition = dx ? 'none' : 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  };
  const handlers = {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      g.current = null;
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || t.clientX < 28) return;
      if ((e.target as HTMLElement).closest?.(OWN_SWIPE)) return;
      g.current = { x: t.clientX, y: t.clientY, t: performance.now(), el: e.currentTarget };
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      const s = g.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        s.axis = Math.abs(dx) > Math.abs(dy) * 1.6 ? 'x' : 'y';
      }
      if (s.axis !== 'x') return;
      // The content comes along a little; where there is no tab that way it barely moves.
      const none = (dx < 0 && at >= order.length - 1) || (dx > 0 && at <= 0);
      shift(s.el, dx * (none ? 0.08 : 0.32));
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const s = g.current;
      g.current = null;
      if (!s || s.axis !== 'x') return;
      const t = e.changedTouches[0];
      const dx = (t?.clientX ?? s.x) - s.x;
      const fast = Math.abs(dx) / Math.max(1, performance.now() - s.t) > 0.5;
      const to = dx < 0 ? at + 1 : at - 1;
      shift(s.el, 0);
      if ((Math.abs(dx) > 72 || (fast && Math.abs(dx) > 28)) && to >= 0 && to < order.length) {
        haptic('selection');
        onChange(order[to]);
      }
    },
    onTouchCancel: () => {
      if (g.current) shift(g.current.el, 0);
      g.current = null;
    },
  };
  return { handlers, enter: dir.current === 'next' ? 'step-next' : dir.current === 'prev' ? 'step-prev' : 'fade-enter' };
}
