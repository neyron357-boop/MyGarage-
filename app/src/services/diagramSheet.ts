import { db } from '../db/db';
import { diagramOf, fitInto, fitMark, MAX_MARKS, ovalOn, sheetEntries, sheetLayout, sheetName, sheetsOf, type DiagramMark, type SheetEntry } from '../domain/diagramSheet';
import type { OrderItem } from '../domain/types';
import { AppError } from './errors';
import { addMedia, cardBlob, cardUrl } from './media';

/*
 * The parts' diagrams for a supplier, four to a picture (v0.59; rules — domain/diagramSheet.ts). Drawn here on the
 * device from the diagrams the line keeps, no AI and no server: a diagram added by hand (a catalogue's screenshot), the
 * manager's outlines of the part, the catalogue's place already drawn into a diagram the garage's AI found. A diagram is
 * read at a card's size (1080 px — the cell's own; v0.59.1: the original came from the server each time, slowly) and kept
 * on the device once brought.
 */

/** A diagram added by hand to a part (a screenshot of a catalogue, a photo of one): first among its diagrams, the one
 * the sheet shows — outlines on another are taken off (the part is outlined on this one next). */
export async function addDiagram(itemId: string, file: Blob): Promise<string> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  const m = await addMedia({ ownerType: 'item', ownerId: itemId, slot: 'diagram', file });
  await db.items.update(itemId, { diagramIds: [m.id, ...(item.diagramIds ?? [])], diagramMark: undefined, diagramMarks: undefined });
  return m.id;
}

/**
 * The part's outlines on its diagram (v0.59.1: several — every piece of it; none — all taken off). All on one diagram of
 * the part's; v0.59's one ring gives way to them.
 */
export async function setDiagramMarks(itemId: string, marks: DiagramMark[]): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  const ids = new Set(marks.map((m) => m.id));
  if (ids.size > 1 || [...ids].some((id) => !(item.diagramIds ?? []).includes(id))) throw new AppError('err.notFound');
  const list = marks.slice(0, MAX_MARKS).map(fitMark);
  await db.items.update(itemId, { diagramMarks: list.length ? list : undefined, diagramMark: undefined });
}

/**
 * The diagrams of these parts brought to the device at a card's size, one after another (the suppliers' screen asks as it
 * opens: by the tap the outline sheet opens at once, and the sheets draw fast).
 */
export async function warmDiagrams(items: OrderItem[]): Promise<void> {
  for (const i of items) {
    const d = diagramOf(i);
    if (d) await cardUrl(d).catch(() => undefined);
  }
}

// The system's red and yellow (iOS) — a marker's ink, as on the catalogue's diagrams (media.ts `drawMarks`).
const RED = 'rgb(255, 59, 48)';
const INK = 'rgb(28, 28, 30)';
const GREY = 'rgb(99, 99, 102)';
const LINE = 'rgb(209, 209, 214)';
/** The outline's line on a 1080 px cell. */
const RING_LINE = 7;
const FONT = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif';

