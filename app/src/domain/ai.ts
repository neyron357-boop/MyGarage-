import { canonicalMake, canonicalModel } from './carCatalog';
import { lineName } from './items';
import { numberPlausible } from './partNumbers';
import type { Vehicle, VehicleType } from './types';
import { isVin, makeMatches, vinYear } from './vin';

/*
 * What the garage's AI says (v0.48 — Gemini on the garage's server, server/src/ai.mjs) and what of it the app takes:
 * the AI is asked, the app decides. Like a VIN read off a photo, nothing it says goes over what was typed — it fills
 * what is empty, and only what agrees with what the app knows itself.
 */

/** The server's reading of a VIN. */
export interface AiVin {
  vin: string;
  make?: string;
  model?: string;
  year?: number;
  engine?: string;
  body?: string;
  confidence?: number;
  /** The official NHTSA decoder's facts it was given. */
  facts?: { make?: string; model?: string; year?: string } | null;
}

/** The server's answer about a part's name as typed. */
export interface AiName {
  fixed?: string;
  english?: string;
  isPart?: boolean;
  confidence?: number;
}

/** The server's search for a part's number: each number and the catalogue pages it was seen on (opened there). */
export interface AiFind {
  /** `web` — found by Google Search and checked on the pages; `model` — the AI's own knowledge, not checked anywhere; `garage` — the garage's own jobs. */
  search: 'web' | 'model' | 'garage';
  /**
   * `garage` — on how many of the garage's own lines for this car the number was (v0.49). From the maker's open
   * catalogue, read by the garage's server (v0.55): `fits` — the number is on a diagram of this car's model and years
   * (of its frame, when that is known); `name` — the maker's own name of the part; `model` — the diagram's model and
   * years («Yaris NCP91 · 2005–2011»); `replaces` — the older numbers this one stands for (one part).
   */
  numbers: FoundNumber[];
  sources?: { url: string; title?: string }[];
  /**
   * Pictures: the part's factory diagram (v0.55 — from the catalogue, `marks`: where the part's callout is on it, in
   * the picture's own pixels) first, then a photo of the part (a sample).
   */
  images?: { type: string; data: string; source: string; number?: string; kind?: 'diagram' | 'photo'; marks?: PictureMark[]; title?: string }[];
  /** How far the search had to go (v0.55): 0 — the catalogue alone, 1 — a web search, 2 — with the pages read, 3 — a deep one. */
  stage?: number;
  /** The AI's note for the garage (v0.64): why the numbers differ, what to check — a line of the answer it gave anyway. */
  note?: string;
}
export interface FoundNumber {
  number: string;
  brand?: string;
  note?: string;
  seen: string[];
  garage?: number;
  fits?: boolean;
  name?: string;
  model?: string;
  replaces?: string[];
}
/** A place on a picture, in its own pixels. */
export interface PictureMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type CarFields = Pick<Vehicle, 'make' | 'model' | 'year' | 'engine' | 'type'>;
const TYPES: VehicleType[] = ['pickup', 'van', 'bus', 'truck', 'suv', 'mpv', 'sedan'];

/** «TOYOTA» → «Toyota» (a make not in the catalogue, written in capitals). */
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()) : s);
const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What the AI's reading of a VIN puts in the car's card: only fields that are empty, only when it is sure enough, and
 * only what agrees with the VIN itself — its maker by its first characters, its year by its 10th (or the year 30 before:
 * the code repeats), the official decoder's year when it gave one. A car whose make is typed and is not the AI's keeps
 * its model too: one of them is wrong.
 */
