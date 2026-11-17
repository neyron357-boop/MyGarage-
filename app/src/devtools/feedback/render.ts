import type { FbMark, FbRect } from './types';

/*
 * Marks drawn on a screenshot — the same on the editor (SVG over the picture) and in the export (canvas): a red box,
 * a red arrow, a numbered red pin, each with its number in a red disc, all edged in white so they read on any screen.
 * Sizes follow the picture's (one unit ≈ a screen px at 390 px wide).
 */

export interface MarkGeometry {
  unit: number;
  line: number;
  halo: number;
  badge: number;
  font: number;
  head: number;
}

export function geometry(width: number, height: number): MarkGeometry {
  const unit = Math.max(1, Math.min(width, height) / 390);
  return { unit, line: 2.6 * unit, halo: 2.2 * unit, badge: 11 * unit, font: 13 * unit, head: 11 * unit };
}

export function markColor(): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--mantine-color-red-filled').trim() : '';
  return v || 'rgb(255, 59, 48)';
}

/** Where a mark's number sits: a box's top-left corner, an arrow's tail, the pin itself — kept inside the picture. */
export function badgeAt(m: FbMark, width: number, height: number, g: MarkGeometry): { x: number; y: number } {
  const x = m.kind === 'rect' ? Math.min(m.x1, m.x2) * width : m.x1 * width;
  const y = m.kind === 'rect' ? Math.min(m.y1, m.y2) * height : m.y1 * height;
  const r = g.badge + g.halo;
  return { x: Math.min(width - r, Math.max(r, x)), y: Math.min(height - r, Math.max(r, y)) };
}

/** An arrowhead's three corners at (x2, y2). */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): [number, number][] {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const back = (da: number): [number, number] => [x2 - size * 1.6 * Math.cos(a + da), y2 - size * 1.6 * Math.sin(a + da)];
  return [[x2, y2], back(0.45), back(-0.45)];
}

/** The frame around a picked element (a few px around it), as a mark in the screenshot's fractions. */
export function frameMark(rect: FbRect, scale: number, width: number, height: number, n = 1): FbMark {
  const pad = 3;
  const fx = (v: number) => Math.min(1, Math.max(0, (v * scale) / width));
  const fy = (v: number) => Math.min(1, Math.max(0, (v * scale) / height));
  return { n, kind: 'rect', x1: fx(rect.x - pad), y1: fy(rect.y - pad), x2: fx(rect.x + rect.width + pad), y2: fy(rect.y + rect.height + pad), auto: true };
}

/** Numbers 1…k in order (after a mark is taken away). */
export function renumber(marks: FbMark[]): FbMark[] {
  return marks.map((m, i) => (m.n === i + 1 ? m : { ...m, n: i + 1 }));
}

export function drawMarks(ctx: CanvasRenderingContext2D, marks: FbMark[], width: number, height: number, color = markColor()): void {
  const g = geometry(width, height);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const m of marks) {
    const x1 = m.x1 * width;
    const y1 = m.y1 * height;
    const x2 = m.x2 * width;
    const y2 = m.y2 * height;
    if (m.kind === 'rect') {
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      ctx.fillStyle = 'rgba(255, 59, 48, 0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = g.line + 2 * g.halo;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = g.line;
      ctx.strokeRect(x, y, w, h);
    } else if (m.kind === 'arrow') {
      const head = arrowHead(x1, y1, x2, y2, g.head);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo((head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2);
      };
      const tip = () => {
        ctx.beginPath();
        ctx.moveTo(head[0][0], head[0][1]);
        ctx.lineTo(head[1][0], head[1][1]);
        ctx.lineTo(head[2][0], head[2][1]);
        ctx.closePath();
      };
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = g.line + 2 * g.halo;
      path();
      ctx.stroke();
      tip();
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = g.line;
      path();
      ctx.stroke();
      tip();
      ctx.fill();
    }
    const b = badgeAt(m, width, height, g);
    const r = m.kind === 'pin' ? g.badge * 1.25 : g.badge;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = g.halo;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(m.kind === 'pin' ? g.font * 1.2 : g.font)}px -apple-system, "SF Pro Text", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.n), b.x, b.y + g.unit * 0.5);
  }
  ctx.restore();
}

async function bitmap(blob: Blob): Promise<{ img: CanvasImageSource; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    return { img: bmp, done: () => bmp.close() };
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, done: () => URL.revokeObjectURL(url) };
}

/** The screenshot with its marks, `width` px wide (its own size when not given). */
export async function renderAnnotated(shot: { blob: Blob; width: number; height: number }, marks: FbMark[], width = shot.width): Promise<HTMLCanvasElement> {
  const k = width / shot.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(shot.width * k);
  canvas.height = Math.round(shot.height * k);
  const ctx = canvas.getContext('2d')!;
  const src = await bitmap(shot.blob);
  try {
    ctx.drawImage(src.img, 0, 0, canvas.width, canvas.height);
  } finally {
    src.done();
  }
  // Marks keep their size relative to the picture (a small one gets thin lines, as the big one would look small).
  drawMarks(ctx, marks, canvas.width, canvas.height);
  return canvas;
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob: empty'))), type, quality));
}

/** The list's small picture: the screenshot with its marks, 240 px wide. */
export async function thumbOf(shot: { blob: Blob; width: number; height: number }, marks: FbMark[]): Promise<Blob> {
  return canvasBlob(await renderAnnotated(shot, marks, Math.min(240, shot.width)), 'image/jpeg', 0.72);
}
