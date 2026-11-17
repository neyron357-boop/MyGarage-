import type { Context } from 'modern-screenshot';
import { OURS } from './context';
import type { Shot } from './types';

/*
 * A screenshot of what is on the screen, drawn from the page itself (modern-screenshot copies the page into an SVG
 * picture; it is painted on a canvas here). A browser cannot photograph its own screen — on an iPhone there is no screen
 * capture for pages at all — so this is the way; where it fails (an old Safari refuses to read such a canvas, a picture
 * comes out blank), the note takes a screenshot from the phone's photos instead (`fileToShot`).
 *
 * Taken only when asked («Снимок», «Весь экран» — never as pick mode opens or a scroll stops), and kept light, because
 * this froze the iPhone (v0.40.1):
 * - only what is seen is copied: whatever lies wholly outside the screen stays in the copy as an empty box of its size
 *   (the layout is kept, its insides are not copied); the screens kept under the one in front, the tool's own interface
 *   and the iPhone's touch labels are left out;
 * - the library is not let to wait for every picture and video in the document and decode them all (it does that for
 *   the node it is given — here an empty one; the page is handed to it afterwards);
 * - only standard properties go into the copy: not the page's own variables (Mantine puts hundreds on every element —
 *   the copy of one screen was megabytes of them, parsed again with every draw);
 * - a picture on the screen goes in at the size it is shown, drawn from the picture already on the page (nothing is
 *   fetched again); a picture off the screen is a blank pixel;
 * - Safari draws the pictures inside such an SVG only after the first draw: the library redraws it once per picture on
 *   the page, 100 ms apart (dozens of full redraws for a board of photos) — here at most two more;
 * - at most 1.5 image px per screen px and 2 megapixels in all;
 * - one at a time; what it made is let go at once (the library's hidden frame, the canvas — Safari keeps a canvas's
 *   memory until its size is zero —, the picture); a failure is not tried again by itself.
 */

const SKIP = `${OURS}, .stack > .screen[data-role="below"], .stack > .screen[data-role="out"], label.haptic-hit, input.haptic-switch, #mg-haptic, script, noscript, template`;
/** A transparent pixel: what a picture off the screen is drawn as. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Detail enough to read the smallest words (1.5 image px per screen px), not more. */
const MAX_SCALE = 1.5;
const MAX_PIXELS = 2_000_000;
const QUALITY = 0.84;
/** Longer than this — given up (what is still running finishes without drawing anything). */
const TIMEOUT = 15_000;
/** Boxes that keep their size when emptied (their width and height are copied with them); inline text and tables do not. */
const BOXES = new Set(['block', 'flex', 'grid', 'flow-root', 'list-item', 'inline-block', 'inline-flex', 'inline-grid']);
/** WebKit (Safari, and every browser on an iPhone) draws the pictures inside an SVG picture late. */
const WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);

/** How the last screenshot went (for the developer's measurements). */
export let lastCapture: { ms: number; svgKB: number; emptied: number; pictures: number; draws: number; width: number; height: number } | undefined;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

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

/** A canvas let go: Safari keeps its memory (and counts it against a small limit) until its size is zero. */
export function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** A picture of one colour (nothing drawn), or one the browser will not let us read, is not a screenshot. */
function looksBlank(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = 24;
  probe.height = 48;
  try {
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
  } finally {
    freeCanvas(probe);
  }
}

function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark' ? '#000' : '#fff';
}

let standard: string[] | undefined;
/**
 * The properties the copy is given: every standard one — not the page's own variables (`--mantine-…`: hundreds on
 * every element, the copy of a screen grew to megabytes of them; their values are already in the computed ones).
 */
function standardProperties(): string[] {
  if (!standard) {
    const cs = getComputedStyle(document.documentElement);
    standard = [];
    for (let i = 0; i < cs.length; i++) {
      const p = cs.item(i);
      if (!p.startsWith('--')) standard.push(p);
    }
  }
  return standard;
}

