import { canonicalMake, canonicalModel } from './carCatalog';
import { formatNumber, sameNumber } from './partNumbers';
import { partKey } from './partsVocab';

/*
 * The garage's own memory of parts (v0.49): the numbers it bought before, for the same part on the same car, are the
 * best catalogue there is — fitted, paid for, no guessing. A new line is looked up here before any AI: a number fitted
 * before on this model goes on the line at once; a number used but not fitted, or a web search made for the same part
 * lately, is offered and spares the search. Pure: lines in, a verdict out.
 */

export interface CarKey {
  make: string;
  model: string;
  year?: number;
  engine?: string;
}

/** A part line of another job, as the memory sees it. */
export interface PriorPart {
  id: string;
  jobId: string;
  jobNo?: number;
  /** When the line was made (ISO). */
  at: string;
  /** The line's name (its English one when it has one). */
  name: string;
  number?: string;
  /** The part came (received / installed) or the line was done: the number was bought and fitted. */
  fitted: boolean;
  car: CarKey;
  /** A web search the AI made on that line: when, and what it found (with where each number was seen). */
  web?: { at: string; numbers: { number: string; brand?: string; note?: string; seen: string[] }[] };
  /** The pictures the AI kept on that line. */
  diagramIds?: string[];
  sampleIds?: string[];
}

export interface MemoryNumber {
  number: string;
  /** Lines it was on, and on how many of them it was fitted. */
  times: number;
  fitted: number;
  lastAt: string;
  jobs: number[];
  /** The latest line it was on (its pictures). */
  from: PriorPart;
}

export interface Memory {
  /** The numbers used before, the most used (and fitted) first. */
  numbers: MemoryNumber[];
  /** One number fitted before and no other: the line's number, no question. */
  proven?: string;
  /** A web search made lately for the same part on the same car: its answer serves again. */
  web?: PriorPart;
}

/** The litres of an engine as typed («2.5L», «V6 4.0», «2.5»), or the text itself when it names none. */
const engineKey = (e: string) => /\d\.\d/.exec(e)?.[0] ?? e.toLowerCase().replace(/[^a-z0-9а-я]/g, '');

/**
 * The same car for the parts' sake: the same make and model; the years within three of each other (four when the engine
 * is the same — one generation); the engines the same when both are known. A car whose model is not known matches none.
 */
export function sameCar(a: CarKey, b: CarKey): boolean {
  const make = canonicalMake(a.make).toLowerCase();
  if (!make || make !== canonicalMake(b.make).toLowerCase()) return false;
  const model = canonicalModel(a.make, a.model).toLowerCase();
  if (!model || model !== canonicalModel(b.make, b.model).toLowerCase()) return false;
  const engines = a.engine?.trim() && b.engine?.trim() ? (engineKey(a.engine) === engineKey(b.engine) ? 'same' : 'differ') : 'unknown';
  if (engines === 'differ') return false;
  if (a.year && b.year && Math.abs(a.year - b.year) > (engines === 'same' ? 4 : 3)) return false;
  return true;
}

const DAY = 24 * 60 * 60_000;

/** What the garage remembers about this part on this car. `webDays` — how long a web search made before serves again. */
export function partsMemory(prior: PriorPart[], car: CarKey, name: string, now = new Date(), webDays = 30): Memory {
  const key = partKey(name);
  if (!key) return { numbers: [] };
  const mine = prior.filter((p) => partKey(p.name) === key && sameCar(p.car, car)).sort((a, b) => b.at.localeCompare(a.at));
  const numbers: MemoryNumber[] = [];
  for (const p of mine) {
    if (!p.number?.trim()) continue;
    const had = numbers.find((n) => sameNumber(n.number, p.number!));
    if (had) {
      had.times++;
      if (p.fitted) had.fitted++;
      if (p.jobNo && !had.jobs.includes(p.jobNo)) had.jobs.push(p.jobNo);
      // The latest line with pictures is the one to copy them from.
      if (!had.from.diagramIds?.length && !had.from.sampleIds?.length && (p.diagramIds?.length || p.sampleIds?.length)) had.from = p;
    } else numbers.push({ number: formatNumber(car.make, p.number), times: 1, fitted: p.fitted ? 1 : 0, lastAt: p.at, jobs: p.jobNo ? [p.jobNo] : [], from: p });
  }
  numbers.sort((a, b) => b.fitted - a.fitted || b.times - a.times || b.lastAt.localeCompare(a.lastAt));
  const fitted = numbers.filter((n) => n.fitted > 0);
  const proven = fitted.length === 1 ? fitted[0].number : undefined;
  const web = mine.find((p) => p.web && p.web.numbers.length && now.getTime() - new Date(p.web.at).getTime() <= webDays * DAY);
  return { numbers, proven, web };
}
