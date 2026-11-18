import type { FrameRead } from '../domain/plateScan';
import type { Emirate } from '../domain/types';
import { emirateIn, pickPlate, platesInLine, type PlateGuess, type PlateVote } from '../domain/uaePlate';
import { readByGlyphs } from './plateGlyphRead';
import { banded, bandLines, breathe, cutLine, draw, engine, evened, exclusive, grey, inked, lightLetters, page, rest, tooSmall, type TextLine } from './vinReader';

/*
 * A car's number plate read off its photo, on the phone (v0.28 — «＋» → «Фото номера»; the VIN reader's engine and
 * model, one reading at a time with it). A photo of a car is mostly not text: the plate's line is found by its outline
 * first — tall dark characters on a light ground, a short line — and only the likeliest lines are read, each cut out,
 * levelled, its neighbours painted out, evened against glare and read two ways; a line read the same twice is the plate
 * (domain/uaePlate.ts votes). The emirate's word, small beside the number, is read from the plate's surroundings once
 * the number is found. Nothing sure — the whole photo is read as sparse text, then the other engine has a look.
 * v0.32: first of all, the plate by its characters (services/plateGlyphRead.ts — the number as the row of the largest even
 * marks, read for digits only; the code beside it for letters only; the emirate's small word); the lines' way is for
 * what that way left unsure.
 */

export interface PlateFound {
  emirate?: Emirate;
  code: string;
  number: string;
  /** The readings agree (or one read it clean and sure): it may go in by itself. */
  sure: boolean;
  /** The code was read the same by two readings or more (one reading of a code alone is a guess to offer, not to fill in). */
  codeSure: boolean;
  /** Where on the photo it was read, as parts of the photo's width and height (to mark it). */
  box?: { x: number; y: number; w: number; h: number };
}

/** The plate on a photo of a car, or nothing (no plate, or none read). */
export function readPlate(blob: Blob): Promise<PlateFound | undefined> {
  return exclusive(() => readPlateNow(blob));
}

/** A camera's frame drawn at most `max` px on its long side. */
function frameOf(video: HTMLVideoElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k);
  c.height = Math.round(video.videoHeight * k);
  c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/**
 * One frame of the camera read for its plate (v0.33 — the camera reads while it is aimed): the characters' way only, its
 * quick look; a frame is read in a fraction of a photo's time, and the frames vote (domain/plateScan.ts). Where the
 * plate is on the frame comes with it (to ring it on the screen).
 */
export function scanFrame(video: HTMLVideoElement): Promise<(FrameRead & { box?: PlateFound['box'] }) | undefined> {
  return exclusive(async () => {
    try {
      if (video.videoWidth < 240 || video.videoHeight < 240) return undefined;
      const look = frameOf(video, 1000);
      const src = frameOf(video, 1700);
      const g = await readByGlyphs(look, src, undefined, { quick: true });
      if (!g) return undefined;
      const b = g.numberBox;
      const line: TextLine = { cx: (b.x0 + b.x1 + 1) / 2, cy: (b.y0 + b.y1 + 1) / 2, w: b.x1 - b.x0 + 1, h: g.row.h, angle: g.row.angle, score: g.row.score };
      return { number: g.number, code: g.code, emirate: g.emirate, sure: g.sure, box: boxOn(stretched(line, g.code ? 2.4 : 0.35, 0.35), look) };
    } finally {
      rest();
    }
  });
}

/** The reading engine made ready ahead (the camera opens; the first frame is read without waiting for it). */
export function warmPlateReader(): void {
  void engine().catch(() => undefined);
}

/** A look into a reading as it goes (tests, tuning on hard photos). */
export const plateTrace: { on?: (step: string, data: unknown) => void } = {};
const trace = (step: string, data: unknown) => plateTrace.on?.(step, data);

/** How many of the likeliest lines are read at most. */
const MAX_LINES = 10;
/** The letters of a cut line, about this many px tall. */
const PX = 48;

/** The shape of a plate's line: not too thin, a short line (a code and up to five digits), level-ish. */
const plateLike = (l: TextLine) => l.h >= 9 && l.w / l.h >= 1.1 && l.w / l.h <= 11 && Math.abs(l.angle) <= 14;

