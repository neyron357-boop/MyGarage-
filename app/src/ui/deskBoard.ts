import { useSyncExternalStore } from 'react';

/*
 * The PC board, arranged by hand (v0.67, the owner's note on the PC board: «добавить креатив и возможность двигать,
 * перемещать карточки, увеличивать, размещать где угодно, выделить важных, увеличить важные, закреплять»): two ways to
 * see it — «Шаги» (the sections by step, as before) and «Холст» (a canvas: every card where the manager put it, its size
 * his too) — and, in both, important cards (lit, larger) and pinned ones (first; on the canvas — fixed where they are).
 * Kept on this computer, like the board's «Вид»: it is how one screen is laid out, not the garage's data.
 */

export type DeskMode = 'steps' | 'canvas';
/**
 * A card on the canvas: its top-left corner and its width (px); its height is half of it, as every card's. `z` — which
 * lies on top where cards cover each other: the one put down last (kept, so a reload does not shuffle them).
 */
export interface Place {
  x: number;
  y: number;
  w: number;
  z?: number;
}
export interface DeskBoardState {
  mode: DeskMode;
  places: Record<string, Place>;
  important: string[];
  pinned: string[];
}

/** A card's widths: the usual one (a phone's), the important one's, the least and the most. */
export const CARD = { min: 240, s: 290, l: 560, max: 720 };
/** The canvas's step: places and sizes fall on it. */
export const GRID = 12;
/** The room between cards placed by the board. */
export const GAP = 16;

export const DEFAULT_DESK: DeskBoardState = { mode: 'steps', places: {}, important: [], pinned: [] };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const snap = (v: number, step = GRID) => Math.round(v / step) * step;
export const clampWidth = (w: number) => Math.min(CARD.max, Math.max(CARD.min, snap(w, 10)));

/** Whatever was stored, made whole: unknown fields dropped, places sane (on the canvas, sizes within bounds). */
export function normalizeDeskBoard(raw: unknown): DeskBoardState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const places: Record<string, Place> = {};
  for (const [id, p] of Object.entries((r.places && typeof r.places === 'object' ? r.places : {}) as Record<string, Record<string, unknown>>)) {
    const x = num(p?.x);
    const y = num(p?.y);
    const w = num(p?.w);
    if (x === undefined || y === undefined || w === undefined) continue;
    const z = num(p?.z);
    places[id] = { x: Math.max(0, snap(x)), y: Math.max(0, snap(y)), w: clampWidth(w), ...(z !== undefined ? { z } : {}) };
  }
  const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x))];
  return { mode: r.mode === 'canvas' ? 'canvas' : 'steps', places, important: ids(r.important), pinned: ids(r.pinned) };
}

const h = (p: Place) => p.w / 2;
/** Two cards cover each other (with the room between cards counted). */
export const overlaps = (a: Place, b: Place, gap = GAP) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + h(b) + gap && b.y < a.y + h(a) + gap;

/**
 * Cards with no place yet, put where nothing is: row by row from the top-left, the first spot as wide as the card that
 * covers no card already on the canvas, within its width. Places of other cards do not move.
 */
export function placeNew(ids: string[], places: Record<string, Place>, width: number, widthOf: (id: string) => number = () => CARD.s): Record<string, Place> {
  const taken = Object.values(places);
  const out: Record<string, Place> = {};
  const room = Math.max(CARD.s, width);
  for (const id of ids) {
    const w = widthOf(id);
    let spot: Place | undefined;
    for (let y = 0; !spot && y < 40_000; y += GRID * 2) {
      for (let x = 0; x + w <= room || x === 0; x += GRID * 2) {
        const p = { x, y, w };
        if (!taken.some((q) => overlaps(p, q))) {
          spot = p;
          break;
        }
        if (x + w > room) break;
      }
    }
    spot ??= { x: 0, y: Math.max(0, ...taken.map((q) => q.y + h(q) + GAP)), w };
    out[id] = spot;
    taken.push(spot);
  }
  return out;
}

/**
 * Every card placed afresh, in the order given (pinned and important first): row by row, left to right, a row as tall as
 * its tallest card — the canvas tidied.
 */
export function arrange(ids: string[], width: number, widthOf: (id: string) => number): Record<string, Place> {
  const out: Record<string, Place> = {};
  const up = (v: number) => Math.ceil(v / GRID) * GRID;
  let x = 0;
  let y = 0;
  let row = 0;
  for (const id of ids) {
    const w = widthOf(id);
    if (x > 0 && x + w > width) {
      x = 0;
      y = up(y + row + GAP);
      row = 0;
    }
    out[id] = { x, y, w };
    x = up(x + w + GAP);
    row = Math.max(row, w / 2);
  }
  return out;
}

const KEY = 'mygarage.deskBoard';
const EVENT = 'mygarage:deskBoard';

function read(): DeskBoardState {
  try {
    const s = localStorage.getItem(KEY);
    return s ? normalizeDeskBoard(JSON.parse(s)) : DEFAULT_DESK;
  } catch {
    return DEFAULT_DESK;
  }
}

let current: DeskBoardState | undefined;

export function setDeskBoard(patch: Partial<DeskBoardState>): void {
  const next = normalizeDeskBoard({ ...(current ??= read()), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode: for this visit
  }
  current = next;
  window.dispatchEvent(new Event(EVENT));
}

export const deskBoardNow = (): DeskBoardState => (current ??= read());

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Important: lit; on the canvas made the important size at once (larger) — taken off, it keeps the size it has. */
export function toggleImportant(id: string): void {
  const s = deskBoardNow();
  const on = !s.important.includes(id);
  const p = s.places[id];
  setDeskBoard({ important: toggle(s.important, id), ...(on && p && p.w < CARD.l ? { places: { ...s.places, [id]: { ...p, w: CARD.l } } } : {}) });
}
/** Pinned: first on the board; on the canvas fixed where it is. */
export function togglePinned(id: string): void {
  const s = deskBoardNow();
  setDeskBoard({ pinned: toggle(s.pinned, id) });
}
/** A card put down (moved or resized): where it is, and on top of the others. */
export function setPlace(id: string, p: Place): void {
  const s = deskBoardNow();
  const z = Math.max(0, ...Object.values(s.places).map((q) => q.z ?? 0)) + 1;
  setDeskBoard({ places: { ...s.places, [id]: { x: Math.max(0, snap(p.x)), y: Math.max(0, snap(p.y)), w: clampWidth(p.w), z } } });
}
/** A card a step larger or smaller (the usual, between, the important one's, the most). */
export function resizeStep(id: string, dir: 1 | -1): void {
  const s = deskBoardNow();
  const p = s.places[id];
  if (!p) return;
  const steps = [CARD.min, CARD.s, 420, CARD.l, CARD.max];
  const at = steps.findIndex((w) => w >= p.w - 5);
  const next = steps[Math.min(steps.length - 1, Math.max(0, (at < 0 ? steps.length - 1 : at) + dir))];
  setPlace(id, { ...p, w: next });
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

export function useDeskBoard(): DeskBoardState {
  return useSyncExternalStore(subscribe, deskBoardNow, () => DEFAULT_DESK);
}
