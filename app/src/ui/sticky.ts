import { useEffect, type RefObject } from 'react';

/**
 * A sticky bar that knows when it is stuck: `data-stuck` on it while the content passes under it, so that
 * its backing shows only then — at rest it sits on the screen's glow like the rest of the header. `mark` is
 * an empty element just above the bar: once it has gone under the bar's line, the bar is stuck. Works in a
 * phone screen's own scroll view and in the window (a computer).
 */
export function useStuck(mark: RefObject<HTMLElement>, bar: RefObject<HTMLElement>, ready = true): void {
  useEffect(() => {
    const m = mark.current;
    const el = bar.current;
    if (!ready || !m || !el || typeof IntersectionObserver === 'undefined') return;
    const root = el.closest<HTMLElement>('.screen-scroll');
    const top = Math.round(parseFloat(getComputedStyle(el).top) || 0);
    const io = new IntersectionObserver(
      ([e]) => {
        const line = (e.rootBounds?.top ?? 0) + top;
        el.toggleAttribute('data-stuck', !e.isIntersecting && e.boundingClientRect.top < line);
      },
      { root, rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(m);
    return () => {
      io.disconnect();
      el.removeAttribute('data-stuck');
    };
  }, [mark, bar, ready]);
}
