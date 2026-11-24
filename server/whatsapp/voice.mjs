/*
 * A voice message as WhatsApp records its own (v0.81, the user's brief: «отпускание отправляет голосовое в текущий чат через
 * существующую интеграцию»): Opus in an Ogg file — the only form WhatsApp's phones play as a voice note. A phone records
 * AAC in MP4 (iPhone) or Opus in WebM (Chrome); the bridge's Chrome turns it into Opus packets (WebCodecs, `PAGE_OPUS` —
 * no program to install) and this file puts them in Ogg pages (RFC 7845, RFC 3533). No dependencies; pure but for the
 * page's script.
 */

/** Opus's own rate: every Ogg Opus position counts 48 kHz samples. */
const RATE = 48000;
/** The encoder's look-ahead at 48 kHz (libopus): what a player skips at the start. */
export const PRE_SKIP = 312;

/** How many 48 kHz samples an Opus packet holds — read off its first byte (RFC 6716 §3.1). */
export function opusSamples(packet) {
  if (!packet?.length) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  // A frame's length in tenths of a millisecond: SILK 10/20/40/60, hybrid 10/20, CELT 2.5/5/10/20.
  const tenth = config < 12 ? [100, 200, 400, 600][config % 4] : config < 16 ? [100, 200][config % 2] : [25, 50, 100, 200][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return (frames * tenth * RATE) / 10_000;
}

/* The Ogg page's checksum: CRC-32, polynomial 0x04C11DB7, not reflected, from zero. */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();
export function oggCrc(bytes) {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

function page(packets, { granule, serial, seq, first, last }) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const body = Buffer.concat(packets);
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0, 'latin1');
  head[4] = 0;
  head[5] = (first ? 2 : 0) | (last ? 4 : 0);
  head.writeBigInt64LE(BigInt(granule), 6);
  head.writeUInt32LE(serial >>> 0, 14);
  head.writeUInt32LE(seq >>> 0, 18);
  head.writeUInt32LE(0, 22);
  head[26] = lacing.length;
  Buffer.from(lacing).copy(head, 27);
  const out = Buffer.concat([head, body]);
  out.writeUInt32LE(oggCrc(out), 22);
  return out;
}

/**
 * Opus packets (one channel) as an Ogg Opus file: its head, its tags, the sound — pages of at most 50 packets (one second),
 * each page's position the samples it ends at; the last one says where the voice ends (`samples` — its length at 48 kHz).
 */
export function oggOpus(packets, { samples, serial = 0x4d47, preSkip = PRE_SKIP, inputRate = RATE } = {}) {
  const list = packets.map((p) => Buffer.from(p)).filter((p) => p.length);
  if (!list.length) throw new Error('no sound');
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(inputRate, 12);
  head.writeInt16LE(0, 16);
  head[18] = 0;
  const vendor = Buffer.from('MyGarage', 'utf8');
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write('OpusTags', 0, 'latin1');
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);
  const pages = [page([head], { granule: 0, serial, seq: 0, first: true }), page([tags], { granule: 0, serial, seq: 1 })];
  let at = 0;
  const total = samples === undefined ? undefined : preSkip + samples;
  for (let i = 0, seq = 2; i < list.length; i += 50, seq++) {
    const part = list.slice(i, i + 50);
    at += part.reduce((n, p) => n + opusSamples(p), 0);
    const last = i + 50 >= list.length;
    const granule = last && total !== undefined ? Math.min(at, total) : at;
    pages.push(page(part, { granule, serial, seq, last }));
  }
  return Buffer.concat(pages);
}

/**
 * The bridge's Chrome (the page of WhatsApp Web) — the recording, any form Chrome can play, as Opus packets: decoded,
 * made one channel at 48 kHz, encoded by WebCodecs at 32 kbit/s (as WhatsApp's own voice notes). Returned in base64.
 */
export const PAGE_OPUS = async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const probe = new OfflineAudioContext(1, 1, 48000);
  const decoded = await probe.decodeAudioData(bin.buffer);
  const length = Math.max(1, Math.ceil(decoded.duration * 48000));
  const ctx = new OfflineAudioContext(1, length, 48000);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const pcm = (await ctx.startRendering()).getChannelData(0);
  const packets = [];
  let failed = null;
  const enc = new AudioEncoder({
    output: (chunk) => {
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      let s = '';
      for (const x of b) s += String.fromCharCode(x);
      packets.push(btoa(s));
    },
    error: (e) => {
      failed = e;
    },
  });
  enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000 });
  const step = 48000;
  for (let i = 0; i < pcm.length; i += step) {
    const part = pcm.slice(i, Math.min(pcm.length, i + step));
    enc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round((i * 1e6) / 48000), data: part }));
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  return { packets, samples: pcm.length };
};
