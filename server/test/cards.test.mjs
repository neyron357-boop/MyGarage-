import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCards } from '../src/cards.mjs';

const car = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/e2e/fixtures/car.jpg');

/** A JPEG's width × height (its frame header). */
function size(file) {
  const b = fs.readFileSync(file);
  for (let i = 2; i < b.length; ) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}

describe('cards made on this computer (Windows)', { skip: process.platform !== 'win32' || !fs.existsSync(car) }, () => {
  it('a photo kept without its card gets one: 1080 px on its long side, fewer bytes; made once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-cards-test-'));
    try {
      const src = path.join(dir, 'photo.jpg');
      fs.copyFileSync(car, src);
      const kept = [];
      const store = {
        photosWithoutCard: () => (kept.length ? [] : [{ id: 'car-1', abs: src }]),
        keepFile: (id, variant, type, tmp, bytes) => {
          const to = path.join(dir, `${id}.${variant}.jpg`);
          fs.renameSync(tmp, to);
          kept.push({ id, variant, type, bytes, to });
        },
      };
      const made = await createCards({ store, dataDir: dir }).fill();
      assert.equal(made, true);
      assert.equal(kept.length, 1);
      assert.equal(kept[0].variant, 'card');
      assert.equal(kept[0].type, 'image/jpeg');
      const [w, h] = size(kept[0].to);
      const [ow, oh] = size(src);
      assert.equal(Math.max(w, h), Math.min(1080, Math.max(ow, oh)));
      if (Math.max(ow, oh) > 1080) assert.ok(kept[0].bytes < fs.statSync(src).size);
      assert.equal(await createCards({ store, dataDir: dir }).fill(), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
