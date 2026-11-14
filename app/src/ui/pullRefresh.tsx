import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from './haptics';
import { useScreen } from './stack';

/*
 * Pull to refresh, as the iPhone's lists do it: at the top of the screen a pull down takes the whole
 * page with the finger (against a rubber band), and the spinner's spokes appear one by one in the room it
 * leaves; past the line they are all there, and letting go holds the page down while the spinner turns,
 * then it springs back. A pull that falls short just springs back. Elsewhere the list keeps its own
 * rubber band. Under the finger everything is written into the elements' style, not React state.
 *
 * `onRefresh` is what the pull does (the spinner turns at least a moment, so it is seen). Phone screens
 * only (the stack's scroll view); on a PC it renders nothing.
 */

const LINE = 64; // how far (after the rubber band) the page must come down to refresh
const HOLD = 52; // where the page waits while refreshing
const MIN_SPIN = 650;
const SPOKES = 12;

/** The iPhone's rubber band: the page follows less and less the further it is pulled. */
const rubber = (dy: number) => (1 - 1 / ((dy * 0.55) / 320 + 1)) * 320;

export function usePullRefresh(onRefresh: () => Promise<unknown> | unknown): ReactNode {
  const screen = useScreen();
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  // The screen's scroll view exists once the screen is on the page: the spinner goes into it then.
  const [host, setHost] = useState<HTMLElement | null>(null);
  // The spinner, once it is on the page (the screen may first show its skeleton, without it).
  const [mark, setMark] = useState<HTMLDivElement | null>(null);
  useEffect(() => setHost(screen?.scroller.current ?? null), [screen]);

  useEffect(() => {
    const scroller = host;
    const page = scroller?.firstElementChild as HTMLElement | null;
    if (!screen || !scroller || !page || !mark) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let armed = false;
    let busy = false;
    const place = (y: number, animate: boolean) => {
      // The page comes down; the glow under its title stays at the top of the screen (`--pull`).
      page.style.transition = animate ? 'transform 420ms var(--ease-ios), --pull 420ms var(--ease-ios)' : 'none';
      page.style.transform = y ? `translate3d(0, ${y}px, 0)` : '';
      page.style.setProperty('--pull', `${y}px`);
      mark.style.transition = animate ? 'opacity 260ms ease, transform 420ms var(--ease-ios)' : 'none';
      mark.style.transform = `translate3d(0, ${Math.max(0, y / 2 - 14)}px, 0)`;
    };
    const show = (p: number) => {
      mark.style.setProperty('--p', String(p));
      mark.style.opacity = p > 0.02 ? '1' : '0';
    };
    const settle = () => {
      place(0, true);
      show(0);
      mark.removeAttribute('data-spinning');
      window.setTimeout(() => {
        if (busy || pulling) return;
        page.style.transition = '';
        page.style.transform = '';
        page.style.removeProperty('--pull');
      }, 440);
    };
    const onStart = (e: TouchEvent) => {
      start = null;
      if (busy || !screen.front() || e.touches.length !== 1 || scroller.scrollTop > 0) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!pulling) {
        // Decided on the very first move (the iPhone commits to its own scrolling then): a pull down, more
        // down than sideways — a row's swipe and the stack's swipe are left alone.
        if (dy <= 0 || Math.abs(dx) > dy || scroller.scrollTop > 0 || !e.cancelable) {
          start = null;
          return;
        }
        pulling = true;
        armed = false;
      } else if (Math.abs(dx) > Math.abs(dy) + 24) {
        // It turned into a sideways swipe after all: the page goes back, the swipe goes on.
        pulling = false;
        start = null;
        settle();
        return;
      }
      if (e.cancelable) e.preventDefault();
      const y = rubber(Math.max(0, dy));
      place(y, false);
      show(Math.min(1, y / LINE));
      if (!armed && y >= LINE) {
        armed = true;
        haptic('light');
      } else if (armed && y < LINE) armed = false;
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      start = null;
      if (!armed) return settle();
      busy = true;
      place(HOLD, true);
      show(1);
      mark.setAttribute('data-spinning', '');
      void Promise.all([Promise.resolve().then(() => refresh.current()), new Promise((r) => window.setTimeout(r, MIN_SPIN))])
        .catch(() => undefined)
        .finally(() => {
          busy = false;
          settle();
        });
    };
    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd, { passive: true });
    scroller.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
      page.style.transition = '';
      page.style.transform = '';
      page.style.removeProperty('--pull');
    };
  }, [screen, host, mark]);

  if (!host) return null;
  return createPortal(
    <div ref={setMark} className="pull-spinner" aria-hidden>
      {Array.from({ length: SPOKES }, (_, i) => (
        <i key={i} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </div>,
    host,
  );
}
