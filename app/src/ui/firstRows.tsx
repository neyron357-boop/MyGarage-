import { useEffect, useState, type ReactNode } from 'react';

/** How many rows of a long list come with the screen. */
export const FIRST_ROWS = 10;

/**
 * A long list comes in two steps (v0.56, measured on a job of thirty parts at a phone's speed: its screen took one
 * 150 ms task to open — all thirty rows made and laid out before the first frame): its first rows with the screen, the
 * rest once that has been painted. False — only the first `FIRST_ROWS` are to be shown yet. A list a few rows longer
 * than that comes whole (not worth a second pass).
 *
 * `total` may be 0 at first (the data not read yet): the first time there is something to show decides it.
 */
export function useWholeList(total: number): boolean {
  const [state, setState] = useState<'wait' | 'first' | 'all'>('wait');
  if (state === 'wait' && total > 0) setState(total < FIRST_ROWS + 8 ? 'all' : 'first');
  useEffect(() => {
    if (state !== 'first') return;
    // Two frames: the screen's first one is painted (its transition has begun), then the rest is made.
    let second = 0;
    const one = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setState('all'));
    });
    return () => {
      cancelAnimationFrame(one);
      cancelAnimationFrame(second);
    };
  }, [state]);
  return state !== 'first';
}

/**
 * The rows of a long list in two steps (`useWholeList`). Its own component: the second step renders only the list —
 * the rows already shown are the same elements, so React passes them by — not the whole screen around it.
 * The rows are keyed elements, as a list's children are; more than six coming at once are not animated in (`ui/motion`).
 */
export function FirstRows({ rows }: { rows: ReactNode[] }) {
  const whole = useWholeList(rows.length);
  return <>{whole ? rows : rows.slice(0, FIRST_ROWS)}</>;
}
