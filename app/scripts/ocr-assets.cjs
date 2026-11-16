/*
 * The files the VIN reader (services/vinReader.ts) runs on, served by the app itself — so it reads offline and
 * nothing is fetched from anyone else: the Tesseract worker, its engine (three builds: the device picks one) and the
 * English model — both of its ways of reading, the newer network and the older shapes (v0.25: a second opinion on a
 * line; 11 MB, fetched once at the first reading and kept). Copied from node_modules into public/ocr on every install
 * and before every build (public/ocr is not in git).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'ocr');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  [nm('tesseract.js-core', 'tesseract-core.wasm.js'), 'tesseract-core.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd.wasm.js'), 'tesseract-core-simd.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-relaxedsimd.wasm.js'), 'tesseract-core-relaxedsimd.wasm.js'],
  // Its own folder (v0.25): at the old address a phone's cache still holds the older model, the newer way only.
  [nm('@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'), path.join('lang-full', 'eng.traineddata.gz')],
];

fs.mkdirSync(path.join(out, 'lang-full'), { recursive: true });
fs.rmSync(path.join(out, 'lang'), { recursive: true, force: true });
for (const old of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) fs.rmSync(path.join(out, old), { force: true });
let copied = 0;
for (const [from, to] of files) {
  const dest = path.join(out, to);
  if (!fs.existsSync(from)) {
    console.warn(`ocr-assets: missing ${path.relative(root, from)} — the VIN reader will not work`);
    continue;
  }
  const a = fs.statSync(from);
  const b = fs.existsSync(dest) ? fs.statSync(dest) : null;
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  fs.copyFileSync(from, dest);
  copied++;
}
console.log(`ocr-assets: ${copied ? `${copied} file(s) copied` : 'up to date'} in public/ocr`);
