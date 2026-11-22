import { canonicalMake } from './carCatalog';
import { sameNumber } from './partNumbers';
import type { Vehicle } from './types';
import { isVin, vinBuilt } from './vin';

/*
 * Does this part number fit this car? (v0.65, the user's task: «устранить критические ошибки определения OEM-номеров…
 * система должна предпочесть результат «Не удалось подтвердить», а не выдать ошибочный OEM-номер с зелёной галочкой».)
 *
 * The failure it answers (ENGINE BELT, a Honda): 31110-RSA-G01 / G02 were shown green, «confirmed» — and the belt on the
 * car was a 7PK2164 while those two are 7PK1535 belts. The search had only found that the numbers EXIST: two sites had
 * them (the same catalogue's data on both), the maker's catalogue had them on a diagram of the model in those years — and
 * a model's diagrams are of all its engines and drives (with A/C or without, the belt differs). Nothing ever compared the
 * part with the car's configuration or with the part on the car.
 *
 * Here the finding of a number and the proof that it fits are kept apart. A number's status is decided by these rules
 * alone, from the evidence kept with it — never by the AI, never by how many pages have it:
 *
 *   verified    — fits this very car: fitted on it before (the garage's own job, work done), or a maker's supersession
 *                 of a number fitted on it, or the maker's catalogue has it on a diagram of the car's own configuration
 *                 code as the manager typed it, with what the part's kind needs known (its engine; a belt — its size
 *                 the same as the belt on the car);
 *   partial     — real matches, but something it needs is not known (the maker's catalogue lists it for the model and
 *                 years — not the engine, the drive, the trim; fitted on another car of the model; the same size as the
 *                 part on the car);
 *   unverified  — found (a search, a page, the AI's memory), its fitting not shown;
 *   conflict    — the sources or the facts disagree (a belt of another size than the one on the car; two sizes said of
 *                 it; the catalogue lists it for other models; another number fitted on this car);
 *   rejected    — shown not to fit (the catalogue calls it another part; the other side or axle).
 *
 * Green — verified only. What is not known stays not known: no engine, trim or market is made up from a VIN.
 */

export type FitStatus = 'verified' | 'partial' | 'unverified' | 'conflict' | 'rejected';

/** A ribbed (poly-V) belt's size as its marking says: 7PK2164 — 7 ribs, profile PK, 2164 mm. */
export interface BeltSpec {
  kind: 'ribbed';
  ribs: number;
  profile: string;
  lengthMm: number;
  /** As written: «7PK2164». */
  text: string;
}
/** A part's size or type, as a marking or a source says it (more kinds of part — more kinds here). */
export type PartSpec = BeltSpec;

/** What the part on the car says of itself — its marking, typed by the manager or read off its photo. */
export interface Marking {
  text: string;
  from: 'typed' | 'photo';
  /** 0…1: typed — 1; read off a photo — how sure the reading is. */
  confidence: number;
  /** Other readings of the same photo (a 1 that may be an l). */
  alternatives?: string[];
  mediaId?: string;
  /** What the photo's reading said, as read (kept with the photo it came from). */
  raw?: string;
  at: string;
}

/** The maker's catalogue (EPC) on a number, read by the garage's server — its own data, no AI (server/src/partfind.mjs). */
export interface EpcCheck {
  /** read — its page; none — no such number in it; unreachable — the catalogue did not answer; unread — not asked; no-make — it has no such make. */
  state: 'read' | 'none' | 'unreachable' | 'unread' | 'no-make';
  url?: string;
  /** The maker's own name of the part. */
  name?: string;
  /** Its name is of the part asked for (false — another part; none — nothing to compare). */
  kind?: boolean;
  /** How many diagrams it is on. */
  diagrams?: number;
  /** model — on a diagram of the car's model in its years; other — only on other models' diagrams; unknown — no year, no model, no diagrams. */
  fit?: 'model' | 'other' | 'unknown';
  /** The headings of the diagrams that are of the car's model («Civic FD1 · 2005–2011»). */
  headings?: string[];
  /** It fits through an older number it stands for. */
  via?: 'own' | 'older';
}