/**
 * Likeliest first: dense outlines in a tall short line. (The outline finder ranks long lines first — a VIN is
 * 17 characters; a plate's line is short and its characters the tallest text on a car.)
 */
function plateScore(l: TextLine): number {
  const r = l.w / l.h;
  const dens = l.score / (Math.min(r, 18) * Math.sqrt(l.h));
  return dens * Math.min(r, 6) * Math.sqrt(l.h) * (r >= 2.2 && r <= 8 ? 1.4 : 1);
}

/** A line made longer along itself: `left` and `right` of its own heights more on each side. */
function stretched(l: TextLine, left: number, right: number): TextLine {
  const r = (l.angle * Math.PI) / 180;
  const shift = ((right - left) * l.h) / 2;
  return { ...l, cx: l.cx + shift * Math.cos(r), cy: l.cy + shift * Math.sin(r), w: l.w + (left + right) * l.h };
}

/**
 * The slope (degrees, down to the right) of a plate's characters in a black-and-white cut: the line through the feet of
 * its tallest marks — the number's digits (and its code), all of one height on one baseline. Small words beside them
 * (ABU DHABI, DUBAI) are shorter and left out; with fewer than three tall marks, the cut is taken as level.
 */
function inkSlope(c: HTMLCanvasElement): number {
  const W = c.width;
  const H = c.height;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) ink[i] = d[i * 4] < 128 ? 1 : 0;
  const seen = new Uint8Array(ink.length);
  const q = new Int32Array(ink.length);
  const marks: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let s0 = 0; s0 < ink.length; s0++) {
    if (!ink[s0] || seen[s0]) continue;
    let head = 0;
    let tail = 0;
    q[tail++] = s0;
    seen[s0] = 1;
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      const y = (i - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < ink.length && ink[j] && !seen[j] && Math.abs((j % W) - x) <= 1) (seen[j] = 1), (q[tail++] = j);
    }
    marks.push({ x0, x1, y0, y1 });
  }
  const tallest = Math.max(0, ...marks.map((m) => m.y1 - m.y0));
  const tall = marks.filter((m) => m.y1 - m.y0 >= tallest * 0.6 && m.x1 - m.x0 <= (m.y1 - m.y0) * 1.6);
  if (tall.length < 3) return 0;
  const xs = tall.map((m) => (m.x0 + m.x1) / 2);
  const ys = tall.map((m) => m.y1);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < xs.length; k++) (sxy += (xs[k] - mx) * (ys[k] - my)), (sxx += (xs[k] - mx) ** 2);
  if (!sxx) return 0;
  const deg = (Math.atan(sxy / sxx) * 180) / Math.PI;
  return Math.abs(deg) <= 20 ? Math.round(deg * 2) / 2 : 0;
}

/** Where a plate's line is on the photo, as parts of its width and height (its height and a bit — the plate). */
function boxOn(plate: TextLine, look: HTMLCanvasElement) {
  return {
    x: Math.max(0, (plate.cx - plate.w / 2) / look.width),
    y: Math.max(0, (plate.cy - plate.h * 0.85) / look.height),
    w: Math.min(1, plate.w / look.width),
    h: Math.min(1, (plate.h * 1.7) / look.height),
  };
}

/** What stands beside a line on its left: from `near` to `far` of its own heights away from its start. */
function beside(l: TextLine, near: number, far: number): TextLine {
  const r = (l.angle * Math.PI) / 180;
  const shift = -(l.w / 2 + ((near + far) / 2) * l.h);
  return { ...l, cx: l.cx + shift * Math.cos(r), cy: l.cy + shift * Math.sin(r), w: (far - near) * l.h };
}

/** A code read on its own beside a known number: the word nearest the number, if it is one (1–2 letters or digits). */
function codeAlone(text: string, number: string): PlateGuess[] {
  const words = text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ');
  const last = words[words.length - 1] ?? '';
  return /^([A-Z]{1,2}|\d{1,2})$/.test(last) ? [{ emirate: emirateIn(text), code: last, number, score: 3 }] : [];
}

