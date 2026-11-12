import { db } from '../db/db';
import type { Media } from '../domain/types';
import { addMedia, deleteMedia } from './media';

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
  const orders = await db.orders.where('vehicleId').anyOf(rest).toArray();
  if (!orders.length) return out;
  const inspections = await db.inspections.where('orderId').anyOf(orders.map((o) => o.id)).toArray();
  if (!inspections.length) return out;
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const inspOf = new Map(inspections.map((i) => [i.id, i]));
  const photos = (await db.media.where('ownerId').anyOf(inspections.map((i) => i.id)).toArray())
    .filter((m) => m.kind === 'photo' && rank(m.slot) >= 0)
    .map((m) => {
      const insp = inspOf.get(m.ownerId)!;
      const order = orderOf.get(insp.orderId)!;
      return { m, vehicleId: order.vehicleId, at: order.createdAt, rank: rank(m.slot), handover: insp.kind === 'handover' ? 1 : 0 };
    })
    // The latest visit first, then the best angle, the check-in before the hand-over.
    .sort((a, b) => b.at.localeCompare(a.at) || a.rank - b.rank || a.handover - b.handover || a.m.createdAt.localeCompare(b.m.createdAt));
  for (const p of photos) if (!out.has(p.vehicleId)) out.set(p.vehicleId, p.m.id);
  return out;
}

export async function coverOf(vehicleId: string): Promise<string | undefined> {
  return (await coverIndex([vehicleId])).get(vehicleId);
}

/** One photo the car keeps (its main photo, its VIN plate): a new one replaces the one before. */
async function setCarPhoto(vehicleId: string, slot: 'cover' | 'vin', file: Blob): Promise<Media> {
  const before = (await db.media.where('ownerId').equals(vehicleId).toArray()).filter((m) => m.slot === slot);
  const media = await addMedia({ ownerType: 'vehicle', ownerId: vehicleId, slot, file });
  for (const m of before) await deleteMedia(m.id);
  return media;
}

/** A new main photo for the car: the one taken for it before goes, the check-in photos stay. */
export const setCover = (vehicleId: string, file: Blob) => setCarPhoto(vehicleId, 'cover', file);

/** The photo of the car's VIN (the plate on the body or the windscreen), kept with the car for every visit. */
export const setVinPhoto = (vehicleId: string, file: Blob) => setCarPhoto(vehicleId, 'vin', file);

export async function vinPhotoOf(vehicleId: string): Promise<string | undefined> {
  const list = (await db.media.where('ownerId').equals(vehicleId).toArray()).filter((m) => m.slot === 'vin' && m.kind === 'photo');
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;
}