/** A picture on the screen at the size it is shown, from the picture already decoded on the page (nothing fetched). */
function shownPicture(img: HTMLImageElement, url: string, scale: number): string | false {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!img.complete || !nw || !nh) return false;
  const r = img.getBoundingClientRect();
  const k = Math.min(1, Math.max((r.width * scale) / nw, (r.height * scale) / nh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(nw * k));
  c.height = Math.max(1, Math.round(nh * k));
  try {
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    // Photos (the app's own, from its database) as JPEG; small pictures and the rest (a logo may be see-through) as PNG.
    const photo = url.startsWith('blob:') && c.width * c.height > 160 * 160;
    return c.toDataURL(photo ? 'image/jpeg' : 'image/png', 0.8);
  } catch {
    // A picture from another site: the library fetches it itself.
    return false;
  } finally {
    freeCanvas(c);
  }
}

async function take(token: { gone: boolean }): Promise<Shot> {
  const t0 = performance.now();
  const lib = await import('modern-screenshot');
  // The page's own width (a PC's scrollbar is not the page: drawn wider, centred content would move half of it).
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  const scale = Math.min(MAX_SCALE, Math.max(1, window.devicePixelRatio || 1), Math.sqrt(MAX_PIXELS / (w * h)));

  // Pictures on the screen: drawn in at their size. The rest (a long list's photos, hidden screens): a blank pixel.
  const all = new Set<string>();
  const shown = new Map<string, HTMLImageElement>();
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (!src) continue;
    all.add(src);
    if (img.closest(SKIP)) continue;
    const r = img.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < h && r.right > 0 && r.left < w) {
      const was = shown.get(src)?.getBoundingClientRect();
      if (!was || was.width * was.height < r.width * r.height) shown.set(src, img);
    }
  }

  // Wholly off the screen: kept as an empty box of its size (only boxes keep their size without what is in them). Not a
  // box of no height or width (the phone's frames hold fixed screens that way), nor one whose insides spill out of it.
  const emptied = new Set<Node>();
  const offScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom > 0 && r.top < h && r.right > 0 && r.left < w) return false;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return false;
    return BOXES.has(getComputedStyle(el).display);
  };
  const filter = (n: Node) => {
    const parent = n.parentNode;
    if (parent && emptied.has(parent)) return false;
    if (!(n instanceof Element)) return true;
    if (n.matches(SKIP)) return false;
    if (n.firstChild && offScreen(n)) emptied.add(n);
    return true;
  };

  const sx = window.scrollX;
  const sy = window.scrollY;
  // Made with an empty node: the library waits for (and decodes) every picture and video under the node it is made
  // with — the whole document's. The page is handed to it after.
  const ctx: Context<Node> = await lib.createContext<Node>(document.createElement('div'), {
    width: w,
    height: h,
    scale,
    backgroundColor: pageBackground(),
    filter,
    includeStyleProperties: standardProperties(),
    features: { restoreScrollPosition: true },
    fetchFn: async (url) => {
      const img = shown.get(url);
      if (img) return shownPicture(img, url, scale);
      return all.has(url) ? BLANK : false;
    },
    // The copy's <body> has no margin of its own (a browser gives one by default: the page would move 8 px), and a PC
    // scrolls the window itself: the page moves up by its scroll (fixed bars stay where they are).
    style: { margin: '0', ...(sx || sy ? { position: 'relative', top: `${-sy}px`, left: `${-sx}px` } : {}) },
    timeout: 4000,
  });
  ctx.node = document.body;
  let svg: SVGElement;
  try {
    svg = await lib.domToForeignObjectSvg(ctx);
  } finally {
    lib.destroyContext(ctx);
  }
  if (token.gone) throw new Error('capture: timeout');

  let xhtml = new XMLSerializer().serializeToString(svg);
  // As the library does: characters an SVG picture may not hold.
  // eslint-disable-next-line no-control-regex
  xhtml = xhtml.replace(/[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '');
  const pictures = xhtml.includes('data:image/');
  const svgKB = Math.round(xhtml.length / 1024);
  const img = new Image();
  const loaded = new Promise<void>((ok, no) => {
    img.onload = () => ok();
    img.onerror = () => no(new Error('capture: the picture did not load'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xhtml)}`;
  xhtml = '';
  const canvas = document.createElement('canvas');
  let draws = 0;
  try {
    await loaded;
    await img.decode().catch(() => undefined);
    if (token.gone) throw new Error('capture: timeout');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const g = canvas.getContext('2d');
    if (!g) throw new Error('capture: no canvas');
    const bg = pageBackground();
    const draw = () => {
      g.fillStyle = bg;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      draws++;
    };
    draw();
    // Safari: the pictures inside appear from the second draw on — two more, a moment apart, not one per picture.
    if (WEBKIT && pictures) {
      for (const ms of [180, 360]) {
        await wait(ms);
        if (token.gone) throw new Error('capture: timeout');
        draw();
      }
    }
    if (looksBlank(canvas)) throw new Error('capture: blank');
    const blob = await toBlob(canvas, 'image/jpeg', QUALITY);
    lastCapture = { ms: Math.round(performance.now() - t0), svgKB, emptied: emptied.size, pictures: shown.size, draws, width: canvas.width, height: canvas.height };
    return { blob, width: canvas.width, height: canvas.height, source: 'auto', scale };
  } finally {
    freeCanvas(canvas);
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
  }
}

/** The screenshot being taken (or the last one): the next waits until it has really ended — one given up included. */
let last: Promise<unknown> = Promise.resolve();
let failures = 0;
/** Failed twice on this visit: not offered again — the phone's photos instead. */
export const captureBroken = () => failures >= 2;

/** The screen as it is now — one at a time. Throws when it cannot be taken (the caller offers the phone's photos). */
export function captureScreen(): Promise<Shot> {
  const token = { gone: false };
  let giveUp: (e: Error) => void = () => undefined;
  const given = new Promise<never>((_, reject) => (giveUp = reject));
  // Too long (waiting for the one before included): given up — what still runs stops at its next step, drawing nothing.
  const timer = window.setTimeout(() => {
    token.gone = true;
    giveUp(new Error('capture: timeout'));
  }, TIMEOUT);
  const work = last.then(() => (token.gone ? Promise.reject(new Error('capture: timeout')) : take(token)));
  last = work.catch(() => undefined);
  return Promise.race([work, given])
    .then(
      (shot) => {
        failures = 0;
        return shot;
      },
      (e: unknown) => {
        failures++;
        throw e;
      },
    )
    .finally(() => window.clearTimeout(timer));
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

/** A screenshot from the phone's photos, made the size the tool keeps (JPEG, at most 1.5 image px per screen px). */
export async function fileToShot(file: Blob): Promise<Shot> {
  const src = await decode(file);
  const canvas = document.createElement('canvas');
  try {
    const maxW = Math.max(800, Math.round(window.innerWidth * MAX_SCALE));
    const k = Math.min(1, maxW / src.width, 3000 / src.height);
    canvas.width = Math.max(1, Math.round(src.width * k));
    canvas.height = Math.max(1, Math.round(src.height * k));
    canvas.getContext('2d')!.drawImage(src.img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, 'image/jpeg', QUALITY);
    // A screenshot of this screen (the same shape): its px per screen px — the picked element's frame can go on it.
    const same = Math.abs(canvas.width / canvas.height - window.innerWidth / window.innerHeight) < 0.03;
    return { blob, width: canvas.width, height: canvas.height, source: 'gallery', scale: same ? canvas.width / window.innerWidth : undefined };
  } finally {
    freeCanvas(canvas);
    src.done();
  }
}
