import { db, whereAnyOf } from '../db/db';
import type { Media } from '../domain/types';
import { AppError } from './errors';
import { addMedia, deleteMedia, mediaBlob, putBackMedia, takeMedia, turnPhoto, type RemovedMedia } from './media';

/*
 * The car's main photo, on its job and on the board: the one taken for it (media of the vehicle,
 * slot "cover"), else the best walk-around photo of its latest visit — the front three-quarter
 * first, the way a car is pictured. It belongs to the car, so the next visit shows it too.
 */

export const COVER_SLOTS = ['front_left', 'front_right', 'front', 'rear_left', 'rear_right', 'left', 'right', 'rear'];
const rank = (slot: string) => COVER_SLOTS.indexOf(slot);

/** Main photos of many cars at once (the board): vehicle id → media id. Cars without photos are left out. */
export async function coverIndex(vehicleIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(vehicleIds)];
  if (!ids.length) return out;
  const taken = (await db.media.where('ownerId').anyOf(ids).toArray())
    .filter((m) => m.slot === 'cover' && m.kind === 'photo')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const m of taken) if (!out.has(m.ownerId)) out.set(m.ownerId, m.id);

  const rest = ids.filter((id) => !out.has(id));
  if (!rest.length) return out;
  // A car's photo is its latest visit's that has one: the visits are gone over the latest first, a few dozen at a time,
  // and older ones only for the cars still without (v0.37 — a regular's years of visits and their photos are not all
  // read). Visits made at the same moment are looked at together, as one.
  const orders = (await whereAnyOf(db.orders, 'vehicleId', rest)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const todo = new Set(rest);
  for (let from = 0; from < orders.length && todo.size; ) {
    let to = Math.min(orders.length, from + 24);
    while (to < orders.length && orders[to].createdAt === orders[to - 1].createdAt) to++;
    const batch = orders.slice(from, to).filter((o) => todo.has(o.vehicleId));
    from = to;
    if (!batch.length) continue;
    const inspections = await db.inspections.where('orderId').anyOf(batch.map((o) => o.id)).toArray();
    if (!inspections.length) continue;
    const orderOf = new Map(batch.map((o) => [o.id, o]));
    const inspOf = new Map(inspections.map((i) => [i.id, i]));
    const photos = (await whereAnyOf(db.media, 'ownerId', inspections.map((i) => i.id)))
      .filter((m) => m.kind === 'photo' && rank(m.slot) >= 0)
      .map((m) => {
        const insp = inspOf.get(m.ownerId)!;
        const order = orderOf.get(insp.orderId)!;
        return { m, vehicleId: order.vehicleId, at: order.createdAt, rank: rank(m.slot), handover: insp.kind === 'handover' ? 1 : 0 };
      })
      // The latest visit first, then the best angle, the check-in before the hand-over.
      .sort((a, b) => b.at.localeCompare(a.at) || a.rank - b.rank || a.handover - b.handover || a.m.createdAt.localeCompare(b.m.createdAt));
    for (const p of photos) if (todo.delete(p.vehicleId)) out.set(p.vehicleId, p.m.id);
  }
  return out;
}

export async function coverOf(vehicleId: string): Promise<string | undefined> {
  return (await coverIndex([vehicleId])).get(vehicleId);
}

/** The places of the car's own photos: its main photo, its VIN plate, the two sides of the Mulkiya. */
export type CarSlot = 'cover' | 'vin' | MulkiyaSide;

/** One photo the car keeps (its main photo, its VIN plate): a new one replaces the one before. */
async function setCarPhoto(vehicleId: string, slot: CarSlot, file: Blob, thumb?: Blob): Promise<Media> {
  const before = (await db.media.where('ownerId').equals(vehicleId).toArray()).filter((m) => m.slot === slot);
  const media = await addMedia({ ownerType: 'vehicle', ownerId: vehicleId, slot, file, thumb });
  for (const m of before) await deleteMedia(m.id);
  return media;
}

/**
 * The photo shown in a place of the car turned a quarter (−90 — to the left): kept with the car in place of
 * the one before. A photo of a check-in act is not changed — the car gets its turned copy.
 */
