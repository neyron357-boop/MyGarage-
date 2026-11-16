/// <reference lib="webworker" />
import { plateRows } from '../domain/plateGlyphs';

/*
 * The heavy part of finding a plate, off the page (v0.33): the photo's brightness, its ink several ways and the rows of
 * marks in it — a phone's page stays free for a tap while a camera's frames are read one after another. The last
 * picture's brightness is kept: its second look (the shades) comes as another message.
 */

type Ask =
  | { id: number; op: 'light'; rgba: Uint8ClampedArray; W: number; H: number; keep: number }
  | { id: number; op: 'shades'; keep: number; levels?: number[] };

let last: { Y: Float32Array; W: number; H: number } | undefined;

self.onmessage = (e: MessageEvent<Ask>) => {
  const a = e.data;
  if (a.op === 'light') {
    const Y = new Float32Array(a.W * a.H);
    const d = a.rgba;
    for (let i = 0; i < Y.length; i++) Y[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    last = { Y, W: a.W, H: a.H };
  }
  if (!last) return (self as unknown as Worker).postMessage({ id: a.id, rows: [] });
  const rows = plateRows(last.Y, last.W, last.H, a.keep, a.op, a.op === 'shades' ? a.levels : undefined);
  // The rows only (the marks of the whole picture are not looked among any more: what stands beside the number is cut
  // and made black and white anew where it is).
  (self as unknown as Worker).postMessage({ id: a.id, rows: rows.map((r) => ({ ...r, all: [] })) });
};
