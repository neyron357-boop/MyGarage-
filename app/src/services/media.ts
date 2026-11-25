import { exifTakenAt } from '../domain/exifDate';
import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { sha256Bytes, toHex } from '../domain/sha256';
import type { Media, MediaBlob, MediaOwner } from '../domain/types';
import { CARD_SIDE, shrinkPhoto } from './photoSize';
import { onMediaArrived, remoteMedia, remoteMediaSrc, sendCard } from './sync/engine';

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

/**
 * A photo turned a quarter to the left (−90) or the right (90), or upside down: the picture at its size and a
 * thumbnail, ready to be stored as is (`addMedia` with `thumb`). Browser only.
 */
export async function turnPhoto(file: Blob, turn: 90 | -90 | 180, quality = 0.86): Promise<{ blob: Blob; thumb: Blob }> {
  const bmp = await createImageBitmap(file);
  const draw = (max: number, q: number) => {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const quarter = turn !== 180;
    const canvas = document.createElement('canvas');
    canvas.width = quarter ? h : w;
    canvas.height = quarter ? w : h;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', q));
  };
  try {
    return { blob: await draw(1920, quality), thumb: await draw(400, 0.7) };
  } finally {
    bmp.close();
  }
}

/** A media taken off, with its file — to put it back ("Undo"). */
export interface RemovedMedia {
  media: Media;
  blob?: MediaBlob;
}

export async function takeMedia(id: string): Promise<RemovedMedia | undefined> {
  return db.transaction('rw', db.media, db.mediaBlobs, async () => {
    const media = await db.media.get(id);
    if (!media) return undefined;
    const blob = await db.mediaBlobs.get(id);
    await db.media.delete(id); // throws ImmutableError when locked
    await db.mediaBlobs.delete(id);
    return { media, blob };
  });
}

export async function putBackMedia(r: RemovedMedia): Promise<void> {
  await db.transaction('rw', db.media, db.mediaBlobs, async () => {
    await db.media.put(r.media);
    if (r.blob) await db.mediaBlobs.put(r.blob);
  });
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
  /** When it was taken, said by whoever adds it (a turned copy keeps the photo's) — over the file's own Exif (v0.88). */
  takenAt?: string;
}