/** Words cut to the width, with "…" (one line). */
function fitText(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g.measureText(text.slice(0, mid) + '…').width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/** A name in up to two lines, by words (the second cut with "…"). */
function twoLines(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  let first = '';
  let k = 0;
  for (; k < words.length; k++) {
    const next = first ? `${first} ${words[k]}` : words[k];
    if (g.measureText(next).width > width) break;
    first = next;
  }
  if (!first) return [fitText(g, text, width)];
  const rest = words.slice(k).join(' ');
  return rest ? [first, fitText(g, rest, width)] : [first];
}

async function bitmapOf(id: string): Promise<ImageBitmap | undefined> {
  try {
    const blob = await cardBlob(id);
    return blob ? await createImageBitmap(blob) : undefined;
  } catch {
    return undefined;
  }
}

/** One sheet: up to four cells — number, name, part number, the diagram, the ring. */
async function drawSheet(entries: SheetEntry[]): Promise<Blob | undefined> {
  const layout = sheetLayout(entries.length);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  g.fillStyle = 'rgb(242, 242, 247)';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const { cell, head, pic } = layout.cells[i];
    // The cell: white, the head over the diagram, a hairline between them.
    g.fillStyle = '#fff';
    g.fillRect(cell.x, cell.y, cell.w, cell.h);
    g.fillStyle = LINE;
    g.fillRect(head.x + 32, head.y + head.h - 2, head.w - 64, 2);
    // The number in a red disc — the same as the ring's tag and the line in the text.
    const R = 46;
    const cx = head.x + 32 + R;
    const cy = head.y + head.h / 2;
    g.fillStyle = RED;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `700 52px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(e.n), cx, cy + 2);
    // The name (two lines at most), under it the part number and how many.
    const tx = cx + R + 28;
    const tw = head.x + head.w - 32 - tx;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `700 44px ${FONT}`;
    const sub = [e.partNumber, e.qty !== 1 ? `× ${e.qty}` : ''].filter(Boolean).join('   ');
    const name = twoLines(g, e.name || '—', tw).slice(0, sub ? 1 : 2);
    const lines = name.length + (sub ? 1 : 0);
    let y = cy - (lines * 52) / 2 + 40;
    g.fillStyle = INK;
    for (const l of name) {
      g.fillText(l, tx, y);
      y += 52;
    }
    if (sub) {
      g.font = `500 36px ${FONT}`;
      g.fillStyle = GREY;
      g.fillText(fitText(g, sub, tw), tx, y - 4);
    }
    // The diagram, whole, on white.
    const bmp = await bitmapOf(e.diagramId);
    if (!bmp) continue;
    try {
      const drawn = fitInto(bmp.width, bmp.height, pic, 24);
      g.drawImage(bmp, drawn.x, drawn.y, drawn.w, drawn.h);
      if (e.marks.length) {
        const ovals = e.marks.map((m) => ovalOn(m, drawn));
        const pad = 6;
        // The rest of the drawing a little paler: the outlined pieces stand out, the lines round them still read.
        g.save();
        g.beginPath();
        g.rect(drawn.x, drawn.y, drawn.w, drawn.h);
        for (const o of ovals) {
          g.moveTo(o.cx + o.rx + pad, o.cy);
          g.ellipse(o.cx, o.cy, o.rx + pad, o.ry + pad, 0, 0, Math.PI * 2, true);
        }
        g.fillStyle = 'rgba(255, 255, 255, 0.42)';
        g.fill('evenodd');
        g.restore();
        for (const o of ovals) {
          // A soft red inside, a white edge under the red line so it reads over black lines.
          g.fillStyle = 'rgba(255, 59, 48, 0.08)';
          g.beginPath();
          g.ellipse(o.cx, o.cy, o.rx, o.ry, 0, 0, Math.PI * 2);
          g.fill();
          g.lineWidth = RING_LINE + 6;
          g.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          g.stroke();
          g.lineWidth = RING_LINE;
          g.strokeStyle = RED;
          g.stroke();
        }
        // The part's number at each outline (upper right), kept inside the diagram's room.
        const tag = 28;
        for (const o of ovals) {
          const a = -Math.PI / 4;
          const tx = Math.min(pic.x + pic.w - tag - 4, Math.max(pic.x + tag + 4, o.cx + Math.cos(a) * o.rx + tag * 0.45));
          const ty = Math.min(pic.y + pic.h - tag - 4, Math.max(pic.y + tag + 4, o.cy + Math.sin(a) * o.ry - tag * 0.45));
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc(tx, ty, tag + 4, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = RED;
          g.beginPath();
          g.arc(tx, ty, tag, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#fff';
          g.font = `700 32px ${FONT}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(e.n), tx, ty + 1);
        }
      }
    } finally {
      bmp.close();
    }
  }
  // A PNG keeps a drawing's lines sharp; a large one (photos of paper) goes as a fine JPEG.
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const out = png && png.size <= 4_500_000 ? png : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.93));
  canvas.width = 0;
  canvas.height = 0;
  return out ?? undefined;
}

/**
 * The sheets of a list of parts (the very list sent, numbered from 1): files ready to share — made before the tap
 * (iOS shares only right in it). None when no part has a diagram, or where pictures cannot be drawn.
 */
export async function diagramSheets(items: OrderItem[]): Promise<File[]> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return [];
  const pages = sheetsOf(sheetEntries(items));
  const files: File[] = [];
  for (let i = 0; i < pages.length; i++) {
    const blob = await drawSheet(pages[i]);
    if (!blob) continue;
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    files.push(new File([blob], sheetName(i, pages.length, ext), { type: blob.type }));
  }
  return files;
}
