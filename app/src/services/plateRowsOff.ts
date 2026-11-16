import { plateRows, type FoundRow } from '../domain/plateGlyphs';

/*
 * The rows of a plate's marks found off the page (v0.33, services/plateRows.worker.ts) — where a worker cannot be made
 * (an old browser, tests), on the page as before.
 */

let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, (rows: FoundRow[]) => void>();

function theWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./plateRows.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; rows: FoundRow[] }>) => {
      waiting.get(e.data.id)?.(e.data.rows);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      // Broken: what waits is answered empty, and from now on the rows are found on the page.
      worker?.terminate();
      worker = null;
      for (const done of waiting.values()) done([]);
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

function ask(msg: object, transfer: Transferable[] = []): Promise<FoundRow[]> {
  const w = theWorker();
  if (!w) return Promise.resolve([]);
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ ...msg, id }, transfer);
  });
}

/** A picture's rows: the quick way (`light`), then — if asked — the shades, one or a few at a time. */
export interface RowFinder {
  light(keep: number): Promise<FoundRow[]>;
  shades(keep: number, levels?: number[]): Promise<FoundRow[]>;
}

/** The rows of the looked-at picture, found off the page when a worker can be made. */
export function rowFinder(look: HTMLCanvasElement): RowFinder {
  const W = look.width;
  const H = look.height;
  const rgba = look.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  if (!theWorker()) {
    // On the page: the brightness once, both looks from it.
    const Y = new Float32Array(W * H);
    for (let i = 0; i < Y.length; i++) Y[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    return {
      light: async (keep) => plateRows(Y, W, H, keep, 'light'),
      shades: async (keep, levels) => plateRows(Y, W, H, keep, 'shades', levels),
    };
  }
  let sent = false;
  return {
    light: (keep) => {
      sent = true;
      return ask({ op: 'light', rgba, W, H, keep }, [rgba.buffer]);
    },
    // The worker keeps the last picture's brightness: the shades of this one (asked for right after its quick look).
    shades: (keep, levels) => (sent ? ask({ op: 'shades', keep, levels }) : Promise.resolve([])),
  };
}
