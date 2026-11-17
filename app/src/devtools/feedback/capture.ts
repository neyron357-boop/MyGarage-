import { OURS } from './context';
import type { Shot } from './types';

/*
 * A screenshot of what is on the screen, drawn from the page itself (modern-screenshot: the page copied into an SVG
 * picture and painted on a canvas — loaded only here, when the tool takes one). A browser cannot photograph its own
 * screen: on an iPhone there is no screen capture for pages at all, so this is the way — and where it fails (an old
 * Safari refuses to read such a canvas, a picture comes out blank), the note takes a screenshot from the phone's
 * photos instead (`fileToShot`).
 *
 * Only what is seen is drawn: the screens kept under the one in front, the tool's own interface and the iPhone's
 * touch labels are left out, pictures off the screen are not embedded, scrolled lists keep their scroll.
 */

const SKIP = `${OURS}, .stack > .screen[data-role="below"], .stack > .screen[data-role="out"], label.haptic-hit, input.haptic-switch, #mg-haptic, script, noscript, template`;
/** A transparent pixel: what an image off the screen is drawn as. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Detail enough to read the smallest words (two image px per screen px), not more. */
const MAX_SCALE = 2;
const QUALITY = 0.86;

const later = <T>(ms: number, what: string) => new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(`${what}: timeout`)), ms));

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob: empty'))), type, quality);
    } catch (e) {
      // A canvas the browser considers tainted (Safari and an SVG picture of HTML): SecurityError.
      reject(e);
    }
  });
}

/** A picture of one colour (nothing drawn), or one the browser will not let us read, is not a screenshot. */
function looksBlank(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = 24;
  probe.height = 48;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
  const d = ctx.getImageData(0, 0, probe.width, probe.height).data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min < 6;
}

function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark' ? '#000' : '#fff';
}

/** The screen as it is now. Throws when it cannot be taken (the caller offers the phone's photos instead). */
export async function captureScreen(): Promise<Shot> {
  const { domToCanvas } = await import('modern-screenshot');
  // The page's own width (a PC's scrollbar is not the page: drawn wider, centred content would move half of it).
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  const scale = Math.min(MAX_SCALE, Math.max(1, window.devicePixelRatio || 1));
  // Pictures on the screen are embedded; the rest (a long list's photos, hidden screens) — a blank pixel.
  const all = new Set<string>();
  const seen = new Set<string>();
  document.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src;
    if (!src) return;
    all.add(src);
    const r = img.getBoundingClientRect();
    if (r.width > 0 && r.bottom > 0 && r.top < h && r.right > 0 && r.left < w && !img.closest(SKIP)) seen.add(src);
  });
  const sx = window.scrollX;
  const sy = window.scrollY;
  const canvas = await Promise.race([
    domToCanvas(document.body, {
      width: w,
      height: h,
      scale,
      backgroundColor: pageBackground(),
      filter: (n) => !(n instanceof Element) || !n.matches(SKIP),
      features: { restoreScrollPosition: true },
      fetchFn: async (url) => (all.has(url) && !seen.has(url) ? BLANK : false),
      // The copy's <body> has no margin of its own (a browser gives one by default: the page would move 8 px), and a PC
      // scrolls the window itself: the page moves up by its scroll (fixed bars stay where they are).
      style: { margin: '0', ...(sx || sy ? { position: 'relative', top: `${-sy}px`, left: `${-sx}px` } : {}) },
      timeout: 4000,
    }),
    later<HTMLCanvasElement>(20000, 'capture'),
  ]);
  if (looksBlank(canvas)) throw new Error('capture: blank');
  const blob = await toBlob(canvas, 'image/jpeg', QUALITY);
  return { blob, width: canvas.width, height: canvas.height, source: 'auto', scale };
}

async function decode(file: Blob): Promise<{ img: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { img: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch {
      // HEIC and the like in an older browser: through an <img> below.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/** A screenshot from the phone's photos, made the size the tool keeps (JPEG, at most two image px per screen px). */
export async function fileToShot(file: Blob): Promise<Shot> {
  const src = await decode(file);
  try {
    const maxW = Math.max(800, Math.round(window.innerWidth * MAX_SCALE));
    const k = Math.min(1, maxW / src.width, 3000 / src.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(src.width * k));
    canvas.height = Math.max(1, Math.round(src.height * k));
    canvas.getContext('2d')!.drawImage(src.img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, 'image/jpeg', QUALITY);
    // A screenshot of this screen (the same shape): its px per screen px — the picked element's frame can go on it.
    const same = Math.abs(canvas.width / canvas.height - window.innerWidth / window.innerHeight) < 0.03;
    return { blob, width: canvas.width, height: canvas.height, source: 'gallery', scale: same ? canvas.width / window.innerWidth : undefined };
  } finally {
    src.done();
  }
}
