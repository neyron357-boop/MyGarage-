import { useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { haptic } from './haptics';

/*
 * Swipe a row left, like the iPhone's lists: a short swipe opens its action button on the right, a long
 * one (past half the row) does the action at once. The direction is decided by the first few points of
 * the move, so scrolling the list is not disturbed. A tap on an open row only closes it.
 *
 * The row sets `style` (the offset as --swipe) and `data-swiping`; its children slide (CSS), the action
 * layer under them (`.swipe-action`) grows from the right.
 */
export function useSwipeAction(onCommit: () => void, actionWidth = 92) {
  const [dx, setDxState] = useState(0);
  const [dragging, setDragging] = useState(false);
  const off = useRef(0);
  const start = useRef<{ x: number; y: number; base: number; w: number; axis?: 'x' | 'y'; past?: boolean } | null>(null);
  const swiped = useRef(false);
  const setDx = (v: number) => {
    off.current = v;
    setDxState(v);
  };
  const commit = (w: number) => {
    setDragging(false);
    setDx(-w);
    haptic('light');
    window.setTimeout(() => {
      onCommit();
      setDx(0);
    }, 200);
  };
  const handlers = {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, base: off.current, w: e.currentTarget.offsetWidth };
      swiped.current = false;
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const mx = t.clientX - s.x;
      const my = t.clientY - s.y;
      if (!s.axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      }
      if (s.axis !== 'x') return;
      swiped.current = true;
      setDragging(true);
      let v = Math.min(0, s.base + mx);
      // Past the row's width it resists, as a rubber band.
      if (v < -s.w) v = -s.w + (v + s.w) * 0.25;
      const past = v < -s.w * 0.5;
      if (past !== !!s.past) {
        s.past = past;
        haptic('selection');
      }
      setDx(v);
    },
    onTouchEnd: () => {
      const s = start.current;
      start.current = null;
      if (!s || s.axis !== 'x') return;
      setDragging(false);
      if (off.current < -s.w * 0.5) commit(s.w);
      else setDx(off.current < -actionWidth / 2 ? -actionWidth : 0);
    },
    onTouchCancel: () => {
      start.current = null;
      setDragging(false);
      setDx(0);
    },
  };
  return {
    handlers,
    style: { '--swipe': `${dx}px` } as CSSProperties,
    dragging,
    open: dx !== 0,
    close: () => setDx(0),
    /** The click that ends a swipe, or a tap on an open row, is not a tap on the row. */
    consumeClick: () => {
      if (swiped.current) {
        swiped.current = false;
        return true;
      }
      if (off.current !== 0) {
        setDx(0);
        return true;
      }
      return false;
    },
  };
}
