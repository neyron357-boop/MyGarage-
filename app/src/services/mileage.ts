import { db, uid, whereAnyOf } from '../db/db';
import { nowIso } from '../domain/dates';
import { odometerKm } from '../domain/obdReport';
import { MAX_KM, type OdoPick } from '../domain/odometer';
import type { Inspection, Order } from '../domain/types';
import { AppError } from './errors';
import { addMedia, deleteMedia, mediaBlob } from './media';

/*
 * A job's mileage (v0.44): what the odometer showed on this visit — read off its photo («Пробег» on the job's card) or
 * typed. A reading sure of itself goes in by itself (into a job that has none); a doubtful one is offered
 * (`order.mileageOffered`) until it is looked at. The car's mileage before — its other visits, their old acts and
 * scanner reports — tells what is likely now and is shown with its next visit.
 */

const SLOT = 'odometer';

/** The job's photo of the odometer (the latest). */
export async function odometerPhotoOf(orderId: string): Promise<string | undefined> {
  const list = (await db.media.where('ownerId').equals(orderId).toArray()).filter((m) => m.ownerType === 'order' && m.slot === SLOT);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;
}

/** A photo of the odometer for the job: it takes the place of the one before (a retake of a blurred one). */
export async function setOdometerPhoto(orderId: string, file: Blob): Promise<string> {
  const before = (await db.media.where('ownerId').equals(orderId).toArray()).filter((m) => m.ownerType === 'order' && m.slot === SLOT);
  const media = await addMedia({ ownerType: 'order', ownerId: orderId, slot: SLOT, file });
  for (const m of before) await deleteMedia(m.id);
  return media.id;
}

const noted = (orderId: string) => db.events.add({ id: uid(), orderId, at: nowIso(), type: 'updated', payload: { fields: ['mileage'] } });

/** The job's mileage as typed or looked at (none — taken off): what the photo offered is done with. */
export async function setJobMileage(orderId: string, km: number | undefined): Promise<void> {
  if (km !== undefined && !(Number.isInteger(km) && km >= 0 && km <= MAX_KM)) throw new AppError('err.mileage');
  await db.transaction('rw', db.orders, db.events, async () => {
    const o = await db.orders.get(orderId);
    if (!o) throw new AppError('err.notFound');
    if (o.mileageKm === km && !o.mileageOffered) return;
    await db.orders.update(orderId, { mileageKm: km, mileageOffered: undefined, updatedAt: nowIso() });
    await noted(orderId);
  });
}

/** What a reading of the odometer's photo did to the job: the mileage it filled in, what it offers, whether anything waits to be looked at. */
export interface OdoTaken {
  filled?: number;
  offered: number[];
  look: boolean;
}

/**
 * What the photo was read as, into the job: sure, and the job has no mileage yet — its mileage (`filled`); the job's
 * own mileage read (sure or not), or nothing read while the job has one — nothing to look at; else — offered, the
 * job's own mileage untouched (`offered`; nothing read on a job without a mileage — an empty list: the photo waits to
 * be looked at). The offer stays on the job (`mileageOffered`) until the mileage is saved or taken off.
 */
export async function takeOdometerRead(orderId: string, pick: OdoPick): Promise<OdoTaken> {
  return db.transaction('rw', db.orders, db.events, async () => {
    const o = await db.orders.get(orderId);
    if (!o) return { offered: [], look: false };
    const has = o.mileageKm !== undefined;
    if (pick.sure && pick.km !== undefined && (!has || o.mileageKm === pick.km)) {
      if (o.mileageKm === pick.km && !o.mileageOffered) return { offered: [], look: false };
      await db.orders.update(orderId, { mileageKm: pick.km, mileageOffered: undefined, updatedAt: nowIso() });
      await noted(orderId);
      return { filled: has ? undefined : pick.km, offered: [], look: false };
    }
    const offered = pick.offered.filter((km) => km !== o.mileageKm);
    if (has && (pick.km === o.mileageKm || !offered.length)) {
      if (o.mileageOffered) await db.orders.update(orderId, { mileageOffered: undefined, updatedAt: nowIso() });
      return { offered: [], look: false };
    }
    await db.orders.update(orderId, { mileageOffered: offered, updatedAt: nowIso() });
    return { offered, look: true };
  });
}

/** The job's photo of the odometer read (the car's last mileage helps), and what was read written into the job. */
export async function readJobOdometer(orderId: string): Promise<OdoTaken> {
  const [order, photo] = await Promise.all([db.orders.get(orderId), odometerPhotoOf(orderId)]);
  if (!order || !photo) return { offered: [], look: false };
  const blob = await mediaBlob(photo);
  if (!blob) return { offered: [], look: false };
  const prev = await previousMileage(order);
  const { readOdometer } = await import('./odometerReader');
  return takeOdometerRead(orderId, await readOdometer(blob, prev?.km));
}

/** A visit's mileage: the job's own (v0.44), else its handover or check-in act's, else its scanner report's. */
export function mileageOfJob(order: Pick<Order, 'mileageKm' | 'obdScans'>, acts: Pick<Inspection, 'kind' | 'mileageKm'>[] = []): number | undefined {
  if (order.mileageKm !== undefined) return order.mileageKm;
  const act = acts.find((a) => a.kind === 'handover' && a.mileageKm !== undefined) ?? acts.find((a) => a.mileageKm !== undefined);
  if (act?.mileageKm !== undefined) return act.mileageKm;
  for (const s of [...(order.obdScans ?? [])].reverse()) {
    const km = odometerKm(s.odometer);
    if (km !== undefined) return km;
  }
  return undefined;
}

export interface MileageEntry {
  km: number;
  /** The visit's day: when the car came (or the job was made). */
  at: string;
  orderId: string;
  number: number;
}

/** The car's mileage on each of its visits that has one, the earliest first. */
export async function mileageHistory(vehicleId: string): Promise<MileageEntry[]> {
  const orders = await db.orders.where('vehicleId').equals(vehicleId).toArray();
  const acts = orders.length ? await whereAnyOf(db.inspections, 'orderId', orders.map((o) => o.id)) : [];
  const out: MileageEntry[] = [];
  for (const o of orders) {
    const km = mileageOfJob(
      o,
      acts.filter((a) => a.orderId === o.id),
    );
    if (km !== undefined) out.push({ km, at: o.arrivedAt || o.createdAt, orderId: o.id, number: o.number });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The car's last mileage before this visit (none: its first visit here, or none was noted). */
export async function previousMileage(order: Pick<Order, 'id' | 'vehicleId' | 'createdAt' | 'arrivedAt'>): Promise<MileageEntry | undefined> {
  const at = order.arrivedAt || order.createdAt;
  return (await mileageHistory(order.vehicleId)).filter((e) => e.orderId !== order.id && e.at <= at).at(-1);
}
