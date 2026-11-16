import { useSyncExternalStore } from 'react';

/*
 * How the board looks on this device («Вид» in the board's head, v0.22): the cards large (the photo is the
 * card, 2 : 1) or compact (rows with a small photo), and the board's tabs — their order and which steps are
 * shown. «Все» is always first; «Долги» and «Архив» are always there (the only way to their lists — a job
 * swiped off the board must not vanish). Kept like the accent: on the device only, not in the backup.
 */

export const BOARD_TABS = ['all', 'look', 'price', 'wait', 'work', 'pay', 'out', 'booked', 'debts', 'archive'] as const;
export type BoardTab = (typeof BOARD_TABS)[number];
export type CardSize = 'large' | 'compact';

export interface BoardView {
  /** Every tab in the order the strip shows them, «Все» first. */
  order: BoardTab[];
  /** Steps the strip leaves out (their cars stay under «Все»). */
  hidden: BoardTab[];
  size: CardSize;
}

/** Tabs that can be left out of the strip: the steps (never «Все», «Долги», «Архив»). */
export const canHide = (k: BoardTab) => k !== 'all' && k !== 'debts' && k !== 'archive';

export const DEFAULT_VIEW: BoardView = { order: [...BOARD_TABS], hidden: [], size: 'large' };

const known = (x: unknown): x is BoardTab => typeof x === 'string' && (BOARD_TABS as readonly string[]).includes(x);

/**
 * Whatever was stored, made whole: unknown and repeated tabs dropped, «Все» first, a tab the stored order does
 * not know (one a later version added) put after its neighbour of the default order; only steps hidden.
 */
export function normalizeBoardView(raw: unknown): BoardView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const order: BoardTab[] = ['all', ...new Set((Array.isArray(r.order) ? r.order : []).filter(known).filter((k) => k !== 'all'))];
  BOARD_TABS.forEach((k, i) => {
    if (order.includes(k)) return;
    let at = order.length;
    for (let j = i - 1; j >= 0; j--) {
      const p = order.indexOf(BOARD_TABS[j]);
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    order.splice(at, 0, k);
  });
  const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter(known).filter(canHide))];
  const size: CardSize = r.size === 'compact' ? 'compact' : 'large';
  return { order, hidden, size };
}

const KEY = 'mygarage.board';
const EVENT = 'mygarage:board';

function read(): BoardView {
  try {
    const s = localStorage.getItem(KEY);
    return s ? normalizeBoardView(JSON.parse(s)) : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/** The view now — one object while it does not change (the board renders from it). */
let current: BoardView | undefined;

export function setBoardView(patch: Partial<BoardView>): void {
  const next = normalizeBoardView({ ...(current ??= read()), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode: the choice lasts until the app is closed
  }
  current = next;
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

export function useBoardView(): BoardView {
  return useSyncExternalStore(subscribe, () => (current ??= read()), () => DEFAULT_VIEW);
}
