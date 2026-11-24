import { mergeVinCar, vinCarLocal, vpicCar, type VinCar } from '../domain/vinDecode';

/*
 * What car a VIN is, for «Новый заказ» (v0.81): the app's own table at once, and the official NHTSA decoder (vPIC — free,
 * open, no key; it is asked with the VIN alone, nothing of the garage or the customer) when there is a network. No AI.
 * Rules — domain/vinDecode.ts. A VIN asked once is remembered while the app is open.
 */

const known = new Map<string, VinCar>();
const DECODER = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';

/** The decoder's answer for a VIN — or nothing (no network, no answer in 6 s). The e2e plays it (`setVinDecoder`). */
type Decoder = (vin: string) => Promise<unknown>;
let decoder: Decoder = async (vin) => {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${DECODER}${encodeURIComponent(vin)}?format=json`, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } finally {
    window.clearTimeout(timer);
  }
};

/** Tests and the e2e put their own decoder in. */
export function setVinDecoder(d: Decoder): void {
  decoder = d;
  known.clear();
}

/** The car a VIN is: make, model, year — each only where it is sure; the rest is left to the manager. */
export async function decodeVin(vin: string): Promise<VinCar> {
  const v = vin.trim().toUpperCase();
  const hit = known.get(v);
  if (hit) return hit;
  const local = vinCarLocal(v);
  let decoded: VinCar = {};
  try {
    decoded = vpicCar(await decoder(v));
  } catch {
    // no network: the table alone
  }
  const car = mergeVinCar(local, decoded);
  if (Object.keys(decoded).length) known.set(v, car);
  return car;
}

/** What the table alone says, at once (the decoder's word follows). */
export const vinCarNow = (vin: string): VinCar => known.get(vin.trim().toUpperCase()) ?? vinCarLocal(vin);
