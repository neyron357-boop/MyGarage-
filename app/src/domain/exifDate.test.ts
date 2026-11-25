import { describe, expect, it } from 'vitest';
import { exifTakenAt } from './exifDate';

/** A JPEG's head with an Exif: IFD0 → the Exif IFD with DateTimeOriginal (and its offset, when given). */
function jpeg(original: string, offset?: string, big = false): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (big ? [(v >> 8) & 255, v & 255] : [v & 255, (v >> 8) & 255]);
  const u32 = (v: number) => (big ? [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255] : [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat([0]);
  const ifd0 = 8;
  const exifIfd = ifd0 + 2 + 12 + 4;
  const n = offset ? 2 : 1;
  const strings = exifIfd + 2 + n * 12 + 4;
  const date = text(original);
  const zone = offset ? text(offset) : [];
  tiff.push(...(big ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(ifd0));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd), ...u32(0));
  tiff.push(...u16(n), ...u16(0x9003), ...u16(2), ...u32(date.length), ...u32(strings));
  if (offset) tiff.push(...u16(0x9011), ...u16(2), ...u32(zone.length), ...u32(strings + date.length));
  tiff.push(...u32(0), ...date, ...zone);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 255, len & 255, ...app1, 0xff, 0xda, 0, 2]);
}

const NOW = new Date('2026-11-25T16:00:00Z');

describe('v0.88: when a photo was taken — by the photo itself', () => {
  it('its Exif moment, in the UAE’s time when the camera did not write a zone', () => {
    expect(exifTakenAt(jpeg('2026:11:20 09:15:00'), NOW)).toBe('2026-11-20T05:15:00.000Z');
    expect(exifTakenAt(jpeg('2026:11:20 09:15:00', '+03:00'), NOW)).toBe('2026-11-20T06:15:00.000Z');
    expect(exifTakenAt(jpeg('2026:11:20 09:15:00', undefined, true), NOW)).toBe('2026-11-20T05:15:00.000Z');
  });
  it('nothing when the file does not say it, or says nonsense', () => {
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), NOW)).toBeUndefined();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg('0000:00:00 00:00:00'), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg('2027:05:01 10:00:00'), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg('1990:05:01 10:00:00'), NOW)).toBeUndefined();
    expect(exifTakenAt(jpeg('2026:11:20 09:15:00').slice(0, 30), NOW)).toBeUndefined();
  });
});
