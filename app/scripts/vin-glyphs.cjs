/*
 * The book of a VIN's characters the app reads plates by (v0.35, domain/vinGlyphs.ts): each of the 33 characters drawn
 * in the typefaces VIN plates and labels are printed in, or come near (DIN — Bahnschrift, condensed and light too;
 * Arial and Arial Narrow, Franklin Gothic, Gill Sans, Segoe, Tahoma, Verdana, Trebuchet, Calibri, Candara, Corbel;
 * the typewriter ones — Consolas, Courier New, Lucida Console; OCR-A), regular and bold, put down as skeletons on the
 * reader's grid — near-copies of a sample already there left out. Writes src/domain/vinGlyphBook.ts.
 *
 * node scripts/vin-glyphs.cjs (on a computer with these typefaces — Windows has them all; one missing is said and
 * left out). Runs the app's own code (Vite) in a browser (Playwright).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const FONTS = [
  'Bahnschrift',
  'Bahnschrift Light',
  'Bahnschrift Condensed',
  'Arial',
  'Arial Narrow',
  'Franklin Gothic Medium',
  'Gill Sans MT',
  'Segoe UI',
  'Tahoma',
  'Verdana',
  'Trebuchet MS',
  'Microsoft Sans Serif',
  'Calibri',
  'Candara',
  'Corbel',
  'Consolas',
  'Courier New',
  'Lucida Console',
  'OCR A Extended',
];

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  let browser;
  for (const channel of [undefined, 'chrome', 'msedge']) {
    try {
      browser = await chromium.launch(channel ? { channel } : {});
      break;
    } catch {
      /* the next browser */
    }
  }
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const { samples, missing } = await page.evaluate(async (FONTS) => {
      const G = await import('/src/domain/vinGlyphs.ts');
      const V = await import('/src/domain/vin.ts');
      const book = [];
      const missing = [];
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 160;
      const g = c.getContext('2d', { willReadFrequently: true });
      for (const font of FONTS) {
        // A typeface the computer lacks falls back to another: told by its width against a surely different one.
        g.font = `400 100px "${font}", monospace`;
        const own = g.measureText('MW1il').width;
        g.font = '400 100px monospace';
        if (own === g.measureText('MW1il').width && !/Courier|Consolas|Lucida Console|OCR/.test(font)) {
          missing.push(font);
          continue;
        }
        for (const weight of [400, 700]) {
          for (const ch of V.VIN_CHARS) {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, 160, 160);
            g.fillStyle = '#000';
            g.font = `${weight} 100px "${font}"`;
            g.textBaseline = 'middle';
            g.fillText(ch, 30, 80);
            const d = g.getImageData(0, 0, 160, 160).data;
            const mask = new Uint8Array(160 * 160);
            for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4] < 128 ? 1 : 0;
            const s = G.shapeOf(mask, 160, 160);
            if (!s) continue;
            // A near-copy of one already in the book adds nothing.
            if (book.some((b) => b.c === ch && G.unlike(s, b) < 0.15)) continue;
            book.push({ c: ch, ...s });
          }
        }
      }
      return { samples: book.map((s) => G.keep(s.c, s)), missing };
    }, FONTS);
    if (missing.length) console.warn('vin-glyphs: not on this computer —', missing.join(', '));
    const lines = samples.map((s) => `  ${JSON.stringify(s)},`).join('\n');
    const out = `/*
 * The VIN characters the app reads plates by (domain/vinGlyphs.ts): each drawn in the typefaces VIN plates are printed
 * in, as a skeleton on the reader's grid — [character, holes, width (hundredths of its height), grid bits (base64)].
 * Made by scripts/vin-glyphs.cjs; not to be changed by hand.
 */
import type { KeptSample } from './vinGlyphs';

export const FONT_SAMPLES: KeptSample[] = [
${lines}
];
`;
    fs.writeFileSync(path.join(root, 'src', 'domain', 'vinGlyphBook.ts'), out);
    console.log(`vin-glyphs: ${samples.length} samples, ${Math.round(out.length / 1024)} KB`);
  } finally {
    await browser?.close();
    await server.close();
  }
})();
