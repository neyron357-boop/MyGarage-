import { db } from '../db/db';
import { carCheckOf, photoCar, photoFill, photoProven, sameMake, type AiCarPhoto, type PhotoCar, type VinSaid } from '../domain/carPhoto';
import { nowIso } from '../domain/dates';
import type { Vehicle } from '../domain/types';
import { aiOn, aiReadVinLater, askAi, notifyAi } from './ai';
import { shrinkPhoto } from './photoSize';

/*
 * The car's make and model off its photo, then the VIN (v0.89, domain/carPhoto.ts for the rules). Tokens kept few (the
 * owner: «расход токенов минимальный»): asked only for a car the garage does not know and whose make or model is empty,
 * a small picture (512 px, looked at in low resolution on the server), the same photo once on this device and once ever
 * on the server.
 */

/** The long side of the picture sent: the badges and the shape of the car still there, a few dozen kilobytes. */
const SIDE = 512;
/** The work the app shows the AI busy with while it looks (`useAiWorking`). */
export const CAR_PHOTO_WORK = 'carPhoto';

const asked = new WeakMap<Blob, Promise<PhotoCar | undefined>>();

/** The make and model the AI sees on this photo (asked once per photo; nothing — no server, no key, not sure). */
export function guessCar(file: Blob): Promise<PhotoCar | undefined> {
  if (!aiOn() || !file.type.startsWith('image/')) return Promise.resolve(undefined);
  let p = asked.get(file);
  if (!p) {
    p = (async () => {
      try {
        const small = (await shrinkPhoto(file, SIDE).catch(() => undefined)) ?? file;
        const bytes = new Uint8Array(await small.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const image = { type: small.type || 'image/jpeg', data: btoa(bin) };
        return photoCar(await askAi<AiCarPhoto>('car', { image }, CAR_PHOTO_WORK, 45_000));
      } catch {
        return undefined;
      }
    })();
    asked.set(file, p);
  }
  return p;
}

/** This photo was asked about already (the «Новый заказ» form asked it): its answer is used, not asked again. */
export const guessedFor = (file: Blob): boolean => asked.has(file);

/**
 * The car's main photo set (a new job's, or on the job): its make and model asked of it — only when the card lacks one
 * of them and no photo said them before; or, when «Новый заказ» asked this photo already, its answer kept for the VIN.
 * Not waited for.
 */
export function carPhotoLater(vehicleId: string, file: Blob) {
  void (async () => {
    const v = await db.vehicles.get(vehicleId);
    if (!v || v.photoAi) return;
    if (v.make?.trim() && v.model?.trim() && !guessedFor(file)) return;
    const guess = await guessCar(file);
    if (guess) await takePhotoCar(vehicleId, guess);
  })();
}

/** The photo's word into the card (only what is empty, with «Отменить»), kept for the VIN; held against a VIN said already. */
export async function takePhotoCar(vehicleId: string, guess: PhotoCar, { checked = false }: { /** A person chose it over the VIN already («Новый заказ»). */ checked?: boolean } = {}): Promise<void> {
  const v = await db.vehicles.get(vehicleId);
  if (!v || v.photoAi) return;
  const fill = photoFill(v, guess);
  await db.vehicles.update(vehicleId, { ...fill, photoAi: { make: guess.make, model: guess.model, at: nowIso(), ...(checked ? { checked: true as const } : {}) } });
  const keys = Object.keys(fill) as (keyof typeof fill)[];
  if (keys.length)
    notifyAi({
      kind: 'car',
      vehicleId,
      filled: fill,
      from: 'photo',
      undo: async () => {
        const cur = await db.vehicles.get(vehicleId);
        if (!cur) return;
        const back: Partial<Vehicle> = {};
        for (const k of keys) if (cur[k] === fill[k]) back[k] = v[k];
        await db.vehicles.update(vehicleId, back);
      },
    });
  // The VIN came first: read already — its word is there to hold the photo's against; not read yet (typed or scanned in
  // «Новый заказ») — read now, the photo's word to hold against it.
  const vin = v.vin?.toUpperCase();
  if (vin && v.vinAi?.vin === vin) await checkCarByVin(vehicleId, vin, { make: v.vinAi.make, model: v.vinAi.model });
  else if (vin) aiReadVinLater(vehicleId);
}

/** «Новый заказ» found the photo and the VIN apart and nobody chose before «Принять»: the job asks it. */
export async function askCarCheck(vehicleId: string, check: { photo: PhotoCar; vin: VinSaid }): Promise<void> {
  await db.vehicles.update(vehicleId, { carCheck: { photo: check.photo, vin: check.vin, at: nowIso() } });
}

/**
 * What the VIN said, against the photo's word in the card (services/ai.ts `aiReadVin` calls it with the VIN's reading):
 * another car — the person is asked (`carCheck`); the same car, its model too — the photo's word is proven.
 */
export async function checkCarByVin(vehicleId: string, vin: string, said: VinSaid): Promise<void> {
  const v = await db.vehicles.get(vehicleId);
  if (!v) return;
  const check = carCheckOf(v, vin, said);
  if (check) await db.vehicles.update(vehicleId, { carCheck: { photo: check.photo, vin: check.vin, at: nowIso() } });
  else if (photoProven(v, vin, said)) await db.vehicles.update(vehicleId, { photoAi: { ...v.photoAi!, checked: true }, carCheck: undefined });
}

/**
 * The person chose (the job's «Фото или VIN» sheet): that make and model are the card's, the question goes. The photo's
 * own chosen — it counts as proven (a person said so).
 */
export async function settleCarCheck(vehicleId: string, pick: { make?: string; model?: string }): Promise<void> {
  const v = await db.vehicles.get(vehicleId);
  if (!v) return;
  const make = pick.make?.trim() || v.make;
  // Another make and no model said with it: the old model is of the other car — empty, for the person to write.
  const model = pick.model !== undefined ? pick.model.trim() : sameMake(make, v.make) ? v.model : '';
  const photoChosen = !!v.photoAi && sameMake(make, v.photoAi.make) && model.toLowerCase() === v.photoAi.model.toLowerCase();
  await db.vehicles.update(vehicleId, {
    make,
    model,
    carCheck: undefined,
    ...(photoChosen ? { photoAi: { ...v.photoAi!, checked: true as const } } : {}),
    // A person's word now (the garage's next car of the same VIN takes it — domain/vinDecode.ts `stemCar`).
    ...(v.vinAi?.filled.some((k) => k === 'make' || k === 'model') ? { vinAi: { ...v.vinAi, filled: v.vinAi.filled.filter((k) => k !== 'make' && k !== 'model') } } : {}),
  });
}
