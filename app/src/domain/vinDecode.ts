import { canonicalMake, canonicalModel } from './carCatalog';
import { checkDigitOk, isVin, makeMatches, vinMaker, vinYear } from './vin';

/*
 * What car a VIN is (v0.81, the user's brief: «отсканировать VIN… подставить марку, модель и год там, где их удалось
 * надёжно определить… для данных авто — VIN-декодер или справочник… без генеративного ИИ»). Two sources, no AI:
 * - the app's own table: the maker by the VIN's first characters (`vinMaker`), the model year by its 10th character — only
 *   when the VIN carries its check digit (a VIN made to the North-American rule, where the 10th character is the year;
 *   elsewhere it may be anything);
 * - the official decoder of the USA's NHTSA (vPIC — free, open, no key; services/vinDecode.ts asks it with the VIN alone):
 *   it knows the cars sold in North America best, of others — the maker at least.
 * A field is filled only by what one of them says for sure; the decoder's word wins over the table's, but a make that
 * contradicts the table's maker is not taken. Pure.
 */

export interface VinCar {
  make?: string;
  model?: string;
  year?: number;
}

/** What the app's own table says of a VIN. */
export function vinCarLocal(vin: string, now = new Date()): VinCar {
  const v = vin.trim().toUpperCase();
  if (!isVin(v)) return {};
  const maker = vinMaker(v);
  const make = maker ? canonicalMake(title(maker)) : undefined;
  const year = checkDigitOk(v) ? vinYear(v, now) : undefined;
  return { ...(make ? { make } : {}), ...(year ? { year } : {}) };
}

/** The decoder's answer (`DecodeVinValues`, JSON) as the car: only what it gave, and only when it decoded the VIN. */
export function vpicCar(json: unknown, now = new Date()): VinCar {
  const r = (json as { Results?: Record<string, unknown>[] } | null)?.Results?.[0];
  if (!r) return {};
  const pick = (k: string) => String(r[k] ?? '').trim();
  // «0» — decoded cleanly. Other codes say what it could not read: errors in the VIN's characters or a VIN not whole
  // (5, 6) — only the maker stands; a wrong check digit or a model year it could not tell (1, 11) — no year (it is the
  // 10th character, which only the North-American rule makes the year).
  const codes = pick('ErrorCode')
    .split(/[,\s]+/)
    .filter(Boolean);
  const broken = codes.some((c) => c === '5' || c === '6');
  const noYear = broken || codes.some((c) => c === '1' || c === '11');
  const rawMake = pick('Make');
  const make = rawMake ? canonicalMake(title(rawMake)) : undefined;
  const rawModel = pick('Model');
  const model = rawModel && make && !broken ? canonicalModel(make, title(rawModel)) : undefined;
  const y = Number(pick('ModelYear'));
  const year = !noYear && Number.isInteger(y) && y >= 1980 && y <= now.getUTCFullYear() + 1 ? y : undefined;
  return { ...(make ? { make } : {}), ...(model ? { model } : {}), ...(year ? { year } : {}) };
}

/** The two said together: the decoder's word where it gave one and does not contradict the table's maker. */
export function mergeVinCar(local: VinCar, decoded: VinCar): VinCar {
  const same = (a?: string, b?: string) => !a || !b || plain(a) === plain(b) || plain(a).startsWith(plain(b)) || plain(b).startsWith(plain(a));
  // The decoder names another maker than the VIN's own code: neither its make nor its model is taken.
  if (!same(local.make, decoded.make)) return local;
  const make = decoded.make ?? local.make;
  const out: VinCar = {};
  if (make) out.make = make;
  if (decoded.model) out.model = decoded.model;
  const year = decoded.year ?? local.year;
  if (year) out.year = year;
  return out;
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const title = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

/* ---------- The garage's own cars (v0.88) ---------- */

/**
 * A VIN's first eight characters: the maker and its plant (1–3) and that maker's code of the model, body and engine
 * (4–8). The same stem — the same model (the 9th is a check, the 10th the year, the rest the car's own number).
 */
export const vinStem = (vin: string | undefined): string => {
  const v = (vin ?? '').trim().toUpperCase();
  return isVin(v) ? v.slice(0, 8) : '';
};

/** A car of the garage, as far as its VIN's stem goes. */
export interface StemCar {
  id: string;
  vin?: string;
  make?: string;
  model?: string;
  engine?: string;
  type?: string;
  /** What the AI put in its card (domain/types.ts `Vehicle.vinAi`): not a person's word. */
  vinAi?: { filled: string[] };
}

/**
 * What the garage itself knows of a VIN (v0.88, the owner: «по VIN ИИ узнала… марку угадала, но модель неверная: верный
 * Veloz, а ИИ написала Land Cruiser»): the make and model a person wrote on its other cars of the same stem — not the
 * AI's, and only when they all say the same (two models under one stem: neither); engine and body where they agree. A
 * make that is not the VIN's own maker is not taken. Before the AI, and over it.
 */
export function stemCar(vin: string, cars: StemCar[], selfId?: string): { make: string; model: string; engine?: string; type?: string } | undefined {
  const stem = vinStem(vin);
  if (!stem) return undefined;
  const theirs = cars.filter((c) => c.id !== selfId && vinStem(c.vin) === stem && c.make?.trim() && c.model?.trim() && !c.vinAi?.filled.includes('model') && !c.vinAi?.filled.includes('make'));
  if (!theirs.length) return undefined;
  const said = new Set(theirs.map((c) => `${plain(canonicalMake(c.make!.trim()))}|${plain(c.model!)}`));
  if (said.size !== 1) return undefined;
  const make = canonicalMake(theirs[0].make!.trim());
  if (makeMatches(vin.trim().toUpperCase(), make) === false) return undefined;
  const one = (values: (string | undefined)[]) => {
    const set = new Set(values.map((x) => x?.trim()).filter((x): x is string => !!x));
    return set.size === 1 ? [...set][0] : undefined;
  };
  const engine = one(theirs.map((c) => c.engine));
  const type = one(theirs.map((c) => c.type));
  return { make, model: theirs[0].model!.trim(), ...(engine ? { engine } : {}), ...(type ? { type } : {}) };
}