export async function rotateCarPhoto(vehicleId: string, slot: CarSlot, mediaId: string, turn: 90 | -90 = -90): Promise<Media> {
  const blob = await mediaBlob(mediaId);
  if (!blob) throw new AppError('err.notFound');
  const turned = await turnPhoto(blob, turn);
  return setCarPhoto(vehicleId, slot, turned.blob, turned.thumb);
}

/** Which of these photos are the car's own (taken for it — not a check-in act's, which stay as they are). */
export async function carOwned(ids: (string | undefined)[]): Promise<Set<string>> {
  const list = (await db.media.bulkGet(ids.filter((id): id is string => !!id))).filter((m): m is Media => !!m);
  return new Set(list.filter((m) => m.ownerType === 'vehicle').map((m) => m.id));
}

/** A wrong photo of the car taken off (its own only) — kept to put back ("Undo"). */
export async function removeCarPhoto(mediaId: string): Promise<RemovedMedia> {
  const m = await db.media.get(mediaId);
  if (!m || m.ownerType !== 'vehicle') throw new AppError('err.notFound');
  const removed = await takeMedia(mediaId);
  if (!removed) throw new AppError('err.notFound');
  return removed;
}

export const restoreCarPhoto = (r: RemovedMedia) => putBackMedia(r);

/** A new main photo for the car: the one taken for it before goes, the check-in photos stay. */
export const setCover = (vehicleId: string, file: Blob) => setCarPhoto(vehicleId, 'cover', file);

/** The photo of the car's VIN (the plate on the body or the windscreen), kept with the car for every visit. */
export const setVinPhoto = (vehicleId: string, file: Blob) => setCarPhoto(vehicleId, 'vin', file);

export async function vinPhotoOf(vehicleId: string): Promise<string | undefined> {
  const list = (await db.media.where('ownerId').equals(vehicleId).toArray()).filter((m) => m.slot === 'vin' && m.kind === 'photo');
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;
}

/** The two sides of the Mulkiya (the registration card): the front with the owner, the back with the car's data. */
export type MulkiyaSide = 'mulkiya' | 'mulkiya_back';
export const MULKIYA_SIDES: MulkiyaSide[] = ['mulkiya', 'mulkiya_back'];

/**
 * The car's Mulkiya, both sides: taken for the car (kept for every visit), else the photos of it in its
 * check-in acts (the latest visit first) — where the Mulkiya was photographed before.
 */
export async function mulkiyaOf(vehicleId: string): Promise<Partial<Record<MulkiyaSide, string>>> {
  const isSide = (slot: string): slot is MulkiyaSide => (MULKIYA_SIDES as string[]).includes(slot);
  const out: Partial<Record<MulkiyaSide, string>> = {};
  const own = (await db.media.where('ownerId').equals(vehicleId).toArray())
    .filter((m) => m.kind === 'photo' && isSide(m.slot))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const m of own) if (isSide(m.slot) && !out[m.slot]) out[m.slot] = m.id;
  if (MULKIYA_SIDES.every((s) => out[s])) return out;
  const orders = await db.orders.where('vehicleId').equals(vehicleId).toArray();
  if (!orders.length) return out;
  const visit = new Map(orders.map((o) => [o.id, o.createdAt]));
  const acts = (await db.inspections.where('orderId').anyOf(orders.map((o) => o.id)).toArray()).filter((i) => i.kind === 'intake');
  if (!acts.length) return out;
  const when = new Map(acts.map((i) => [i.id, visit.get(i.orderId) ?? '']));
  const shots = (await db.media.where('ownerId').anyOf(acts.map((i) => i.id)).toArray())
    .filter((m) => m.kind === 'photo' && isSide(m.slot))
    .sort((a, b) => (when.get(b.ownerId) ?? '').localeCompare(when.get(a.ownerId) ?? '') || b.createdAt.localeCompare(a.createdAt));
  for (const m of shots) if (isSide(m.slot) && !out[m.slot]) out[m.slot] = m.id;
  return out;
}

/** One side of the Mulkiya, kept with the car: a new one replaces the one taken for it before. */
export const setMulkiya = (vehicleId: string, side: MulkiyaSide, file: Blob) => setCarPhoto(vehicleId, side, file);
