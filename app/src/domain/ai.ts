import { canonicalMake, canonicalModel } from './carCatalog';
import { lineName } from './items';
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
  /** `web` — found by Google Search and checked on the pages; `model` — the AI's own knowledge, not checked anywhere. */
  search: 'web' | 'model';
  numbers: { number: string; brand?: string; note?: string; seen: string[] }[];
  sources?: { url: string; title?: string }[];
  images?: { type: string; data: string; source: string; number?: string }[];
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

/** Edits between two words, a swap of two letters side by side counted once (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
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

/**
 * A part number the app may write itself: found on the web and seen on the pages of two different catalogues. One page,
 * or the AI's own knowledge, is a candidate shown on the line — taken by a tap.
 */
export function provenNumber(find: Pick<AiFind, 'search' | 'numbers'>): string | undefined {
  if (find.search !== 'web') return undefined;
  const sure = find.numbers.filter((n) => new Set(n.seen.map(host).filter(Boolean)).size >= 2);
  return sure.length === 1 ? sure[0].number : undefined;
}
