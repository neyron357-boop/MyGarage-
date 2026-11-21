import type { OrderItem } from './types';

/*
 * The parts' diagrams for a supplier in one picture (v0.59, the user: «когда отправляю поставщику список запчастей… в
 * одной фотографии максимум по 4 схемы с нумерациями и названием детали, в схеме обводка той самой детали… должна
 * работать без ИИ»): what goes on a sheet and where — pure, no canvas. Each part with a diagram gets a cell: its
 * number (the same as in the text sent with it), its name, its part number, the diagram, and the part outlined on it —
 * the manager's own outlines (`OrderItem.diagramMarks`, v0.59.1: as many as the part has pieces — an engine mount
 * complete is three), or the catalogue's place already drawn into the diagram.
 */

/**
 * An outline round a part on its diagram (v0.59.1), drawn by the manager's finger: an oval — its centre (0…1 of the
 * picture's width and height) and its half-width and half-height (parts of the width and of the height).
 */
export interface DiagramMark {
  /** The diagram (media id) the outline is on. */
  id: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** v0.59's one ring: the radius a part of the picture's shorter side (read still, written no more). */
export interface OldRing {
  id: string;
  x: number;
  y: number;
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
  /** The outlines on it (an old ring — as it was). */
  marks: (DiagramMark | OldRing)[];
}

export const PER_SHEET = 4;

/** At most this many outlines on one diagram. */
export const MAX_MARKS = 8;
/** An outline's half-size, at least and at most (a part of the side). */
export const MARK_MIN = 0.012;
export const MARK_MAX = 0.5;
/** A tap's outline: a circle, its radius this part of the shorter side. */
export const TAP_RADIUS = 0.06;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** An outline kept to the picture: its centre inside, its size sane. */
export function fitMark(m: DiagramMark): DiagramMark {
  return { id: m.id, x: clamp(m.x, 0, 1), y: clamp(m.y, 0, 1), rx: clamp(m.rx, MARK_MIN, MARK_MAX), ry: clamp(m.ry, MARK_MIN, MARK_MAX) };
}

/** An outline grown (> 1) or shrunk (< 1) about its centre. */
export function scaleMark(m: DiagramMark, by: number): DiagramMark {
  return fitMark({ ...m, rx: m.rx * by, ry: m.ry * by });
}

/** The outline a finger drew from one corner to the other (fractions of the picture), a little roomier than the stroke. */
export function markFromBox(id: string, x1: number, y1: number, x2: number, y2: number): DiagramMark {
  return fitMark({ id, x: (x1 + x2) / 2, y: (y1 + y2) / 2, rx: (Math.abs(x2 - x1) / 2) * 1.08, ry: (Math.abs(y2 - y1) / 2) * 1.08 });
}

/** A tap's circle on a picture of `w`×`h` (round on screen: in the picture's parts its half-sizes differ). */
export function markAtTap(id: string, x: number, y: number, w: number, h: number): DiagramMark {
  const r = TAP_RADIUS * Math.min(w, h);
  return fitMark({ id, x, y, rx: r / Math.max(1, w), ry: r / Math.max(1, h) });
}

/** v0.59's ring as an outline, on a picture of `w`×`h`. */
export function fromOldRing(m: OldRing, w: number, h: number): DiagramMark {
  const r = m.r * Math.min(w, h);
  return fitMark({ id: m.id, x: m.x, y: m.y, rx: r / Math.max(1, w), ry: r / Math.max(1, h) });
}

/** Whether a point (fractions) is on an outline — inside it, or within `slack` of its edge (in its own sizes). */
export function onMark(m: DiagramMark, x: number, y: number, slack = 0.25): boolean {
  const dx = (x - m.x) / m.rx;
  const dy = (y - m.y) / m.ry;
  return dx * dx + dy * dy <= (1 + slack) * (1 + slack);
}

/** The diagram a part shows: the outlined one while it is still the part's, else its first. */
export function diagramOf(item: Pick<OrderItem, 'diagramIds' | 'diagramMark' | 'diagramMarks'>): string | undefined {
  const ids = item.diagramIds ?? [];
  const marked = item.diagramMarks?.[0]?.id ?? item.diagramMark?.id;
  if (marked && ids.includes(marked)) return marked;
  return ids[0];
}

/** The outlines on one of the part's diagrams (v0.64: outlined in the job's photo viewer too — any of them). */
export function marksOn(item: Pick<OrderItem, 'diagramIds' | 'diagramMark' | 'diagramMarks'>, id: string): (DiagramMark | OldRing)[] {
  if (!(item.diagramIds ?? []).includes(id)) return [];
  const list = (item.diagramMarks ?? []).filter((m) => m.id === id).map(fitMark);
  if (list.length) return list.slice(0, MAX_MARKS);
  return item.diagramMark && item.diagramMark.id === id ? [item.diagramMark] : [];
}

/** The outlines on the diagram the part shows (v0.59's one ring when it has no others). */
export function marksOf(item: Pick<OrderItem, 'diagramIds' | 'diagramMark' | 'diagramMarks'>): (DiagramMark | OldRing)[] {
  const d = diagramOf(item);
  return d ? marksOn(item, d) : [];
}

/** What changes a part's outlined picture: the diagram and its outlines (empty — none outlined). */
export function outlineKey(id: string, marks: (DiagramMark | OldRing)[]): string {
  if (!marks.length) return '';
  return `${id}|${marks.map((m) => ('r' in m ? `${m.x},${m.y},${m.r}` : `${m.x},${m.y},${m.rx},${m.ry}`)).join(';')}`;
}

/**
 * The cells, in the order of the list sent (`items` — the very list, numbered from 1): only the parts with a diagram,
 * each with its number in that list. `name` — what the supplier reads (English first: the trade's language here).
 */
export function sheetEntries(items: Pick<OrderItem, 'id' | 'titleEn' | 'titleRu' | 'partNumber' | 'qty' | 'diagramIds' | 'diagramMark' | 'diagramMarks'>[]): SheetEntry[] {
  const out: SheetEntry[] = [];
  items.forEach((i, k) => {
    const diagramId = diagramOf(i);
    if (!diagramId) return;
    out.push({ n: k + 1, itemId: i.id, name: (i.titleEn || i.titleRu || '').trim(), partNumber: i.partNumber?.trim() || undefined, qty: i.qty, diagramId, marks: marksOf(i) });
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

/** An outline on the drawn picture: its centre and half-sizes in the sheet's pixels. */
export function ovalOn(mark: DiagramMark | OldRing, drawn: Rect): { cx: number; cy: number; rx: number; ry: number } {
  const cx = drawn.x + mark.x * drawn.w;
  const cy = drawn.y + mark.y * drawn.h;
  if ('r' in mark) {
    const r = mark.r * Math.min(drawn.w, drawn.h);
    return { cx, cy, rx: r, ry: r };
  }
  return { cx, cy, rx: mark.rx * drawn.w, ry: mark.ry * drawn.h };
}

/** A sheet's file name: «parts-1.png», or «parts-1-of-3.png» with several. */
export function sheetName(i: number, of: number, ext: string): string {
  return of > 1 ? `parts-${i + 1}-of-${of}.${ext}` : `parts-${i + 1}.${ext}`;
}