async function readPlateNow(blob: Blob): Promise<PlateFound | undefined> {
  const bmp = await createImageBitmap(blob);
  try {
    if (tooSmall(bmp)) return undefined;
    // Lines found on a smaller picture (fast, and the grain of the paint is gone), cut from the larger one.
    const look = draw(bmp, 0, 1200);
    const src = draw(bmp, 0, 2000);
    const f = src.width / look.width;
    await breathe();
    // The plate's lines of text (v0.28's way): found only when they are read — after the characters' way left it unsure.
    let found: TextLine[] | undefined;
    const lineList = () => {
      found ??= bandLines(look)
        .filter(plateLike)
        .sort((a, b) => plateScore(b) - plateScore(a))
        .slice(0, MAX_LINES);
      trace('lines', found.map((l) => ({ cx: Math.round(l.cx), cy: Math.round(l.cy), w: Math.round(l.w), h: Math.round(l.h), angle: l.angle, score: Math.round(plateScore(l) * 10) / 10 })));
      return found;
    };
    const votes: (PlateVote & { line?: TextLine })[] = [];
    const settled = () => {
      const p = pickPlate(votes);
      return !!p && p.sure && p.agree >= 2;
    };
    // By its characters (v0.32): each of its readings a vote — a number read the same twice is two; its code, read alone
    // for letters, outweighs a code guessed out of a line of text.
    const glyphs = await readByGlyphs(look, src, plateTrace.on ? trace : undefined);
    trace('glyphs', glyphs && { number: glyphs.number, sure: glyphs.sure, code: glyphs.code, codeSure: glyphs.codeSure, emirate: glyphs.emirate });
    // Read whole and surely by its characters (v0.33): that is the plate — nothing more to read (the lines' way took
    // longer than all of it).
    if (glyphs?.sure && glyphs.code && glyphs.codeSure) {
      const b = glyphs.numberBox;
      const line: TextLine = { cx: (b.x0 + b.x1 + 1) / 2, cy: (b.y0 + b.y1 + 1) / 2, w: b.x1 - b.x0 + 1, h: glyphs.row.h, angle: glyphs.row.angle, score: glyphs.row.score };
      trace('pick', { number: glyphs.number, code: glyphs.code, by: 'glyphs' });
      return { emirate: glyphs.emirate, code: glyphs.code, number: glyphs.number, sure: true, codeSure: true, box: boxOn(stretched(line, 2.4, 0.35), look) };
    }
    if (glyphs) {
      const b = glyphs.numberBox;
      const line: TextLine = { cx: (b.x0 + b.x1 + 1) / 2, cy: (b.y0 + b.y1 + 1) / 2, w: b.x1 - b.x0 + 1, h: glyphs.row.h, angle: glyphs.row.angle, score: glyphs.row.score };
      const guess = { emirate: glyphs.emirate, code: glyphs.code, number: glyphs.number, score: 3 + (glyphs.code ? 4 : 0) };
      // Unsure by its characters (its digits read apart, or put right by their shapes): another reading must give it too
      // (v0.46.1 — W 30169 went in for V 80769 as sure, its code alone carrying it).
      votes.push({ guesses: [guess], confidence: glyphs.sure ? 90 : 60, emirate: glyphs.emirate, line, unsure: !glyphs.sure });
      if (glyphs.sure) votes.push({ guesses: [glyphs.codeSure ? guess : { ...guess, code: '' }], confidence: 90, emirate: glyphs.emirate, line });
    }
    let w = await engine();

    // A line read as found — and, found tilted, also level: a plate's small words beside its number (ABU DHABI) can
    // tilt the line they are joined into, and a plate is mostly shot square.
    const readLine = async (found: TextLine, ways: ('evened' | 'inked')[]) => {
      for (const l of Math.abs(found.angle) >= 4 ? [found, { ...found, angle: 0 }] : [found]) {
        const light = lightLetters(cutLine(src, l, f, PX));
        const cut = banded(cutLine(src, l, f, PX), light);
        const ink = inked(cut, light, PX);
        // The line's true slope: as it was cut, put right by the slope its ink still has in the cut.
        const slope = inkSlope(ink);
        const true_ = { ...l, angle: l.angle + slope };
        for (const way of ways) {
          await breathe();
          const p = await page(w, way === 'evened' ? evened(cut, light) : ink, 'line');
          const text = p.text.trim();
          trace('read', { way, angle: l.angle, slope, text, confidence: Math.round(p.confidence), cut: plateTrace.on ? cut.toDataURL('image/jpeg', 0.8) : undefined });
          votes.push({ guesses: platesInLine(text), confidence: p.confidence, emirate: emirateIn(text), line: true_ });
          if (settled()) return;
        }
      }
    };

    if (!settled())
      for (const l of lineList()) {
        await readLine(l, ['evened', 'inked']);
        if (settled()) break;
      }
    // Nothing sure from the lines: the whole photo as sparse text (the plate may be a line the outlines missed).
    if (!pickPlate(votes)?.sure) {
      await breathe();
      const p = await page(w, grey(draw(bmp, 0, 1600)), 'page');
      trace('page', { text: p.text });
      for (const t of p.text.split('\n')) if (t.trim()) votes.push({ guesses: platesInLine(t), confidence: Math.min(60, p.confidence), emirate: emirateIn(t) });
    }
    // Still nothing sure: the other engine (it tells characters by their shapes — it errs elsewhere) on the likeliest lines.
    if (!pickPlate(votes)?.sure) {
      w = await engine('legacy');
      for (const l of lineList().slice(0, 4)) {
        await readLine(l, ['inked']);
        if (pickPlate(votes)?.sure) break;
      }
    }
    let pick = pickPlate(votes);
    trace('pick', pick);
    if (!pick) return undefined;
    // The line it was read off (the reading of it surest of this number, at its slope): marked on the photo; the code is
    // looked for beside it.
    const line = votes
      .filter((v) => v.line && v.guesses.some((g) => g.number === pick!.number))
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]?.line;
    if (line) {
      w = await engine();
      // The code stands apart from the number (its own box on Abu Dhabi plates, white on red): the line read again
      // stretched to its left — nearer first, then further — and, for older plates, to its right; both ways of light.
      const light = lightLetters(cutLine(src, line, f, PX));
      const number = pick.number;
      // The number with what stands to its left (a Dubai letter), further left, then what stands beside it alone in both
      // ways of light (a number in its own red box), and to its right (older plates). Until two readings agree on it.
      const tries: { region: TextLine; alone: boolean; lits: boolean[] }[] = [
        { region: stretched(line, 2.6, 0.3), alone: false, lits: [light] },
        { region: stretched(line, 4.6, 0.3), alone: false, lits: [light] },
        { region: beside(line, 0.45, 4.8), alone: true, lits: [light, !light] },
        { region: stretched(line, 0.3, 2.8), alone: false, lits: [light] },
      ];
      const agreed = () => !!pick?.code && pick.codeAgree >= 2;
      for (const t of tries) {
        if (agreed()) break;
        // Alone, the code may stand in a box taller than the number's line: nothing above or below it painted out.
        const raw = cutLine(src, t.region, f, PX);
        const cut = t.alone ? raw : banded(raw, light);
        for (const lit of t.lits) {
          await breathe();
          const p = await page(w, evened(cut, lit), 'line');
          const text = p.text.trim();
          trace('code', { alone: t.alone, lit, text, confidence: Math.round(p.confidence), cut: plateTrace.on ? cut.toDataURL('image/jpeg', 0.8) : undefined });
          // Only what has this number counts here (a code read with another number is a slip).
          const guesses = t.alone ? codeAlone(text, number) : platesInLine(text).filter((g) => g.number === number && g.code);
          votes.push({ guesses, confidence: p.confidence, emirate: emirateIn(text) });
          pick = pickPlate(votes);
          if (agreed()) break;
        }
      }
    }
    if (!pick) return undefined;
    let emirate = pick.emirate;
    // The emirate's word: small, beside or above the number — the whole plate read as sparse text, its letters large.
    if (line && !emirate && !glyphs?.sure) {
      const plate = { ...stretched(line, 6, 1), h: line.h * 3.4 };
      const around = grey(cutLine(src, plate, f, PX * 3.4 * 1.6));
      const p = await page(w, around, 'page');
      trace('around', { text: p.text, cut: plateTrace.on ? around.toDataURL('image/jpeg', 0.8) : undefined });
      emirate = emirateIn(p.text);
    }
    // The plate ringed: the number, and its code beside it (on the left, as most plates have it).
    const box = line ? boxOn(stretched(line, pick.code ? 2.4 : 0.35, 0.35), look) : undefined;
    return { emirate, code: pick.code, number: pick.number, sure: pick.sure, codeSure: !!pick.code && pick.codeAgree >= 2, box };
  } finally {
    bmp.close();
    rest();
  }
}