/** A photo's own moment (its Exif) — none when it does not say or cannot be read. */
async function takenAtOf(file: Blob): Promise<string | undefined> {
  try {
    return exifTakenAt(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
  } catch {
    return undefined;
  }
}

export async function addMedia(input: AddMediaInput): Promise<Media> {
  const kind: Media['kind'] =
    input.kind ?? (input.file.type.startsWith('video/') ? 'video' : input.file.type.startsWith('audio/') ? 'audio' : input.file.type === 'application/pdf' ? 'pdf' : 'photo');
  let blob = input.file;
  let thumb: Blob | undefined = input.thumb;
  // When it was taken (v0.88): read off the file before it is made smaller (that drops its Exif).
  const takenAt = input.takenAt ?? (kind === 'photo' ? await takenAtOf(input.file) : undefined);
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
    ...(takenAt ? { takenAt } : {}),
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

/**
 * A photo's (video's, PDF's…) file — here, or from the garage's server when it went there (v0.40: originals leave the
 * phone; previews stay, and one brought from the server is kept as a preview).
 */
async function fileOf(id: string, thumb: boolean): Promise<Blob | undefined> {
  const rec = await db.mediaBlobs.get(id);
  if (thumb && rec?.thumb) return rec.thumb;
  if (rec?.blob) return rec.blob;
  if (thumb) {
    const t = await remoteMedia(id, 'thumb');
    if (t) {
      if (!rec) void db.mediaBlobs.put({ id, thumb: t, up: 1 }).catch(() => undefined);
      else void db.mediaBlobs.update(id, { thumb: t }).catch(() => undefined);
      return t;
    }
  }
  return (await remoteMedia(id, 'blob')) ?? rec?.thumb;
}

export async function mediaUrl(id: string, thumb = false): Promise<string | undefined> {
  const key = `${id}:${thumb ? 't' : 'f'}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const blob = await fileOf(id, thumb);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

/** The address of a photo at card size made before (`cardUrl`). */
export function cachedCardUrl(id: string): string | undefined {
  return urlCache.get(`${id}:c`);
}

/** Cards made here from an original: one at a time (a board of cars does not decode twenty full photos at once). */
let cardQueue: Promise<unknown> = Promise.resolve();
const cardJobs = new Map<string, Promise<string | undefined>>();

async function keepCard(id: string, had: boolean, card: Blob): Promise<void> {
  try {
    if (had) await db.mediaBlobs.update(id, { card });
    else await db.mediaBlobs.put({ id, card, up: 1 });
  } catch {
    // kept for this visit only (shown from memory)
  }
}

/**
 * A photo at the size a card across the phone shows it (long side 1080 px — sharp on an iPhone, about a third of the
 * stored photo's bytes), kept beside it once made or brought (v0.37: not made again at every start). Not here: the
 * server's card (v0.41.3: sent with the photo, or made by the garage's computer) — brought alongside the others, not
 * one at a time; only when the server has none is it made here from the original, and sent back for the others.
 */
export function cardUrl(id: string): Promise<string | undefined> {
  const key = `${id}:c`;
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = cardJobs.get(id);
  if (running) return running;
  const job = (async () => {
    const rec = await db.mediaBlobs.get(id);
    let card = rec?.card;
    if (!card && !rec?.blob) {
      card = await remoteMedia(id, 'card');
      if (card) await keepCard(id, !!rec, card);
    }
    let shown = card;
    if (!shown) {
      shown = (await (cardQueue = cardQueue.then(async () => {
        // The original here, or brought from the server once (the card it makes is kept here: a board stays a board).
        const source = rec?.blob ?? (await remoteMedia(id, 'blob'));
        if (!source) return undefined;
        const made = await shrinkPhoto(source, CARD_SIDE);
        if (made) {
          await keepCard(id, !!rec, made);
          // Made from the server's original: the server keeps it too — the next device brings the card, not the photo.
          if (!rec?.blob) sendCard(id, made);
        } else if (!rec?.blob) await keepCard(id, !!rec, source);
        return made ?? source;
      }).catch(() => undefined))) as Blob | undefined;
    }
    if (!shown) return undefined;
    const url = URL.createObjectURL(shown);
    urlCache.set(key, url);
    return url;
  })().finally(() => cardJobs.delete(id));
  cardJobs.set(id, job);
  return job;
}

/**
 * A photo at a card's size as a file (v0.41.3: sharing a job — sharp enough, a third of the original's bytes): the one
 * kept here, else the server's; the photo itself when it is small or no card can be had.
 */
export async function cardBlob(id: string): Promise<Blob | undefined> {
  await cardUrl(id).catch(() => undefined);
  const rec = await db.mediaBlobs.get(id);
  return rec?.card ?? rec?.blob ?? (await remoteMedia(id, 'card')) ?? (await remoteMedia(id, 'blob'));
}

/**
 * Files found on the server only. Their address is made anew each time (v0.59.4): the server's address changes (a new
 * tunnel after the computer starts again) while the app stays open — one kept from before led nowhere.
 */
const onServer = new Set<string>();

/** The address a picture or a video element loads by itself, made before (`mediaSrc`). */
export function cachedMediaSrc(id: string): string | undefined {
  return urlCache.get(`${id}:f`) ?? (onServer.has(id) ? remoteMediaSrc(id, 'blob') : undefined);
}

/**
 * The address a picture or a video element loads by itself (v0.41.3): its own copy when it is here; else the server's
 * — the browser streams it (a video plays as it comes, its first frame without the rest), shows it as it arrives and
 * keeps it. Without that address (an older connection), the file is brought whole, as before.
 */
export async function mediaSrc(id: string): Promise<string | undefined> {
  const made = cachedMediaSrc(id);
  if (made) return made;
  const rec = await db.mediaBlobs.get(id);
  if (!rec?.blob) {
    const remote = remoteMediaSrc(id, 'blob');
    if (remote) {
      onServer.add(id);
      return remote;
    }
  }
  return mediaUrl(id, false);
}

/**
 * Photos that came from another device (v0.41.3): their previews — and a car's main photos, their cards — brought now,
 * two at a time, so the board and the job show them at once when they are opened.
 */
async function warm(list: { id: string; card: boolean }[]) {
  const queue = [...list];
  const worker = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      try {
        await fileOf(x.id, true);
        if (x.card) await cardUrl(x.id);
      } catch {
        // later, when it is shown
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
onMediaArrived((list) => void warm(list));

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function mediaDataUrl(id: string, thumb = true): Promise<string | undefined> {
  const blob = await fileOf(id, thumb);
  return blob ? blobToDataUrl(blob) : undefined;
}

/** The file itself (here, or from the server): none when neither has it. */
export async function mediaBlob(id: string): Promise<Blob | undefined> {
  return (await db.mediaBlobs.get(id))?.blob ?? (await remoteMedia(id, 'blob'));
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