export function vinFill(car: CarFields, vin: string, ai: AiVin, now = new Date()): Partial<CarFields> {
  const out: Partial<CarFields> = {};
  if (!isVin(vin) || ai.vin !== vin || (ai.confidence ?? 0) < 0.6) return out;
  const make = ai.make?.trim() ? titleCase(canonicalMake(ai.make)) : '';
  // The AI's make is not the VIN's maker: nothing it says about the car is taken.
  if (make && makeMatches(vin, make) === false) return out;
  if (make && car.make?.trim() && !same(canonicalMake(car.make), make)) return out;
  if (make && !car.make?.trim()) out.make = make;
  const theMake = car.make?.trim() || make;
  if (ai.model?.trim() && !car.model?.trim() && theMake) out.model = titleCase(canonicalModel(theMake, ai.model.trim())).slice(0, 40);
  const y = vinYear(vin, now);
  const factsYear = Number(ai.facts?.year) || undefined;
  if (ai.year && !car.year && y && (ai.year === y || ai.year === y - 30) && (!factsYear || factsYear === ai.year)) out.year = ai.year;
  if (ai.engine?.trim() && !car.engine?.trim()) out.engine = ai.engine.trim().slice(0, 40);
  const body = ai.body?.trim().toLowerCase() as VehicleType | undefined;
  if (body && TYPES.includes(body) && !car.type) out.type = body;
  return out;
}

/**
 * Edits between two words, a swap of two letters side by side counted once (optimal string alignment). Three rows of
 * numbers, not a table of arrays (v0.54: called thousands of times a search, the table was most of a phone's work).
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const n = b.length;
  let before = new Uint16Array(n + 1);
  let prev = new Uint16Array(n + 1);
  let cur = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
      cur[j] = v;
    }
    [before, prev, cur] = [prev, cur, before];
  }
  return prev[n];
}

/**
 * The name as typed and the AI's spelling of it are the same words with typing mistakes put right: as many words, in
 * the same order, each a letter or two off (a quarter of the word at most), numbers and sizes exactly as typed.
 */
export function onlyTypos(typed: string, fixed: string): boolean {
  const a = typed.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const b = fixed.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!a.length || a.length !== b.length) return false;
  return a.every((w, i) => {
    const v = b[i];
    if (/\d/.test(w) || /\d/.test(v)) return w === v;
    return editDistance(w, v) <= Math.max(1, Math.ceil(w.length / 4));
  });
}

/**
 * What the AI changes in a part's name: its spelling, when only typing mistakes were put right and it is sure; and
 * its English name (the documents are in English) — for a name typed in Russian with no English one yet.
 */
