import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { sha256Bytes, toHex } from '../domain/sha256';
import type { Media, MediaOwner } from '../domain/types';

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  // crypto.subtle is only available on HTTPS/localhost; fall back to the plain JS implementation.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return toHex(new Uint8Array(await subtle.digest('SHA-256', buf)));
  return toHex(sha256Bytes(new Uint8Array(buf)));
}

/** Resize a photo for storage (long side 1920 px) and make a 400 px thumbnail. Browser only. */
export async function compressImage(file: Blob, maxSide = 1920, quality = 0.8): Promise<{ blob: Blob; thumb: Blob }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const draw = (max: number, q: number) => {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', q),
    );
  };
  try {
    return { blob: await draw(maxSide, quality), thumb: await draw(400, 0.7) };
  } finally {
    bmp.close();
  }
}

export interface AddMediaInput {
  ownerType: MediaOwner;
  ownerId: string;
  slot: string;
  file: Blob;
  kind?: Media['kind'];
  name?: string;
  compress?: boolean;
  locked?: boolean;
  /** A photo already sized for storage (in-app camera) comes with its thumbnail and is stored as is. */
  thumb?: Blob;
}

export async function addMedia(input: AddMediaInput): Promise<Media> {
  const kind: Media['kind'] =
    input.kind ?? (input.file.type.startsWith('video/') ? 'video' : input.file.type.startsWith('audio/') ? 'audio' : input.file.type === 'application/pdf' ? 'pdf' : 'photo');
  let blob = input.file;
  let thumb: Blob | undefined = input.thumb;
  if (kind === 'video' && blob.size > MAX_VIDEO_BYTES) throw new Error('video_too_large');
  if (kind === 'photo' && !thumb && input.compress !== false && typeof document !== 'undefined') {
    try {
      const c = await compressImage(blob);
      blob = c.blob;
      thumb = c.thumb;
    } catch {
      // keep the original if the browser cannot decode it
    }
  }
  const media: Media = {
    id: uid(),
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    slot: input.slot,
    kind,
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    sha256: await sha256Hex(blob),
    name: input.name,
    locked: input.locked ?? false,
    createdAt: nowIso(),
  };
  await db.transaction('rw', db.media, db.mediaBlobs, async () => {
    await db.media.add(media);
    await db.mediaBlobs.add({ id: media.id, blob, thumb });
  });
  return media;
}

export async function deleteMedia(id: string): Promise<void> {
  await db.transaction('rw', db.media, db.mediaBlobs, async () => {
    await db.media.delete(id); // throws ImmutableError when locked
    await db.mediaBlobs.delete(id);
  });
}

export async function lockMediaOf(ownerIds: string[]): Promise<void> {
  const list = await db.media.where('ownerId').anyOf(ownerIds).toArray();
  for (const m of list) if (!m.locked) await db.media.update(m.id, { locked: true });
}

const urlCache = new Map<string, string>();

/** The address of a photo made before (a list shown again draws it at once, with no empty frame). */
export function cachedMediaUrl(id: string, thumb = false): string | undefined {
  return urlCache.get(`${id}:${thumb ? 't' : 'f'}`);
}

export async function mediaUrl(id: string, thumb = false): Promise<string | undefined> {
  const key = `${id}:${thumb ? 't' : 'f'}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const rec = await db.mediaBlobs.get(id);
  if (!rec) return undefined;
  const blob = thumb && rec.thumb ? rec.thumb : rec.blob;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function mediaDataUrl(id: string, thumb = true): Promise<string | undefined> {
  const rec = await db.mediaBlobs.get(id);
  if (!rec) return undefined;
  return blobToDataUrl(thumb && rec.thumb ? rec.thumb : rec.blob);
}

export async function mediaBlob(id: string): Promise<Blob | undefined> {
  return (await db.mediaBlobs.get(id))?.blob;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
