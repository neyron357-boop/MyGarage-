import { useSyncExternalStore } from 'react';

/*
 * The PC's second tab (v0.80.3, the owner: «при открытии новой вкладки — не обязательно новый заказ: новая вкладка всего
 * приложения, чтобы можно было поискать что-то, быстро посмотреть… всё, что захочу»): the window in two, the right pane a
 * whole app of its own — its screens, its history — open while the left one goes where it likes. On this computer (not
 * the garage's data): open or not, and where the pane last was, come back after a reload.
 */

const KEY = 'mygarage.deskTwin';
const subs = new Set<() => void>();
/** Open: the address the pane starts at (fixed while it is open — the pane keeps its own history). Closed: null. */
let start: string | null = read();

function read(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.startsWith('/') ? v : null;
  } catch {
    return null;
  }
}
function keep(path: string | null) {
  try {
    if (path) localStorage.setItem(KEY, path);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: for this window only
  }
}

/** Open the second tab (at `path`; the board by default); open already — nothing changes. */
export function openTwin(path = '/') {
  if (start) return;
  start = path;
  keep(path);
  subs.forEach((f) => f());
}
export function closeTwin() {
  if (!start) return;
  start = null;
  keep(null);
  subs.forEach((f) => f());
}
/** Where the pane is now: kept for the next start (the open pane does not draw again for it). */
export function keepTwinPath(path: string) {
  if (start) keep(path);
}

/** The second tab: where it starts — null while it is closed. */
export function useTwin(): string | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => start,
  );
}
