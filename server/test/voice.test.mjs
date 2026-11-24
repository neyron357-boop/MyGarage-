import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oggCrc, oggOpus, opusSamples, PRE_SKIP } from '../whatsapp/voice.mjs';

// A 20 ms CELT frame (config 31, one frame) — what Chrome's encoder gives by default.
const frame = (n = 40) => Buffer.from([0xf8, ...Array.from({ length: n }, (_, i) => i % 251)]);

/** The pages of an Ogg file: their flags, positions, sequence numbers, checksums as written and as they should be. */
function pagesOf(buf) {
  const out = [];
  let at = 0;
  while (at < buf.length) {
    assert.equal(buf.toString('latin1', at, at + 4), 'OggS');
    const segs = buf[at + 26];
    const lacing = [...buf.subarray(at + 27, at + 27 + segs)];
    const size = 27 + segs + lacing.reduce((a, b) => a + b, 0);
    const pageBuf = Buffer.from(buf.subarray(at, at + size));
    const crc = pageBuf.readUInt32LE(22);
    pageBuf.writeUInt32LE(0, 22);
    out.push({ flags: buf[at + 5], granule: Number(buf.readBigInt64LE(at + 6)), seq: buf.readUInt32LE(at + 18), crc, ok: oggCrc(pageBuf) === crc, body: buf.subarray(at + 27 + segs, at + size) });
    at += size;
  }
  return out;
}

test('an Opus packet says how long it is by its first byte', () => {
  assert.equal(opusSamples(frame()), 960); // CELT 20 ms
  assert.equal(opusSamples(Buffer.from([8 << 3])), 480); // SILK config 8: 10 ms
  assert.equal(opusSamples(Buffer.from([(1 << 3) | 1])), 1920); // SILK 20 ms, two frames
  assert.equal(opusSamples(Buffer.from([(31 << 3) | 3, 3])), 2880); // CELT 20 ms, three frames
  assert.equal(opusSamples(Buffer.alloc(0)), 0);
});

test('a recording as Ogg Opus: its head, its tags, the sound — each page checked, the end where the voice ends', () => {
  const packets = Array.from({ length: 120 }, () => frame());
  const samples = 120 * 960 - 500;
  const pages = pagesOf(oggOpus(packets, { samples }));
  assert.equal(pages.length, 2 + 3); // head, tags, 50 + 50 + 20 packets
  assert.ok(pages.every((p) => p.ok));
  assert.deepEqual(pages.map((p) => p.seq), [0, 1, 2, 3, 4]);
  assert.equal(pages[0].flags, 2);
  assert.equal(pages[0].body.toString('latin1', 0, 8), 'OpusHead');
  assert.equal(pages[0].body[9], 1); // one channel
  assert.equal(pages[0].body.readUInt16LE(10), PRE_SKIP);
  assert.equal(pages[1].body.toString('latin1', 0, 8), 'OpusTags');
  assert.deepEqual(pages.slice(2).map((p) => p.granule), [50 * 960, 100 * 960, PRE_SKIP + samples]);
  assert.equal(pages[4].flags, 4);
});

test('a packet longer than 255 bytes is laced over segments; nothing to send — no file', () => {
  const big = frame(700);
  const pages = pagesOf(oggOpus([big, frame()], { samples: 1920 }));
  assert.equal(pages[2].body.length, big.length + frame().length);
  assert.ok(pages.every((p) => p.ok));
  assert.throws(() => oggOpus([]), /no sound/);
});
