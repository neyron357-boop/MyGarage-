import { createContext, useContext, useSyncExternalStore } from 'react';

/*
 * The PC's own tabs (v0.89, the owner: «добавить собственные вкладки внутри приложения для мультизадач; правая кнопка мыши
 * по любой кнопке, которая ведёт в другой экран, — открыть в новой вкладке прямо внутри приложения, как в браузере»).
 * The first tab is the window's own address (`main`); every other has its own history of screens (a router in memory —
 * App.tsx `TabPane`) and stays as it was while another is in front: its scroll, what is typed in it. Which tabs are open
 * and where — on this computer (`mygarage.deskTabs`), not the garage's data; they come back when the app is opened again.
 * Their order is the person's (v0.91, the owner's note #29: «добавить возможность перетаскивать вкладки, менять местами»):
 * a tab dragged along the strip, or Ctrl+Shift+← → on it (`moveTab`) — the window's own tab too.
 */

export interface DeskTab {
  id: string;
  /** Its address now (path and query). The window's tab — its last one seen. */
  path: string;
  /** Its screen's title (its bar's), for the tab's label. */
  title?: string;
}

interface State {
  tabs: DeskTab[];
  active: string;
}

const KEY = 'mygarage.deskTabs';
export const MAIN_TAB = 'main';
/** More than this many tabs: the oldest not in front makes room (a strip of 30 tabs is no help). */
const MOST = 12;

function load(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
    if (raw && Array.isArray(raw.tabs)) {
      const tabs = raw.tabs.filter((t) => t && typeof t.id === 'string' && typeof t.path === 'string' && t.path.startsWith('/')).slice(0, MOST);
      if (!tabs.some((t) => t.id === MAIN_TAB)) tabs.unshift({ id: MAIN_TAB, path: '/' });
      return { tabs, active: tabs.some((t) => t.id === raw.active) ? raw.active : MAIN_TAB };
    }
  } catch {
    // none kept
  }
  return { tabs: [{ id: MAIN_TAB, path: '/' }], active: MAIN_TAB };
}

let state: State = typeof window === 'undefined' ? { tabs: [{ id: MAIN_TAB, path: '/' }], active: MAIN_TAB } : load();
const subs = new Set<() => void>();
let saving = 0;

function set(next: State) {
  state = next;
  subs.forEach((f) => f());
  // Kept a moment later (a title or an address changes often while a screen comes up).
  if (typeof window === 'undefined') return;
  window.clearTimeout(saving);
  saving = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ tabs: state.tabs.map(({ id, path }) => ({ id, path })), active: state.active }));
    } catch {
      // not kept
    }
  }, 300);
}

export function deskTabs(): State {
  return state;
}
export function useDeskTabs(): State {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => state,
  );
}

const windowScroll = (): number => (typeof window === 'undefined' ? 0 : window.scrollY);
/** Where the window was scrolled in each tab when another came to the front. */
const scrolls = new Map<string, number>();
export const scrollOfTab = (id: string): number => scrolls.get(id) ?? 0;

let seq = 0;
/** A new tab at this address — in front (a click on «Открыть в новой вкладке»), or behind (the wheel, Ctrl+click). */
export function openTab(path: string, { front = true }: { front?: boolean } = {}): string {
  const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`;
  let tabs = [...state.tabs];
  const at = tabs.findIndex((t) => t.id === state.active);
  tabs.splice(at + 1, 0, { id, path });
  // Too many: the oldest one behind goes.
  while (tabs.length > MOST) {
    const old = tabs.find((t) => t.id !== MAIN_TAB && t.id !== state.active && t.id !== id);
    if (!old) break;
    tabs = tabs.filter((t) => t !== old);
  }
  if (front) scrolls.set(state.active, windowScroll());
  set({ tabs, active: front ? id : state.active });
  return id;
}

/** That tab in front. */
export function focusTab(id: string) {
  if (id === state.active || !state.tabs.some((t) => t.id === id)) return;
  scrolls.set(state.active, windowScroll());
  set({ ...state, active: id });
}

/** A tab closed: the one beside it comes to the front (the window's own tab closed — the next one's address is its). */
export function closeTab(id: string): { mainTo?: string } {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at < 0 || state.tabs.length < 2) return {};
  scrolls.delete(id);
  if (id === MAIN_TAB) {
    // The window's tab stays the window's: it takes the next tab's address, that tab goes.
    const next = state.tabs[at + 1] ?? state.tabs[at - 1];
    set({ tabs: state.tabs.filter((t) => t.id !== next.id).map((t) => (t.id === MAIN_TAB ? { ...t, path: next.path, title: next.title } : t)), active: MAIN_TAB });
    return { mainTo: next.path };
  }
  const tabs = state.tabs.filter((t) => t.id !== id);
  const active = state.active === id ? (tabs[at] ?? tabs[at - 1]).id : state.active;
  set({ tabs, active });
  return {};
}

/** A tab put at another place of the strip (dragged there; Ctrl+Shift+← →). Its screen is not touched. */
export function moveTab(id: string, to: number) {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at < 0) return;
  const place = Math.max(0, Math.min(state.tabs.length - 1, to));
  if (place === at) return;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(at, 1);
  tabs.splice(place, 0, tab);
  set({ ...state, tabs });
}

/** A tab's address and title as its screen goes (its router and its bar say them). */
export function noteTab(id: string, patch: Partial<Pick<DeskTab, 'path' | 'title'>>) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || ((patch.path === undefined || patch.path === tab.path) && (patch.title === undefined || patch.title === tab.title))) return;
  set({ ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

/** The tests and the browser scenario: from nothing. */
export function resetDeskTabs() {
  scrolls.clear();
  set({ tabs: [{ id: MAIN_TAB, path: '/' }], active: MAIN_TAB });
}

/** Which tab a screen is in (its bar notes its title there; the window's title is the tab in front's). */
export const DeskTabContext = createContext<string>(MAIN_TAB);
export const useDeskTab = () => useContext(DeskTabContext);
