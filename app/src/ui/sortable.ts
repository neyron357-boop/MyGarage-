import { useLayoutEffect, useRef } from 'react';
import { haptic } from './haptics';

/*
 * Rows moved by hand, as in the iPhone's lists in edit mode: a grip (≡) at the row's end — the row lifts
 * under the finger, the others make way, the screen scrolls by itself near its edges; let go and the rows
 * settle in their new places, then `onMove(ids)` saves the new order. Everything under the finger is
 * written into the rows' style (transforms), not React state. The rows stay where the finger left them
 * until the list comes back in the new order, so nothing jumps; keep the list's own animation off while
 * sorting (`<List animate={false}>`).
 *
 * The grip goes inside the row (a `.list-row`, a child of the list) with `data-sort-id`; the rows that
 * carry a grip are the ones that move, in the order they stand.
 */

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SETTLE = 230;

interface Drag {
  pointer: number;
  rows: HTMLElement[];
  ids: string[];
  tops: number[];
  heights: number[];
  from: number;
  to: number;
  startY: number;
  lastY: number;
  scroller: HTMLElement | null;
  startScroll: number;
  raf: number;
}

const scrollerOf = (el: HTMLElement): HTMLElement | null => el.closest<HTMLElement>('.screen-scroll');
const scrollTop = (s: HTMLElement | null) => (s ? s.scrollTop : window.scrollY);

function rowsOf(grip: HTMLElement): { rows: HTMLElement[]; ids: string[] } | null {
  const row = grip.closest<HTMLElement>('.list-row');
  const list = row?.parentElement;
  if (!row || !list) return null;
  const rows = ([...list.children] as HTMLElement[]).filter((c) => c.querySelector('[data-sort-id]'));
  return { rows, ids: rows.map((r) => r.querySelector<HTMLElement>('[data-sort-id]')!.dataset.sortId!) };
}

function clear(rows: HTMLElement[]) {
  for (const r of rows) {
    r.classList.remove('sort-lift');
    r.style.transition = 'none';
    r.style.transform = '';
    r.style.zIndex = '';
  }
  // The next change of place may slide again.
  void rows[0]?.offsetHeight;
  for (const r of rows) r.style.transition = '';
}

export function useSortable(ids: string[], onMove: (ids: string[]) => void) {
  const drag = useRef<Drag | null>(null);
  const pending = useRef<{ rows: HTMLElement[]; timer: number } | null>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const key = ids.join('|');
  // The list is back in the new order: the rows stand there now, their offsets go.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.clearTimeout(p.timer);
    clear(p.rows);
  }, [key]);

  /** Where the finger is: the row under it, the others out of its way. */
  const follow = (d: Drag) => {
    const last = d.rows.length - 1;
    const min = d.tops[0] - d.tops[d.from];
    const max = d.tops[last] + d.heights[last] - (d.tops[d.from] + d.heights[d.from]);
    const dy = Math.min(max, Math.max(min, d.lastY - d.startY + scrollTop(d.scroller) - d.startScroll));
    d.rows[d.from].style.transform = `translate3d(0, ${dy}px, 0)`;
    // A row makes way once the held one covers half of it (its edge passes the row's middle), as on the iPhone.
    const h = d.heights[d.from];
    const top = d.tops[d.from] + dy;
    const bottom = top + h;
    let to = d.from;
    d.rows.forEach((r, k) => {
      if (k === d.from) return;
      const middle = d.tops[k] + d.heights[k] / 2;
      let shift = 0;
      if (k < d.from && top < middle) shift = h;
      if (k > d.from && bottom > middle) shift = -h;
      if (shift > 0) to = Math.min(to, k);
      if (shift < 0) to = Math.max(to, k);
      r.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
    });
    if (to !== d.to) {
      d.to = to;
      haptic('selection');
    }
  };

  /** Near the top or the bottom of the screen the list scrolls on by itself while the row is held there. */
  const edgeScroll = (d: Drag) => {
    const box = d.scroller ? d.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    // The bottom keeps clear of the bar and the tab bar that float over the list.
    const up = d.lastY - (box.top + 90);
    const down = d.lastY - (box.bottom - 170);
    const speed = up < 0 ? Math.max(-14, up / 6) : down > 0 ? Math.min(14, down / 6) : 0;
    if (speed) {
      if (d.scroller) d.scroller.scrollTop += speed;
      else window.scrollBy(0, speed);
      follow(d);
    }
    d.raf = requestAnimationFrame(() => edgeScroll(d));
  };

  const drop = (cancel: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    const row = d.rows[d.from];
    row.classList.remove('sort-lift');
    row.style.transition = `transform ${SETTLE - 30}ms ${EASE}`;
    if (cancel || d.to === d.from) {
      for (const r of d.rows) r.style.transform = '';
      window.setTimeout(() => clear(d.rows), SETTLE);
      return;
    }
    // The row slides into its slot, the others are already in theirs; then the new order is saved.
    const top = d.to > d.from ? d.tops[d.to] + d.heights[d.to] - d.heights[d.from] : d.tops[d.to];
    row.style.transform = `translate3d(0, ${top - d.tops[d.from]}px, 0)`;
    const next = [...d.ids];
    next.splice(d.to, 0, next.splice(d.from, 1)[0]);
    // Should the order not come back (a failed save), the rows go back to where they stand.
    pending.current = { rows: d.rows, timer: window.setTimeout(() => (pending.current = null, clear(d.rows)), SETTLE + 1500) };
    window.setTimeout(() => move.current(next), SETTLE);
  };

  /** The grip's handlers: drag it (finger or mouse), or move the row with the arrow keys. */
  return (id: string) => ({
    'data-sort-id': id,
    role: 'button' as const,
    tabIndex: 0,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (drag.current || pending.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const found = rowsOf(e.currentTarget);
      if (!found) return;
      const from = found.ids.indexOf(id);
      if (from < 0 || found.rows.length < 2) return;
      // A drag handle, not a tap: no text selection, no scroll (touch-action) under it.
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const scroller = scrollerOf(e.currentTarget);
      const d: Drag = {
        pointer: e.pointerId,
        ...found,
        tops: found.rows.map((r) => r.offsetTop),
        heights: found.rows.map((r) => r.offsetHeight),
        from,
        to: from,
        startY: e.clientY,
        lastY: e.clientY,
        scroller,
        startScroll: scrollTop(scroller),
        raf: 0,
      };
      found.rows.forEach((r, k) => {
        r.style.transition = k === from ? 'none' : `transform 220ms ${EASE}`;
        if (k === from) r.style.zIndex = '2';
      });
      found.rows[from].classList.add('sort-lift');
      drag.current = d;
      haptic('medium');
      d.raf = requestAnimationFrame(() => edgeScroll(d));
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      d.lastY = e.clientY;
      follow(d);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => drag.current?.pointer === e.pointerId && drop(false),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => drag.current?.pointer === e.pointerId && drop(true),
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => drag.current?.pointer === e.pointerId && drop(false),
    // The row under the grip is not tapped by it.
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      const found = rowsOf(e.currentTarget);
      if (!found) return;
      const from = found.ids.indexOf(id);
      const to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (from < 0 || to < 0 || to >= found.ids.length) return;
      const next = [...found.ids];
      next.splice(to, 0, next.splice(from, 1)[0]);
      move.current(next);
    },
  });
}
