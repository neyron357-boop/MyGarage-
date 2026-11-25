import { sameModel } from './ai';
import { CAR_MAKES, canonicalMake, canonicalModel } from './carCatalog';
import type { Vehicle } from './types';
import { isVin, makeMatches } from './vin';

/*
 * The car's make and model off its photo, and the VIN after it (v0.89, the owner: «распознавание марки и модели
 * автомобиля по фотографии, чтобы сразу заполнить… не факт, что стопроцентно все фотографии будут верно распознаны…
 * вторым этапом — VIN-код… если совпали марки и модели — ничего, просто оставляешь; если есть разногласия — приложение
 * должно попросить ручное вмешательство»). The garage's AI looks at a small photo (server/src/ai.mjs `car`); what it says is
 * taken here: only a make the app knows, only into what is empty. The VIN said later is held against it: the same car —
 * nothing; another — the person chooses (`Vehicle.carCheck`).
 */

/** The server's look at a car's photo. */
export interface AiCarPhoto {
  isCar?: boolean;
  make?: string;
  model?: string;
  confidence?: number;
}

/** What the photo says the car is (a model may be unknown: ''). */
export interface PhotoCar {
  make: string;
  model: string;
}

/** What the VIN says the car is: its maker always (its first characters), its model when someone knows it. */
export interface VinSaid {
  make?: string;
  model?: string;
}

const plain = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const sameMake = (a?: string, b?: string): boolean => !!plain(a) && plain(canonicalMake(a!)) === plain(canonicalMake(b ?? ''));

/**
 * The photo's answer as the app takes it: a car, a make of the catalogue (a make it does not know is a guess), sure
 * enough; its model only when surer still.
 */
export function photoCar(ai: AiCarPhoto | undefined): PhotoCar | undefined {
  if (!ai?.isCar || (ai.confidence ?? 0) < 0.5 || !ai.make?.trim()) return undefined;
  const make = canonicalMake(ai.make.trim());
  if (!CAR_MAKES.includes(make)) return undefined;
  const model = (ai.confidence ?? 0) >= 0.65 && ai.model?.trim() ? canonicalModel(make, ai.model.trim()).slice(0, 40) : '';
  return { make, model };
}

/** What of the photo's word goes into the card: what is empty — a model only under the same make (or none typed). */
export function photoFill(card: Pick<Vehicle, 'make' | 'model'>, photo: PhotoCar): Partial<Pick<Vehicle, 'make' | 'model'>> {
  const out: Partial<Pick<Vehicle, 'make' | 'model'>> = {};
  const make = card.make?.trim();
  if (!make) out.make = photo.make;
  if (photo.model && !card.model?.trim() && (!make || sameMake(make, photo.make))) out.model = photo.model;
  return out;
}

/** The card still says what the photo said (no person changed it since): only then is the photo's word held to the VIN. */
export function photoSays(card: Pick<Vehicle, 'make' | 'model' | 'photoAi'>): boolean {
  const p = card.photoAi;
  if (!p || p.checked) return false;
  return sameMake(card.make, p.make) && (!p.model || plain(card.model) === plain(p.model));
}

/**
 * The photo against the VIN. Undefined: they agree, or the VIN says too little to tell. Else what each says — for the
 * person to choose: the VIN's maker is not the card's make (its first characters are sure), or the model the VIN is
 * known to be (the garage's cars of the same VIN, the decoder, the AI sure of it) is another model.
 */
export function carCheckOf(card: Pick<Vehicle, 'make' | 'model' | 'photoAi'>, vin: string, said: VinSaid): { photo: PhotoCar; vin: VinSaid } | undefined {
  if (!photoSays(card) || !isVin(vin)) return undefined;
  const photo = { make: card.make.trim(), model: card.model?.trim() ?? '' };
  const makeOff = makeMatches(vin, photo.make) === false || (!!said.make && !sameMake(said.make, photo.make));
  const theMake = said.make || photo.make;
  const modelOff = !!said.model && !!photo.model && !sameModel(canonicalModel(theMake, said.model), canonicalModel(theMake, photo.model));
  if (!makeOff && !modelOff) return undefined;
  return { photo, vin: { make: said.make ? canonicalMake(said.make) : undefined, model: said.model?.trim() || undefined } };
}

/** The VIN said the same car (its model too): the photo's word is proven — it counts as a person's for the garage's next car. */
export function photoProven(card: Pick<Vehicle, 'make' | 'model' | 'photoAi'>, vin: string, said: VinSaid): boolean {
  if (!photoSays(card) || !isVin(vin) || !said.model || !card.model?.trim()) return false;
  return makeMatches(vin, card.make) !== false && (!said.make || sameMake(said.make, card.make)) && sameModel(canonicalModel(card.make, said.model), canonicalModel(card.make, card.model));
}
