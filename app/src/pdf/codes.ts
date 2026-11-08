import QRCode from 'qrcode';
// jsbarcode's Code 128 encoder (the DOM/canvas part of the library is not used).
import CODE128B from 'jsbarcode/bin/barcodes/CODE128/CODE128B';

/** Code 128 (set B) as module widths: "1" = bar, "0" = space, quiet zones not included. */
export function code128(text: string): string {
  const enc = new CODE128B(text, {});
  if (!enc.valid()) throw new Error(`code128: unsupported characters in "${text}"`);
  return enc.encode().data;
}

/** QR code modules (row by row, true = dark) for a text, error correction M. */
export function qrModules(text: string): { size: number; dark: boolean[] } {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = q.modules.size;
  const dark: boolean[] = [];
  for (let i = 0; i < size * size; i++) dark.push(!!q.modules.data[i]);
  return { size, dark };
}

/** Runs of equal modules, to draw a barcode with few rectangles. */
export function barRuns(bits: string): { x: number; w: number }[] {
  const runs: { x: number; w: number }[] = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (bits[j] === '1') j++;
    runs.push({ x: i, w: j - i });
    i = j;
  }
  return runs;
}