/** What the garage's server found out about a number, kept with it (v0.65). */
export interface NumberCheck {
  at: string;
  epc: EpcCheck;
  /** Pages that have it (opened by the server), search results Google read it from. */
  web: { url: string; how: 'page' | 'search' }[];
  /** Sizes said of it, and by whom. */
  specs: { text: string; by: 'page' | 'epc' | 'ai'; from?: string }[];
  /** Who named it first: the garage's own line, the AI's memory, a search. */
  named: 'garage' | 'memory' | 'search';
}

/** A number found for a line (domain/ai.ts `FoundNumber`) — the part of it this needs. */
export interface Candidate {
  number: string;
  brand?: string;
  note?: string;
  seen: string[];
  garage?: number;
  fits?: boolean;
  name?: string;
  model?: string;
  replaces?: string[];
  check?: NumberCheck;
}

/** A use of this part by the garage before: the number on a line of this kind of part for a car of the model. */
export interface GarageUse {
  number: string;
  /** The line's name (its side and axle count). */
  name: string;
  /** On this very car. */
  sameVehicle: boolean;
  /** The part was fitted: the work done, or the part installed (not merely bought). */
  installed: boolean;
  jobNo?: number;
  at: string;
}

/** A fact about the car, and where it comes from: typed (or the VIN's own code) — known; the AI's reading — not proof. */
export interface Fact<T> {
  value?: T;
  by: 'typed' | 'vin' | 'ai' | 'none';
}
export interface CarFacts {
  vehicleId?: string;
  make: Fact<string>;
  model: Fact<string>;
  year: Fact<number>;
  engine: Fact<string>;
  vin: 'valid' | 'invalid' | 'none';
  /** Where the VIN's maker code says it was built — not the market it was made for. */
  built?: string;
  /** Configuration codes the manager typed in the model («Civic FD1», «Land Cruiser URJ202»). */
  frames: string[];
}

/** What the car's card says, each fact with its source. Nothing is added that the card does not have. */
export function carFacts(v: Pick<Vehicle, 'id' | 'make' | 'model' | 'year' | 'engine' | 'vin' | 'vinAi'> | undefined): CarFacts {
  const ai = new Set(v?.vinAi && v.vin && v.vinAi.vin === v.vin.toUpperCase() ? v.vinAi.filled : []);
  const vin = (v?.vin ?? '').toUpperCase().replace(/\s/g, '');
  const valid = isVin(vin);
  const fact = <T>(value: T | undefined, key: 'make' | 'model' | 'year' | 'engine'): Fact<T> => {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return { by: 'none' };
    // The AI's make and year are taken only when the VIN's own codes agree (domain/ai.ts `vinFill`) — the VIN's facts.
    if (ai.has(key)) return { value, by: key === 'make' || key === 'year' ? 'vin' : 'ai' };
    return { value, by: 'typed' };
  };
  const model = fact(v?.model?.trim(), 'model');
  const frames = model.by === 'typed' ? frameCodesIn(String(model.value)) : [];
  return {
    vehicleId: v?.id,
    make: fact(v?.make?.trim(), 'make'),
    model,
    year: fact(v?.year, 'year'),
    engine: fact(v?.engine?.trim(), 'engine'),
    vin: !vin ? 'none' : valid ? 'valid' : 'invalid',
    built: valid ? vinBuilt(vin) : undefined,
    frames,
  };
}

