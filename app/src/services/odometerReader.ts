import type { Page } from 'tesseract.js';
import { numbersIn, pickOdometer, segNumbers, type OdoPick, type OdoRead } from '../domain/odometer';
import { cropOf, inkAround, inkOtsu, segDigits, segRows } from '../domain/sevenSegment';
import { bandLines, breathe, cutLine, draw, engine, exclusive, grey, inked, lightLetters, margin, page, plain, rest, tooSmall, type TextLine } from './vinReader';

/*
 * A car's mileage read off a photo of its dashboard, on the phone (v0.44 — the «Пробег» chip on the job; the VIN
 * reader's engine and model, one reading at a time with it). A dashboard is mostly not text, and its numbers are many:
 * the photo is read whole as sparse text (the odometer with its «km» / «ODO»; a clock, a trip meter's tenths known for
 * what they are), then its lines found by their outlines (the odometer is often a small line among large ones) are
 * each cut out and read again — by the engine as digits only, two ways, and as a seven-segment LCD by its segments
 * (domain/sevenSegment.ts), two ways; light digits on a dark screen turned over. Which number is the mileage, and
 * whether it is sure, is decided by domain/odometer.ts (with the car's last mileage).
 */

/** The lines read again one by one (the likeliest first): enough for a dashboard, not a minute on a phone. */
const LINES = 8;
/** The height the digits of a cut line are drawn at for the reading. */
const PX = 44;

const linesOf = (p: Page) => (p.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((pa) => pa.lines));
/** A line that is a clock, a trip meter's tenths, a temperature or a share: its numbers are not the mileage. */
const NOT_MILEAGE = /\d\s*:\s*\d|\d[.,]\d(?!\d)|trip|°|%|km\/h/i;

/** A look into a reading as it goes (tests, a photo that will not read): each step with what it saw. */
export const odoTrace: { on?: (step: string, data: unknown) => void } = {};
const trace = (step: string, data: unknown) => odoTrace.on?.(step, data);

/** The mileage on a photo of a dashboard: the likeliest number, whether it is sure, the ones to offer. */
export function readOdometer(blob: Blob, previousKm?: number): Promise<OdoPick> {
  return exclusive(() => readNow(blob, previousKm));
}

/** The brightness of each point of a picture. */
function luma(c: HTMLCanvasElement): Float64Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const Y = new Float64Array(c.width * c.height);
  for (let i = 0; i < Y.length; i++) Y[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return Y;
}

async function readNow(blob: Blob, previousKm?: number): Promise<OdoPick> {
  const bmp = await createImageBitmap(blob);
  try {
    if (tooSmall(bmp)) return pickOdometer([], previousKm);
    const w = await engine();
    const reads: OdoRead[] = [];
    const big = draw(bmp, 0, 1600);
    // The whole photo as sparse text: each line's numbers, and whether «km» or «ODO» stands by them.
    const p = await page(w, grey(draw(bmp, 0, 1600)), 'page');
    const said = linesOf(p);
    trace('page', said.map((l) => ({ text: l.text.trim(), box: l.bbox })));
    for (const l of said) {
      if (NOT_MILEAGE.test(l.text)) continue;
      const label = /\b(km|odo|kms)\b/i.test(l.text);
      for (const km of numbersIn(l.text)) reads.push({ km, conf: l.confidence, source: 'page', label });
    }
    // Seven-segment LCDs (a Hiace's, an Urvan's odometer): their bars are no print to the engine — rows of digit-shaped
    // bars found on the whole photo, each read by its segments in black and white two ways (dark digits on a pale LCD,
    // light ones on a dark screen).
    await breathe();
    const Yb = luma(big);
    for (const light of [false, true]) {
      const rows = segRows(inkAround(Yb, big.width, big.height, light, Math.round(Math.max(big.width, big.height) * 0.02)), big.width, big.height).slice(0, 4);
      trace('segRows', { light, rows });
      rows.forEach((row, n) => {
        const hd = row.y1 - row.y0 + 1;
        const crop = cropOf(Yb, big.width, big.height, row, hd * 0.3);
        for (const [way, ink] of [
          ['around', inkAround(crop.data, crop.W, crop.H, light, Math.max(8, Math.round(hd * 0.6)))],
          ['otsu', inkOtsu(crop.data, crop.W, crop.H, light)],
        ] as const) {
          const digits = segDigits(ink, crop.W, crop.H);
          trace('segments', { light, n, way, digits });
          // A clock or a trip meter's tenths are none; a digit not read parts the number, never joins it.
          for (const km of segNumbers(digits)) reads.push({ km, conf: 70, source: `seg:${light ? 'l' : 'd'}${n}:${way}` });
        }
      });
    }
    // A line the whole reading saw as a clock or a trip meter is not read again (its colon or point may be lost then).
    const notMileage = (l: TextLine) =>
      said.some((s) => NOT_MILEAGE.test(s.text) && l.cx >= s.bbox.x0 - 6 && l.cx <= s.bbox.x1 + 6 && l.cy >= s.bbox.y0 - 6 && l.cy <= s.bbox.y1 + 6);
    // The lines by their outlines, each read again: as digits by the engine, and as a seven-segment LCD.
    await breathe();
    const lines = bandLines(big)
      .filter((l) => !notMileage(l))
      .slice(0, LINES);
    trace('lines', lines.map((l) => ({ cx: Math.round(l.cx), cy: Math.round(l.cy), w: Math.round(l.w), h: Math.round(l.h), angle: l.angle })));
    for (let i = 0; i < lines.length; i++) {
      await breathe();
      const cut = cutLine(big, lines[i], 1, PX);
      const light = lightLetters(cut);
      for (const [way, img] of [
        ['grey', margin(plain(cut, light))],
        ['ink', margin(inked(cut, light, PX))],
      ] as const) {
        const r = await digitsOf(w, img);
        trace('digits', { i, way, text: r.text.trim(), conf: r.conf });
        if (NOT_MILEAGE.test(r.text)) continue;
        for (const km of numbersIn(r.text)) reads.push({ km, conf: r.conf, source: `line:${i}:${way}`, label: /km|odo/i.test(r.text) });
      }
      // Read alike twice and fitting the last visit: no need to read every other line.
      if (i >= 1 && pickOdometer(reads, previousKm).sure) break;
    }
    return pickOdometer(reads, previousKm);
  } finally {
    bmp.close();
    rest();
  }
}

/** One cut line read as a dashboard's digits (and the «km» / «ODO» beside them; a colon and a point kept — a clock, a trip). */
async function digitsOf(w: Awaited<ReturnType<typeof engine>>, img: HTMLCanvasElement): Promise<{ text: string; conf: number }> {
  await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789 ,.:kmKMoODd', user_defined_dpi: '300', debug_file: '/dev/null' } as never);
  const r = await w.recognize(img, {}, { text: true });
  return { text: r.data.text ?? '', conf: r.data.confidence ?? 0 };
}
