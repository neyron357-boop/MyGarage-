/*
 * When a photo was taken, by the photo itself (v0.88, the owner: «зафиксируйте дату фотографии — фактическую дату, когда
 * я фотографирую автомобиль»): a JPEG's Exif DateTimeOriginal (0x9003), with its OffsetTimeOriginal (0x9011) when the
 * camera wrote one — else the time is the UAE's (+04:00, the garage's phones); the plain DateTime (0x0132) when there is
 * no original. A photo picked from the phone keeps the moment it was taken, not the moment it was added. Pure: the file's
 * first bytes (the photo is made smaller before it is kept, and that drops its Exif — read before).
 */

const UAE = '+04:00';

/** The moment the photo was taken (ISO, UTC) — none when the file does not say (or says nonsense). */
export function exifTakenAt(bytes: Uint8Array, now: Date = new Date()): string | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return undefined;
    const marker = bytes[p + 1];
    // The picture's own data begins: no Exif before it.
    if (marker === 0xda || marker === 0xd9) return undefined;
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) return undefined;
    // APP1 «Exif\0\0» then a TIFF.
    if (marker === 0xe1 && bytes[p + 4] === 0x45 && bytes[p + 5] === 0x78 && bytes[p + 6] === 0x69 && bytes[p + 7] === 0x66 && bytes[p + 8] === 0 && bytes[p + 9] === 0) {
      return tiffTakenAt(bytes, p + 10, Math.min(bytes.length, p + 2 + len), now);
    }
    p += 2 + len;
  }
  return undefined;
}

function tiffTakenAt(b: Uint8Array, start: number, end: number, now: Date): string | undefined {
  const le = b[start] === 0x49 && b[start + 1] === 0x49;
  const be = b[start] === 0x4d && b[start + 1] === 0x4d;
  if (!le && !be) return undefined;
  const u16 = (o: number) => (o < start || o + 2 > end ? -1 : le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (o < start || o + 4 > end ? -1 : le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  interface Entry {
    tag: number;
    count: number;
    at: number;
  }
  const entries = (ifd: number): Entry[] => {
    const n = u16(ifd);
    const out: Entry[] = [];
    for (let i = 0; i < n && i < 300; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      out.push({ tag: u16(e), count: u32(e + 4), at: e + 8 });
    }
    return out;
  };
  const ascii = (e: Entry): string => {
    if (e.count <= 0 || e.count > 64) return '';
    const off = e.count <= 4 ? e.at : start + u32(e.at);
    if (off < start || off + e.count > end) return '';
    let s = '';
    for (let i = 0; i < e.count; i++) {
      const c = b[off + i];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  const first = u32(start + 4);
  if (first < 8) return undefined;
  let exif = -1;
  let plain = '';
  for (const e of entries(start + first)) {
    if (e.tag === 0x8769) exif = start + u32(e.at);
    else if (e.tag === 0x0132) plain = ascii(e);
  }
  let original = '';
  let offset = '';
  if (exif > start)
    for (const e of entries(exif)) {
      if (e.tag === 0x9003) original = ascii(e);
      else if (e.tag === 0x9011) offset = ascii(e);
    }
  return moment(original || plain, offset, now);
}

/** «2026:11:25 14:32:07» (+ «+04:00») → ISO — not before 2000, not after tomorrow. */
function moment(text: string, offset: string, now: Date): string | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return undefined;
  const zone = /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : UAE;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`);
  if (!Number.isFinite(t) || t < Date.parse('2000-01-01T00:00:00Z') || t > now.getTime() + 24 * 60 * 60_000) return undefined;
  return new Date(t).toISOString();
}