export function nameFix(typed: string, ai: AiName, hasEnglish: boolean): { title?: string; english?: string } {
  const out: { title?: string; english?: string } = {};
  if (!ai.isPart || (ai.confidence ?? 0) < 0.7) return out;
  const was = lineName(typed.trim());
  const fixed = ai.fixed?.trim() ? lineName(ai.fixed.trim()) : '';
  if (fixed && fixed !== was && onlyTypos(was, fixed)) out.title = fixed;
  const en = ai.english?.trim() ? lineName(ai.english.trim()) : '';
  if (!hasEnglish && /[а-яё]/i.test(was) && en && !/[а-яё]/i.test(en) && en.length <= 60) out.english = en;
  return out;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** How many different catalogues (sites) a number was seen on. */
export const catalogCount = (seen: string[]): number => new Set(seen.map(host).filter(Boolean)).size;

/** The site a catalogue page is on, as said under a number or a diagram («amayama.com»). */
export const siteOf = host;

/**
 * A part number the app may write itself: on a diagram of this very car in the maker's catalogue (v0.55 — the garage's
 * server read its page), or found on the web and seen on the pages of two different catalogues — or on one and used by
 * the garage itself before on this car (v0.49) — and shaped like the maker's numbers (a Toyota number is ten
 * characters: a shape the maker's catalogue would not write is a guess). Two such — neither (the variants of a part:
 * a person picks). One page, or the AI's own knowledge, is a candidate shown on the line — taken by a tap.
 */
export function provenNumber(find: Pick<AiFind, 'search' | 'numbers'>, make = ''): string | undefined {
  if (find.search !== 'web') return undefined;
  const sure = find.numbers.filter((n) => numberPlausible(make, n.number) !== false && (n.fits === true || catalogCount(n.seen) + ((n.garage ?? 0) > 0 ? 1 : 0) >= 2));
  return sure.length === 1 ? sure[0].number : undefined;
}

/**
 * The number written with nobody looking (the AI for every part of a job; the user: «номера добавлять, если они точные;
 * если вышли сразу несколько — не добавлять»): the proven one, when it is the only one that came — or it is on this
 * car's diagram in the catalogue and the others are not (v0.55: they are no rivals to it).
 */
export function soleNumber(find: Pick<AiFind, 'search' | 'numbers'>, make = ''): string | undefined {
  const proven = provenNumber(find, make);
  const own = proven ? find.numbers.find((n) => n.number === proven) : undefined;
  if (!proven || !own) return undefined;
  if (own.fits) return proven;
  return find.numbers.some((n) => n !== own && (n.seen.length > 0 || (n.garage ?? 0) > 0)) ? undefined : proven;
}

/**
 * A short note on what was found (v0.64, the user: «короткое примечание на английском про результат: на что обратить
 * внимание, почему разные номера деталей… не очень длинно и экономично по токенам»): the AI's own line, when its answer
 * had one (a few words in the answer it gave anyway — no question of its own); else what the app knows itself — the
 * maker's catalogue, the garage's own jobs, in how many catalogues a number was seen. Two sentences at most, in English
 * (the trade's language here, as on the list sent to a supplier).
 */
export function findNote(find: Pick<AiFind, 'search' | 'numbers' | 'note'>): string | undefined {
  const list = find.numbers;
  if (!list.length) return undefined;
  const said = find.note?.replace(/\s+/g, ' ').trim();
  if (said) return said;
  const out: string[] = [];
  const fits = list.filter((n) => n.fits);
  const sure = list.filter((n) => catalogCount(n.seen) + ((n.garage ?? 0) > 0 ? 1 : 0) >= 2);
  if (find.search === 'garage') out.push(list.length > 1 ? 'Numbers fitted on this car before — the most used first.' : 'Fitted on this car before.');
  else if (find.search === 'model') out.push("From the AI's memory, not checked online — confirm by VIN before ordering.");
  else if (fits.length === 1) out.push(`${fits[0].number} is on this car's diagram in the maker's catalogue.`);
  else if (fits.length > 1) out.push(`${fits.length} numbers on this car's diagram — variants: check the VIN or build date.`);
  else if (sure.length === 1) out.push(`${sure[0].number} is confirmed in ${catalogCount(sure[0].seen) || 1} catalogue${catalogCount(sure[0].seen) > 1 ? 's' : ''}${(sure[0].garage ?? 0) > 0 ? ' and the garage’s jobs' : ''}.`);
  else if (sure.length > 1) out.push(`${sure.length} confirmed variants — check the VIN or build date before ordering.`);
  else out.push(list.length > 1 ? 'None confirmed twice — check the VIN with the supplier.' : 'Seen in one place only — confirm with the supplier.');
  const replaced = list.find((n) => n.replaces?.length);
  const firm = fits.length ? fits : sure;
  if (replaced) out.push(`${replaced.number} supersedes ${replaced.replaces!.slice(0, 2).join(', ')} — the same part.`);
  else if (find.search === 'web' && firm.length && list.length > firm.length) out.push(fits.length ? 'The others are not on its diagram.' : 'The others are unconfirmed.');
  return out.join(' ');
}

/** A car that can be looked a part up for: its make, or its VIN (v0.55 — a third of the garage's first searches had neither). */
export const carKnown = (car?: { make?: string; vin?: string }): boolean => !!car?.make?.trim() || isVin((car?.vin ?? '').toUpperCase());

/**
 * What is bought by its kind and size, not by a catalogue number (v0.55): tyres, oils and other fluids, gas — the AI for
 * every part of a job passes them by (asked for one by name — «Найти номер» — it still looks).
 */
export function boughtBySpec(name: string): boolean {
  // What the thing is — its head word: the last in English («ENGINE OIL 5W30», «2 FRONT TYRES»), the first in Russian
  // («масло моторное»); sizes, counts and what is in brackets set aside. «OIL FILTER», «COOLANT HOSE» are parts.
  const words = name
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-ZА-ЯЁ0-9/]+/)
    .filter((w) => w && !/\d/.test(w));
  if (!words.length) return false;
  return /^(TYRES?|TIRES?|OIL|ATF|COOLANT|ANTIFREEZE|FLUID|GREASE|FREON|REFRIGERANT|GAS)$/.test(words[words.length - 1]) || /^(ШИН[АЫ]|РЕЗИН[АЫУ]|МАСЛО|АНТИФРИЗ|ТОСОЛ|ЖИДКОСТЬ|СМАЗК[АИУ]|ФРЕОН)$/.test(words[0]);
}
