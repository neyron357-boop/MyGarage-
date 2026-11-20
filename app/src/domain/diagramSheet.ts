import type { OrderItem } from './types';

/*
 * The parts' diagrams for a supplier in one picture (v0.59, the user: «когда отправляю поставщику список запчастей… в
 * одной фотографии максимум по 4 схемы с нумерациями и названием детали, в схеме обводка той самой детали… должна
 * работать без ИИ»): what goes on a sheet and where — pure, no canvas. Each part with a diagram gets a cell: its
 * number (the same as in the text sent with it), its name, its part number, the diagram, and the part ringed on it —
 * the manager's own ring (`OrderItem.diagramMark`), or the catalogue's place already drawn into the diagram.
 */

/** A part's ring on its diagram, put there by the manager's finger: the centre and the radius in parts of the picture. */
export interface DiagramMark {
  /** The diagram (media id) the ring is on. */
  id: string;
  /** The centre, 0…1 of the picture's width and height. */
  x: number;
  y: number;
  /** The radius, a part of the picture's shorter side. */
  r: number;
}

export interface SheetEntry {
  /** The number in the list sent with the sheet (1…). */
  n: number;
  itemId: string;
  name: string;
  partNumber?: string;
  qty: number;
  /** The diagram on the sheet: the one ringed, else the first. */
  diagramId: string;
  mark?: DiagramMark;
}

export const PER_SHEET = 4;

/** The ring's sizes the manager steps through (a part of the shorter side). */
export const MARK_SIZES = [0.04, 0.06, 0.09, 0.13, 0.18];
export const MARK_DEFAULT = 0.09;

/** A ring kept to the picture: its centre inside, its radius one of a sane size. */
export function fitMark(m: DiagramMark): DiagramMark {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  return { id: m.id, x: clamp(m.x, 0, 1), y: clamp(m.y, 0, 1), r: clamp(m.r, MARK_SIZES[0], MARK_SIZES[MARK_SIZES.length - 1]) };
}

/** The next ring size up (+1) or down (−1). */
export function stepMark(r: number, by: 1 | -1): number {
  const at = MARK_SIZES.reduce((best, s, i) => (Math.abs(s - r) < Math.abs(MARK_SIZES[best] - r) ? i : best), 0);
  return MARK_SIZES[Math.min(MARK_SIZES.length - 1, Math.max(0, at + by))];
}

/** The diagram a part shows: the ringed one while it is still the part's, else its first. */
export function diagramOf(item: Pick<OrderItem, 'diagramIds' | 'diagramMark'>): string | undefined {
  const ids = item.diagramIds ?? [];
  if (item.diagramMark && ids.includes(item.diagramMark.id)) return item.diagramMark.id;
  return ids[0];
}

/**
 * The cells, in the order of the list sent (`items` — the very list, numbered from 1): only the parts with a diagram,
 * each with its number in that list. `name` — what the supplier reads (English first: the trade's language here).
 */
export function sheetEntries(items: Pick<OrderItem, 'id' | 'titleEn' | 'titleRu' | 'partNumber' | 'qty' | 'diagramIds' | 'diagramMark'>[]): SheetEntry[] {
  const out: SheetEntry[] = [];
  items.forEach((i, k) => {
    const diagramId = diagramOf(i);
    if (!diagramId) return;
    const mark = i.diagramMark && i.diagramMark.id === diagramId ? fitMark(i.diagramMark) : undefined;
    out.push({ n: k + 1, itemId: i.id, name: (i.titleEn || i.titleRu || '').trim(), partNumber: i.partNumber?.trim() || undefined, qty: i.qty, diagramId, ...(mark ? { mark } : {}) });
  });
  return out;
}

/** The sheets: four cells each, in order. */
export function sheetsOf<T>(entries: T[], per = PER_SHEET): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < entries.length; i += per) out.push(entries.slice(i, i + per));
  return out;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  /** A cell each: the whole of it, its head (number and name) and the diagram's room under it. */
  cells: { cell: Rect; head: Rect; pic: Rect }[];
}

/** The sheet's size in pixels: a cell is `CELL` wide, its head `HEAD` high. */
export const CELL = 1080;
export const HEAD = 150;
export const GAP = 12;

/**
 * Where everything goes on a sheet of `count` cells (1…4): one — alone; two — side by side; three and four — two by
 * two, the third alone on its row in the middle. The diagram's room is square under its head.
 */
export function sheetLayout(count: number): SheetLayout {
  const n = Math.max(1, Math.min(PER_SHEET, count));
  const cols = n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const cellH = HEAD + CELL;
  const width = cols * CELL + (cols + 1) * GAP;
  const height = rows * cellH + (rows + 1) * GAP;
  const cells: SheetLayout['cells'] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i % cols;
    // A row with fewer cells than columns is centred.
    const left = (width - (inRow * CELL + (inRow - 1) * GAP)) / 2;
    const x = left + col * (CELL + GAP);
    const y = GAP + row * (cellH + GAP);
    cells.push({ cell: { x, y, w: CELL, h: cellH }, head: { x, y, w: CELL, h: HEAD }, pic: { x, y: y + HEAD, w: CELL, h: CELL } });
  }
  return { width, height, cells };
}

/** A picture of `w`×`h` inside `room` whole (contain), centred, with `pad` around. */
export function fitInto(w: number, h: number, room: Rect, pad = 0): Rect {
  const rw = Math.max(1, room.w - pad * 2);
  const rh = Math.max(1, room.h - pad * 2);
  const s = Math.min(rw / Math.max(1, w), rh / Math.max(1, h));
  const dw = w * s;
  const dh = h * s;
  return { x: room.x + (room.w - dw) / 2, y: room.y + (room.h - dh) / 2, w: dw, h: dh };
}

/** The ring on the drawn picture: its centre and radius in the sheet's pixels. */
export function ringOn(mark: DiagramMark, drawn: Rect): { cx: number; cy: number; r: number } {
  return { cx: drawn.x + mark.x * drawn.w, cy: drawn.y + mark.y * drawn.h, r: mark.r * Math.min(drawn.w, drawn.h) };
}

/** A sheet's file name: «parts-1.png», or «parts-1-of-3.png» with several. */
export function sheetName(i: number, of: number, ext: string): string {
  return of > 1 ? `parts-${i + 1}-of-${of}.${ext}` : `parts-${i + 1}.${ext}`;
}
