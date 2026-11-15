import { useRef, type TouchEvent } from 'react';
import { haptic } from './haptics';

/** How far the finger takes a message before letting go answers it — and the most it moves. */
const ARM = 64;
const MAX = 92;

/**
 * Swipe a message to the right to answer it, as in a messenger: the message follows the finger (stiffer past the
 * point), its arrow comes up beside it (`--reply`, 0–1, on the element — for the arrow's look), a tick when the
 * point is passed; let go past it — `onReply`; the message springs back either way. Only a drag that starts
 * sideways to the right takes it — a scroll stays a scroll — and never on a slider (a voice note's place) or a
 * video. The element moves by its own style, not by React (the finger is followed frame by frame).
 */
export function useSwipeReply(onReply: () => void, enabled = true) {
  const g = useRef<{ x0: number; y0: number; el: HTMLElement; axis?: 'x' | 'y'; armed: boolean } | null>(null);
  const place = (el: HTMLElement, dx: number, back: boolean) => {
    el.style.transition = back ? 'transform 280ms var(--ease-out)' : 'none';
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
    el.style.setProperty('--reply', String(Math.min(1, dx / ARM)));
  };
  const release = (answer: boolean) => {
    const s = g.current;
    g.current = null;
    if (!s || s.axis !== 'x') return;
    place(s.el, 0, true);
    if (answer && s.armed) onReply();
  };
  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      g.current = null;
      if (!enabled || e.touches.length !== 1 || (e.target as Element).closest?.('[role="slider"], video')) return;
      g.current = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, el: e.currentTarget, armed: false };
    },
    onTouchMove: (e: TouchEvent<HTMLElement>) => {
      const s = g.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x0;
      const dy = t.clientY - s.y0;
      if (!s.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        s.axis = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (s.axis === 'y') {
          g.current = null;
          return;
        }
      }
      const pull = dx <= 0 ? 0 : dx <= ARM ? dx : ARM + (dx - ARM) * 0.35;
      place(s.el, Math.min(MAX, pull), false);
      const armed = dx >= ARM;
      if (armed && !s.armed) haptic('light');
      s.armed = armed;
    },
    onTouchEnd: () => release(true),
    onTouchCancel: () => release(false),
  };
}
