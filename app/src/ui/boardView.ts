import { useSyncExternalStore } from 'react';

/*
 * How the board looks on this device («Вид» in the board's head, v0.22): the cards large (the photo is the
 * card, 2 : 1) or compact (rows with a small photo), and the board's tabs — their order and which are shown.
 * «Все» is always first; «Архив» is always there (the only way to its list — a job swiped off the board must not
 * vanish). v0.70 (the user: «не так уж много вкладок — пару самых важных… в работе, ожидания, архив, все… и заявки»):
 * the tabs the manager puts jobs in — «В работе», «Ожидание», «Заявки» (domain/boardStatus.ts) — come first, and the
 * steps and «Долги» are left out until switched on in «Вид» (a phone's strip; a PC's columns are the steps, as before).
 * Kept like the accent: on the device only, not in the backup.
 */

export const BOARD_TABS = ['all', 'inwork', 'waiting', 'requests', 'look', 'price', 'wait', 'work', 'pay', 'out', 'booked', 'debts', 'archive'] as const;
export type BoardTab = (typeof BOARD_TABS)[number];
export type CardSize = 'large' | 'compact';

export interface BoardView {
  /** Every tab in the order the strip shows them, «Все» first. */
  order: BoardTab[];
  /** Steps the strip leaves out (their cars stay under «Все»). */
  hidden: BoardTab[];
  size: CardSize;
}

/** Tabs that can be left out of the strip: all but «Все» and «Архив» (v0.70: «Долги» too — it is in «Деньги» as well). */
export const canHide = (k: BoardTab) => k !== 'all' && k !== 'archive';

/** The tabs the manager puts jobs in (v0.70) — the board's own few. */
export const STATUS_TABS = ['inwork', 'waiting', 'requests'] as const;
/** Left out at first (v0.70): the steps and «Долги» — switched on in «Вид» when wanted. */
const QUIET: BoardTab[] = ['look', 'price', 'wait', 'work', 'pay', 'out', 'booked', 'debts'];

export const DEFAULT_VIEW: BoardView = { order: [...BOARD_TABS], hidden: [...QUIET], size: 'large' };

const known = (x: unknown): x is BoardTab => typeof x === 'string' && (BOARD_TABS as readonly string[]).includes(x);

/**
 * Whatever was stored, made whole: unknown and repeated tabs dropped, «Все» first, a tab the stored order does
 * not know (one a later version added) put after its neighbour of the default order; «Все» and «Архив» never hidden.
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
  // A view kept before v0.70 (none of the manager's tabs in it): the few at once — the steps and «Долги» left out.
  const before = Array.isArray(r.order) && !r.order.some((k) => (STATUS_TABS as readonly unknown[]).includes(k));
  const kept = Array.isArray(r.hidden) ? r.hidden : QUIET;
  const hidden = [...new Set([...kept, ...(before ? QUIET : [])].filter(known).filter(canHide))];
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