/** Configuration codes in a model as typed: «FD1», «URJ202», «GRJ150» — letters then digits (not a year, not «2.4»). */
export function frameCodesIn(model: string): string[] {
  const out: string[] = [];
  for (const w of String(model).toUpperCase().split(/[\s/,()]+/)) {
    if (/^[A-Z]{1,4}\d{1,3}[A-Z]?$/.test(w) && !/^(V|W|L)\d$/.test(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

/*
 * The kinds of part, each with its own rules (one test for every part would be wrong): what of the car must be known for
 * a number to be verified, whether its side or axle must agree, whether its marking can be read and compared.
 */
export type PartCategory = 'belt' | 'timing' | 'filter' | 'brake' | 'sensor' | 'suspension' | 'cooling' | 'body' | 'lighting' | 'electrical' | 'engine' | 'other';
export type Need = 'vin' | 'model' | 'year' | 'engine' | 'frame' | 'drive' | 'transmission' | 'marking' | 'candidateSpec' | 'markingUnclear' | 'position' | 'epc' | 'oem';

interface Rule {
  /** What of the car must be known (not guessed) to verify a number of this kind. */
  needs: Need[];
  /** Its axle (front / rear) matters. */
  axle?: boolean;
  /** Its side (left / right) matters. */
  side?: boolean;
  /** Its marking is read and compared (belts: ribs, profile, length). */
  spec?: 'belt';
}

export const RULES: Record<PartCategory, Rule> = {
  // A belt differs by engine and by what it drives (with A/C, power steering or without): the drive is never in a card —
  // the size of the belt on the car stands for it.
  belt: { needs: ['engine', 'drive'], spec: 'belt' },
  timing: { needs: ['engine'] },
  filter: { needs: ['engine'] },
  brake: { needs: ['year'], axle: true },
  sensor: { needs: ['engine'] },
  suspension: { needs: ['year'], axle: true, side: true },
  cooling: { needs: ['engine', 'transmission'] },
  body: { needs: ['year'] },
  lighting: { needs: ['year'], side: true },
  electrical: { needs: ['engine'] },
  engine: { needs: ['engine'] },
  other: { needs: ['vin'] },
};

const has = (name: string, re: RegExp) => re.test(name);
/** What kind of part a line is, by its name (English or Russian). */
export function partCategory(name: string): PartCategory {
  const n = ` ${String(name ?? '').toUpperCase().replace(/Ё/g, 'Е')} `;
  if (has(n, /SEAT ?BELT|РЕМ(ЕНЬ|НЯ) БЕЗОПАСНОСТИ/)) return 'body';
  if (has(n, /TIMING|CAM ?BELT|\bГРМ\b|ЗУБЧАТ/)) return 'timing';
  if (has(n, /\bBELTS?\b|РЕМЕН|РЕМНЯ|РЕМНИ/)) return 'belt';
  if (has(n, /SENSOR|ДАТЧИК|\bO2\b|OXYGEN|LAMBDA|ЛЯМБДА/)) return 'sensor';
  if (has(n, /FILTER|ФИЛЬТР/)) return 'filter';
  if (has(n, /BRAKE|\bPADS?\b|\bDISCS?\b|ROTOR|CALIPER|\bSHOES?\b|\bDRUMS?\b|ТОРМОЗ|КОЛОДК|СУППОРТ/)) return 'brake';
  if (has(n, /SHOCK|ABSORBER|STRUT|\bARMS?\b|\bLINKS?\b|BUSH|BALL ?JOINT|TIE ?ROD|STABILI[SZ]ER|SPRING|АМОРТ|РЫЧАГ|СТОЙК|ШАРОВ|САЙЛЕНТ|ВТУЛК|НАКОНЕЧН|ТЯГ|ПРУЖИН/)) return 'suspension';
  if (has(n, /RADIATOR|WATER ?PUMP|THERMOSTAT|CONDENSER|COOLANT|\bFAN\b|РАДИАТОР|ПОМП|ТЕРМОСТАТ|КОНДЕНСЕР|ВЕНТИЛЯТОР/)) return 'cooling';
  if (has(n, /LAMP|LIGHT|HEADLAMP|\bFOG\b|ФАР[АЫ]|ФОНАР|ПОВОРОТНИК|ПРОТИВОТУМАН/)) return 'lighting';
  if (has(n, /BUMPER|\bDOORS?\b|FENDER|\bHOOD\b|BONNET|MIRROR|GRILLE|PANEL|TAILGATE|БАМПЕР|ДВЕР|КРЫЛ|КАПОТ|ЗЕРКАЛ|РЕШЕТК|ПАНЕЛ/)) return 'body';
  if (has(n, /ALTERNATOR|STARTER|\bCOIL\b|RELAY|SWITCH|\bECU\b|MODULE|BATTERY|ГЕНЕРАТОР|СТАРТЕР|КАТУШК|РЕЛЕ|АККУМУЛЯТОР|БЛОК УПР/)) return 'electrical';
  if (has(n, /GASKET|\bSEAL\b|MOUNT|PISTON|VALVE|\bPLUGS?\b|INJECTOR|ПРОКЛАДК|САЛЬНИК|ПОДУШК|СВЕЧ|ФОРСУН|КЛАПАН/)) return 'engine';
  return 'other';
}

/** Where on the car a part's name puts it: its axle and its side (English, Russian, a catalogue's FR / RR / LH / RH). */
export function positionOf(name: string): { axle?: 'front' | 'rear'; side?: 'left' | 'right' } {
  const n = ` ${String(name ?? '').toUpperCase().replace(/Ё/g, 'Е')} `;
  const front = /\b(FRONT|FR|FRT|FWD)\b|ПЕРЕДН/.test(n);
  const rear = /\b(REAR|RR|BACK)\b|ЗАДН/.test(n);
  const left = /\b(LEFT|LH|L\/H|LHS)\b|ЛЕВ/.test(n);
  const right = /\b(RIGHT|RH|R\/H|RHS)\b|ПРАВ/.test(n);
  return { ...(front !== rear ? { axle: front ? 'front' : 'rear' } : {}), ...(left !== right ? { side: left ? 'left' : 'right' } : {}) };
}

/** Two names put the part in different places (a front part asked, a rear one found; left and right). */
export function positionConflict(a: string, b: string): 'axle' | 'side' | undefined {
  const x = positionOf(a);
  const y = positionOf(b);
  if (x.axle && y.axle && x.axle !== y.axle) return 'axle';
  if (x.side && y.side && x.side !== y.side) return 'side';
  return undefined;
}

/*
 * Belt markings. A ribbed belt says its size on its back: ribs, profile, effective length — «7PK2164», «7 PK 2164»,
 * «7PK-2164». Read off a photo, letters and digits are mistaken for each other (O / 0, l / 1, S / 5, B / 8, Z / 2, G / 6):
 * such a reading is put right but is less sure; a marking with a part missing («PK2164», «7PK21») is no size at all.
 */
const PROFILES = ['PK', 'PJ', 'PL', 'PM', 'PH'];
/** Lengths a ribbed belt of each profile is made in (mm): outside them a reading is wrong. */
const LENGTHS: Record<string, [number, number]> = { PK: [500, 3000], PJ: [300, 2500], PL: [600, 4000], PM: [1000, 6000], PH: [500, 2500] };
const DIGITISH: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', '!': '1', S: '5', B: '8', Z: '2', G: '6', T: '7' };

function beltOf(ribs: number, profile: string, lengthMm: number): BeltSpec | undefined {
  const [lo, hi] = LENGTHS[profile] ?? [0, 0];
  if (!PROFILES.includes(profile) || ribs < 2 || ribs > 20 || lengthMm < lo || lengthMm > hi) return undefined;
  return { kind: 'ribbed', ribs, profile, lengthMm, text: `${ribs}${profile}${lengthMm}` };
}

/** The ribbed-belt sizes written cleanly in a text (a page, a catalogue's name, a note): «7PK2164», «7 PK 1535». */
export function beltSpecsIn(text: string): BeltSpec[] {
  const out: BeltSpec[] = [];
  for (const m of String(text ?? '').toUpperCase().matchAll(/(?<![A-Z0-9])(\d{1,2})\s?-?\s?(P[KJLMH])\s?-?\s?(\d{3,4})(?![0-9])/g)) {
    const b = beltOf(Number(m[1]), m[2], Number(m[3]));
    if (b && !out.some((x) => x.text === b.text)) out.push(b);
  }
  return out;
}

export interface MarkingRead {
  /** The size it surely says (one reading, nothing put right) — none when unclear. */
  spec?: BeltSpec;
  /** Every size it may say. */
  readings: BeltSpec[];
  /** Characters were put right (O read for 0…). */
  corrected: boolean;
  /** Something like a marking, but a part of it missing or unreadable. */
  incomplete: boolean;
}

/** A belt's marking as typed or read: its size, or why there is none (unclear, incomplete). */
export function readBeltMarking(text: string): MarkingRead {
  const raw = String(text ?? '').toUpperCase();
  const clean = beltSpecsIn(raw);
  if (clean.length === 1) return { spec: clean[0], readings: clean, corrected: false, incomplete: false };
  if (clean.length > 1) return { readings: clean, corrected: false, incomplete: false };
  // Put right what a camera mistakes, in the places digits stand.
  const fixed: BeltSpec[] = [];
  for (const m of raw.matchAll(/(?<![A-Z0-9])([0-9OQDILSBZGT|!]{1,2})\s?-?\s?(P\s?[KJLMH])\s?-?\s?([0-9OQDILSBZGT|!]{3,4})(?![0-9])/g)) {
    const digits = (s: string) => s.replace(/./g, (c) => DIGITISH[c] ?? c);
    const b = beltOf(Number(digits(m[1])), m[2].replace(/\s/g, ''), Number(digits(m[3])));
    if (b && !fixed.some((x) => x.text === b.text)) fixed.push(b);
  }
  if (fixed.length) return { readings: fixed, corrected: true, incomplete: false };
  // A profile with a part of the marking missing: «PK2164», «7PK21», «7 PK».
  const incomplete = /P\s?[KJLMH]/.test(raw) && /\d/.test(raw);
  return { readings: [], corrected: false, incomplete };
}

/** How sure a marking is: typed — its own word; read off a photo — only a clean single reading said surely enough. */
export function markingSure(m: Marking | undefined): BeltSpec | undefined {
  if (!m) return undefined;
  const r = readBeltMarking(m.text);
  if (!r.spec) return undefined;
  if (m.from === 'typed') return r.spec;
  return m.confidence >= 0.85 && !(m.alternatives ?? []).some((a) => readBeltMarking(a).readings.some((x) => x.text !== r.spec!.text)) ? r.spec : undefined;
}

/**
 * Two sizes of one kind of belt: the same, close (makers state a length a few mm apart: 7PK2160 and 7PK2164 are
 * sold for each other), or not the same belt. Ribs and profile exactly; the length within 0.6 % (at least 10 mm) —
 * a belt's tolerance, not a universal one.
 */
export function compareBelts(a: BeltSpec, b: BeltSpec): 'same' | 'close' | 'conflict' {
  if (a.profile !== b.profile || a.ribs !== b.ribs) return 'conflict';
  const d = Math.abs(a.lengthMm - b.lengthMm);
  if (d === 0) return 'same';
  return d <= Math.max(10, a.lengthMm * 0.006) ? 'close' : 'conflict';
}

/*
 * Sources. Many parts sites show one catalogue's data (the maker's EPC, mirrored): they are one source, not several.
 */
const EPC_MIRRORS = /(^|\.)(megazip\.net|partsouq\.com|amayama\.com|7zap\.com|epc-data\.com|partsbooster\.com|catcar\.info|toyodiy\.com|nissan-catalog|hondapartsnow\.com|hondapartsonline\.net|parts\.honda\.com|realoem\.com|elcats\.ru|exist\.ru|emex\.ru|autodoc\.ru|catalogs-parts\.com|japancats\.ru|partslink24\.com)$/;
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
/** The source a page belongs to: the maker's catalogue and its mirrors are one. */
export const sourceOf = (url: string): string => {
  const h = hostOf(url);
  return !h ? '' : EPC_MIRRORS.test(h) ? 'epc' : h;
};
/** How many independent sources these pages are (copies of one catalogue count once). */
export const independentSources = (urls: string[]): number => new Set(urls.map(sourceOf).filter(Boolean)).size;

/** The part's maker is the car's (a genuine number), or another (an analog) — none said, not known. */
function oemBrand(brand: string | undefined, make: string): boolean | undefined {
  const b = canonicalMake(brand ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const m = canonicalMake(make).toLowerCase().replace(/[^a-z]/g, '');
  if (!b || !m) return undefined;
  const family: Record<string, string[]> = { toyota: ['toyota', 'lexus'], lexus: ['lexus', 'toyota'], honda: ['honda', 'acura'], acura: ['acura', 'honda'], nissan: ['nissan', 'infiniti'], infiniti: ['infiniti', 'nissan'], hyundai: ['hyundai', 'kia', 'mobis'], kia: ['kia', 'hyundai', 'mobis'] };
  return (family[m] ?? [m]).some((x) => b.includes(x) || x.includes(b));
}

/** Why: a fact found, or a fact missing, as a code the screen words (i18n `fit.why.*`). */
export interface Why {
  code: string;
  params?: Record<string, string | number>;
}
/** One piece of evidence, as the screen lists it. */
export interface Evidence {
  kind: 'epc' | 'supersession' | 'garage' | 'web' | 'spec' | 'marking' | 'ai';
  /** Where: a page's address, «garage», «photo», «typed», «ai». */
  source: string;
  url?: string;
  at?: string;
  detail?: string;
  /** Proof of fitting (the maker's catalogue, the garage's own fitting) or only of the number's existence. */
  weight: 'fits' | 'exists' | 'against' | 'none';
}
export interface Fitment {
  status: FitStatus;
  /** What it rests on (verified / partial), or why it is held back (conflict / rejected). */
  reasons: Why[];
  conflicts: Why[];
  /** What must be known to verify it. */
  missing: Need[];
  /** Independent sources the number was found in (copies of one catalogue — one), shown apart from the status. */
  sources: number;
  evidence: Evidence[];
}

export interface FitInput {
  /** The line's name. */
  part: string;
  car: CarFacts;
  candidate: Candidate;
  /** How the search found the numbers: the web, the AI's memory, the garage's jobs. */
  search: 'web' | 'model' | 'garage';
  /** The marking of the part on the car (the line's). */
  marking?: Marking;
  /** The garage's own uses of this part on cars of the model. */
  garage?: GarageUse[];
}

/** The maker's catalogue's word on a number: kept by the server since v0.65, read from the older fields before it. */
export function epcOf(c: Candidate): EpcCheck {
  if (c.check?.epc) return c.check.epc;
  if (c.name || c.fits) return { state: 'read', name: c.name, fit: c.fits ? 'model' : 'unknown', headings: c.model ? [c.model] : [] };
  return { state: 'unread' };
}

/** The pages a number was met on (not the maker's catalogue): since v0.65 kept apart; before it — `seen`. */
function webOf(c: Candidate): { url: string; how: 'page' | 'search' }[] {
  if (c.check) return c.check.web;
  return c.seen.filter((u) => !/megazip\.net/.test(u)).map((url) => ({ url, how: 'search' as const }));
}

/** The sizes said of a number: kept by the server, and the AI's note on it. */
function specsOf(c: Candidate): { spec: BeltSpec; by: 'page' | 'epc' | 'ai'; from?: string }[] {
  const out: { spec: BeltSpec; by: 'page' | 'epc' | 'ai'; from?: string }[] = [];
  const add = (text: string, by: 'page' | 'epc' | 'ai', from?: string) => {
    for (const spec of beltSpecsIn(text)) if (!out.some((x) => x.spec.text === spec.text && x.by === by && x.from === from)) out.push({ spec, by, ...(from ? { from } : {}) });
  };
  for (const s of c.check?.specs ?? []) add(s.text, s.by, s.from);
  if (!c.check && c.note) add(c.note, 'ai');
  if (c.name) add(c.name, 'epc');
  return out;
}

const describe = (s: { spec: BeltSpec }) => s.spec.text;

/**
 * The fitment of one number: its status by the rules above, why, what is missing, and the evidence it rests on. The AI's
 * words (its note, its naming the number) are evidence of nothing but that it said so.
 */
export function fitmentOf(input: FitInput): Fitment {
  const { part, car, candidate: c, marking } = input;
  const category = partCategory(part);
  const rule = RULES[category];
  const make = String(car.make.value ?? '');
  const epc = epcOf(c);
  const web = webOf(c);
  const specs = rule.spec === 'belt' ? specsOf(c) : [];
  const evidence: Evidence[] = [];
  const reasons: Why[] = [];
  const conflicts: Why[] = [];
  const rejected: Why[] = [];
  const missing = new Set<Need>();
  const at = c.check?.at;

  // The maker's catalogue.
  if (epc.state === 'read') {
    evidence.push({ kind: 'epc', source: epc.url ? hostOf(epc.url) : 'epc', url: epc.url, at, detail: [epc.name, ...(epc.headings ?? [])].filter(Boolean).join(' · '), weight: epc.fit === 'model' ? 'fits' : epc.fit === 'other' ? 'against' : 'exists' });
    if (epc.kind === false) rejected.push({ code: 'otherPart', params: { name: epc.name ?? '' } });
    const pos = epc.name ? positionConflict(part, epc.name) : undefined;
    if (pos) rejected.push({ code: pos === 'axle' ? 'otherAxle' : 'otherSide', params: { name: epc.name ?? '' } });
    if (epc.fit === 'other' && car.model.value && car.year.value) conflicts.push({ code: 'epcOtherModels', params: { headings: (epc.headings ?? []).join('; ') } });
  } else missing.add('epc');
  // The maker's own supersession: one part under an older and a newer number.
  if (c.replaces?.length) evidence.push({ kind: 'supersession', source: epc.url ? hostOf(epc.url) : 'epc', url: epc.url, at, detail: c.replaces.join(', '), weight: 'exists' });
  // Pages and search results: that the number exists.
  for (const w of web) evidence.push({ kind: 'web', source: hostOf(w.url), url: w.url, at, detail: w.how, weight: 'exists' });
  // The AI named it.
  if (input.search === 'model' || c.check?.named === 'memory') evidence.push({ kind: 'ai', source: 'ai', at, detail: c.note, weight: 'none' });

  // Sizes said of it — and of the part on the car.
  for (const s of specs) evidence.push({ kind: 'spec', source: s.by === 'ai' ? 'ai' : s.from ? hostOf(s.from) : s.by, url: s.from, at, detail: describe(s), weight: 'none' });
  const distinct = specs.filter((s, i) => specs.findIndex((x) => compareBelts(x.spec, s.spec) !== 'conflict') === i);
  if (distinct.length > 1) conflicts.push({ code: 'specsDisagree', params: { specs: distinct.map(describe).join(' / ') } });
  const sure = rule.spec === 'belt' ? markingSure(marking) : undefined;
  let specMatch: 'trusted' | 'ai' | undefined;
  if (rule.spec === 'belt' && marking) {
    const read = readBeltMarking(marking.text);
    evidence.push({ kind: 'marking', source: marking.from, at: marking.at, detail: marking.text, weight: 'none' });
    const readings = sure ? [sure] : [...read.readings, ...(marking.alternatives ?? []).flatMap((a) => readBeltMarking(a).readings)];
    if (!sure) missing.add('markingUnclear');
    if (readings.length && specs.length) {
      for (const s of specs) {
        const verdicts = readings.map((r) => compareBelts(r, s.spec));
        // Against every reading of the marking: another belt (an unclear reading still stops a green tick).
        if (verdicts.every((v) => v === 'conflict')) conflicts.push({ code: 'markingDiffers', params: { marking: readings[0].text, spec: s.spec.text, by: s.by } });
        else if (sure && verdicts[0] !== 'conflict') specMatch = s.by === 'ai' ? (specMatch ?? 'ai') : 'trusted';
      }
    } else if (readings.length && !specs.length) missing.add('candidateSpec');
  } else if (rule.spec === 'belt') missing.add('marking');

  // The garage's own jobs.
  const uses = (input.garage ?? []).filter((u) => !positionConflict(part, u.name));
  const own = uses.filter((u) => sameNumber(u.number, c.number));
  const older = uses.filter((u) => (c.replaces ?? []).some((r) => sameNumber(r, u.number)));
  for (const u of [...own, ...older]) evidence.push({ kind: 'garage', source: 'garage', at: u.at, detail: `${u.number}${u.jobNo ? ` · №${u.jobNo}` : ''}`, weight: u.installed ? 'fits' : 'exists' });
  const fittedHere = own.find((u) => u.sameVehicle && u.installed);
  const replacesHere = epc.state === 'read' ? older.find((u) => u.sameVehicle && u.installed) : undefined;
  const otherHere = uses.find((u) => u.sameVehicle && u.installed && !sameNumber(u.number, c.number) && !(c.replaces ?? []).some((r) => sameNumber(r, u.number)));
  if (otherHere && !fittedHere) conflicts.push({ code: 'fittedOther', params: { number: otherHere.number } });

  // What of the car is known — and needed.
  const known = (f: Fact<unknown>) => f.by === 'typed' || f.by === 'vin';
  if (car.vin !== 'valid') missing.add('vin');
  if (!known(car.model)) missing.add('model');
  if (!known(car.year)) missing.add('year');
  for (const n of rule.needs) {
    if (n === 'engine' && !known(car.engine)) missing.add('engine');
    if (n === 'transmission') missing.add('transmission');
    if (n === 'drive' && !sure) missing.add('drive');
    if (n === 'vin' && car.vin !== 'valid') missing.add('vin');
  }
  const pos = positionOf(part);
  if ((rule.axle && !pos.axle) || (rule.side && !pos.side)) missing.add('position');
  const analog = oemBrand(c.brand, make) === false;
  if (analog) missing.add('oem');

  const sources = independentSources([...web.map((w) => w.url), ...(epc.state === 'read' && epc.url ? [epc.url] : [])]);
  const done = (status: FitStatus): Fitment => ({ status, reasons, conflicts: status === 'rejected' ? rejected : conflicts, missing: status === 'verified' ? [] : [...missing], sources, evidence });

  if (rejected.length) return done('rejected');
  if (conflicts.length) return done('conflict');

  // Verified: fitted on this car; the maker's replacement of the number fitted on it; the maker's catalogue on the car's
  // own configuration code, with what the kind of part needs known.
  if (fittedHere) {
    reasons.push({ code: 'fittedHere', params: { job: fittedHere.jobNo ?? '' } });
    return done('verified');
  }
  if (replacesHere) {
    reasons.push({ code: 'replacesFittedHere', params: { number: replacesHere.number } });
    return done('verified');
  }
  const frameHit = epc.state === 'read' && epc.fit === 'model' && car.frames.length > 0 ? car.frames.find((f) => (epc.headings ?? []).some((h) => h.toUpperCase().split(/[\s·/,]+/).includes(f))) : undefined;
  const needsMet = rule.needs.every((n) => (n === 'engine' ? known(car.engine) : n === 'drive' ? specMatch === 'trusted' : n === 'transmission' ? false : n === 'vin' ? car.vin === 'valid' : true));
  const placed = !(rule.axle && !pos.axle) && !(rule.side && !pos.side);
  if (frameHit && needsMet && placed && !analog && known(car.model) && known(car.year)) {
    reasons.push({ code: 'epcFrame', params: { frame: frameHit } });
    if (specMatch) reasons.push({ code: 'markingMatches', params: { marking: sure?.text ?? '' } });
    return done('verified');
  }

  // Partial: a real match, something it needs not known.
  if (epc.state === 'read' && epc.fit === 'model') reasons.push({ code: 'epcModel', params: { headings: (epc.headings ?? []).join('; ') } });
  if (specMatch === 'trusted') reasons.push({ code: 'markingMatches', params: { marking: sure?.text ?? '' } });
  const fittedModel = own.find((u) => u.installed && !u.sameVehicle);
  if (fittedModel) reasons.push({ code: 'fittedModel', params: { job: fittedModel.jobNo ?? '' } });
  if (!frameHit) missing.add('frame');
  if (reasons.length) return done('partial');
  if (specMatch === 'ai') reasons.push({ code: 'aiSpecMatches', params: { marking: sure?.text ?? '' } });
  return done('unverified');
}

/**
 * The one number a line may take with nobody choosing it: the only verified one. Found on pages, on the model's
 * diagrams, by the AI — a candidate for the manager, never written by itself.
 */
export function verifiedOnly(fits: { number: string; fit: Fitment }[]): string | undefined {
  const ok = fits.filter((f) => f.fit.status === 'verified');
  return ok.length === 1 ? ok[0].number : undefined;
}

/** Every number found for a line, judged (the line's numbers in their order). */
export function fitmentsOf(args: { part: string; car: CarFacts; search: FitInput['search']; numbers: Candidate[]; marking?: Marking; garage?: GarageUse[] }): { number: string; fit: Fitment }[] {
  return args.numbers.map((candidate) => ({ number: candidate.number, fit: fitmentOf({ part: args.part, car: args.car, candidate, search: args.search, marking: args.marking, garage: args.garage }) }));
}

/** Green — verified only; the rest by how far from it (for the screen's order and colour). */
export const FIT_ORDER: Record<FitStatus, number> = { verified: 0, partial: 1, unverified: 2, conflict: 3, rejected: 4 };
