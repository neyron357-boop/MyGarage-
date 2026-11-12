import type { Icon } from '@tabler/icons-react';
import { useEffect, useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { haptic } from './haptics';

/** What a swipe on a row does: the button it uncovers (icon, one word, colour) and its action. */
export interface SwipeSpec {
  label: string;
  icon: Icon;
  color: string;
  onCommit: () => void;
  /** A long swipe does it at once (default). `false` — the swipe only uncovers the button (no way back after it). */
  full?: boolean;
}

/*
 * Swipe a row, like the iPhone's lists. To the left it uncovers the trailing action, to the right the
 * leading one: a short swipe leaves the button open, a long one (past half the row) does the action at
 * once — with a tick of the haptic engine as the finger crosses the line. The direction is decided by
 * the first few points of the move, so scrolling the list is not disturbed. A tap on an open row only
 * closes it.
 *
 * The row sets `style` (the offset as --swipe), `data-swiping` and `data-past`; its children slide
 * (CSS, `.swipe-row`), the action layers under them (`.swipe-action`) grow from their edge.
 *
 * Under the finger the offset is written straight to the row (its --swipe), frame by frame: the row is
 * not rendered again while it follows the finger — only when it starts, crosses the line and comes to rest.
 */
export function useSwipeRow(spec: { trailing?: Pick<SwipeSpec, 'onCommit' | 'full'>; leading?: Pick<SwipeSpec, 'onCommit' | 'full'> }, actionWidth = 88) {
  // Where the row rests (shut, a button open, flown out) — a render; where the finger has it — no render.
  const [rest, setRest] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [past, setPast] = useState(false);
  const off = useRef(0);
  const row = useRef<HTMLElement | null>(null);
  const start = useRef<{ x: number; y: number; base: number; w: number; axis?: 'x' | 'y'; past?: boolean } | null>(null);
  const swiped = useRef(false);
  const live = useRef(spec);
  live.current = spec;
  const follow = (v: number) => {
    off.current = v;
    row.current?.style.setProperty('--swipe', `${v}px`);
  };
  // To a place of rest: it eases there (the finger's "no transition" is lifted in the same frame).
  const setDx = (v: number) => {
    row.current?.removeAttribute('data-swiping');
    follow(v);
    setRest(v);
  };
  const sideOf = (v: number) => (v < 0 ? live.current.trailing : v > 0 ? live.current.leading : undefined);
  const commit = (to: number) => {
    const side = sideOf(to);
    setDragging(false);
    setDx(to);
    haptic('light');
    window.setTimeout(() => {
      side?.onCommit();
      setPast(false);
      setDx(0);
    }, 180);
  };
  const handlers = {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      swiped.current = false;
      start.current = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      // The strip along the left edge belongs to "Back" (ui/stack): a touch there never swipes a row.
      if (t.clientX < 28) return;
      row.current = e.currentTarget;
      start.current = { x: t.clientX, y: t.clientY, base: off.current, w: e.currentTarget.offsetWidth };
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
      let v = s.base + mx;
      // Only the sides that have an action move; the other way the row resists like a rubber band.
      if (v < 0 && !live.current.trailing) v = v * 0.12;
      if (v > 0 && !live.current.leading) v = v * 0.12;
      if (Math.abs(v) > s.w) v = Math.sign(v) * (s.w + (Math.abs(v) - s.w) * 0.25);
      swiped.current = true;
      if (!dragging) row.current?.setAttribute('data-swiping', 'true');
      setDragging(true);
      const side = sideOf(v);
      const isPast = !!side && side.full !== false && Math.abs(v) > s.w * 0.5;
      if (isPast !== !!s.past) {
        s.past = isPast;
        setPast(isPast);
        haptic('selection');
      }
      follow(v);
    },
    onTouchEnd: () => {
      const s = start.current;
      start.current = null;
      if (!s || s.axis !== 'x') return;
      setDragging(false);
      const v = off.current;
      const side = sideOf(v);
      if (!side) return setDx(0);
      if (side.full !== false && Math.abs(v) > s.w * 0.5) commit(Math.sign(v) * s.w);
      else {
        setPast(false);
        setDx(Math.abs(v) > actionWidth / 2 ? Math.sign(v) * actionWidth : 0);
      }
    },
    onTouchCancel: () => {
      start.current = null;
      setDragging(false);
      setPast(false);
      setDx(0);
    },
  };
  return {
    handlers,
    style: { '--swipe': `${rest}px` } as CSSProperties,
    dragging,
    past,
    /** Which side's button is uncovered. */
    open: rest < 0 ? ('trailing' as const) : rest > 0 ? ('leading' as const) : undefined,
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

const HINT_KEY = 'mygarage.swipeHint';

/**
 * Once on a device, the first row that can be swiped shows it: it slides a little to the left — the
 * action peeks out — and comes back (the way iOS hints at a swipe, instead of a line of text). Only
 * under a finger (a touch screen), never with reduced motion.
 */
export function useSwipeHint(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof matchMedia !== 'function') return;
    if (!matchMedia('(pointer: coarse)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      if (localStorage.getItem(HINT_KEY)) return;
    } catch {
      return;
    }
    let back = 0;
    const show = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>('.screen[data-role="top"] .list-row.swipe-row');
      if (!row) return;
      row.style.setProperty('--swipe', '-60px');
      back = window.setTimeout(() => row.style.setProperty('--swipe', '0px'), 640);
      try {
        localStorage.setItem(HINT_KEY, '1');
      } catch {
        // the hint simply shows again next time
      }
    }, 1100);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(back);
    };
  }, [ready]);
}

/** A row swiped to the left only (the board's "to the archive"). */
export function useSwipeAction(onCommit: () => void, actionWidth = 92) {
  const sw = useSwipeRow({ trailing: { onCommit } }, actionWidth);
  return { ...sw, open: sw.open === 'trailing' };
}
