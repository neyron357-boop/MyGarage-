/*
 * The files the VIN reader (services/vinReader.ts) runs on, served by the app itself — so it reads offline and
 * nothing is fetched from anyone else: the Tesseract worker, its engine (LSTM only, three builds: the device
 * picks one) and the English model (best_int, 3 MB). Copied from node_modules into public/ocr on every install
 * and before every build (public/ocr is not in git).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'ocr');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz')],
];

fs.mkdirSync(path.join(out, 'lang'), { recursive: true });
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
