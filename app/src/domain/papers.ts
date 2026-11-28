import { CAR_CATALOG, canonicalMake } from './carCatalog';
import { ALIASES, makesInText, NOT_MODELS } from './chatStudy';
import { dubaiDate } from './dates';
import { lineName } from './items';
import { printedDate, receiptExpense, type ReceiptRead } from './receipt';
import { brandWord } from './supplierReply';
import { sellerKey } from './suppliers';
import { editDistance } from './ai';
import type { Expense, PaperItem, SupplierPaper } from './types';

/*
 * The garage's paper invoices from its suppliers, read in bulk (v1.05, the owner: «до появления приложения накопилось
 * огромное количество инвойсов от поставщиков… в этих инвойсах прописаны все данные, каждая позиция, цены… создать
 * мультисканер… ИИ должен анализировать, узнать поставщика, присваивать ему работы… рейтинг… кто что часто продаёт…
 * сохранял все цены, прайс-листы, чтобы в новом заказе… приложение показывало: вот этот поставщик ранее продавал тебе вот
 * это… даже если поставщик не существует — создать»). A paper is knowledge, not money: it writes no expense (the money book
 * of those days is not the app's), it teaches the supplier's history, its rating, who sells what for which car, and its
 * prices (the price book). Pure: the server's reading in (server/src/ai.mjs `receipt`), the paper's fields out; which
 * paper is the same as another, which expense it already is, what a supplier's papers say of it.
 */

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}
const yearsBack = (today: string, n: number) => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;

/**
 * An old paper's day: as printed (day first, as UAE papers write it), else the server's. Old papers are old — years back
 * is right (the receipt scanner's «within a year» is not). A day after today is a misread: the same day a year before, or
 * day and month swapped — whichever has passed; not sure then. Older than six years, or none — none, to be looked at.
 */
export function paperDate(read: Pick<ReceiptRead, 'dateText' | 'date' | 'dateSure'>, today = dubaiDate()): { date?: string; sure: boolean } {
  const printed = read.dateText ? printedDate(String(read.dateText)) : undefined;
  const s = String(read.date ?? '');
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? ymd(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))) : undefined;
  const date = printed ?? iso;
  if (!date) return { sure: false };
  const sure = read.dateSure !== false && (!printed || !iso || printed === iso);
  const oldest = yearsBack(today, 6);
  if (date <= today && date >= oldest) return { date, sure };
  if (date > today) {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    const again = [ymd(y - 1, m, d), d <= 12 ? ymd(y, d, m) : undefined].filter((x): x is string => !!x && x <= today && x >= oldest).sort().pop();
    return { date: again, sure: false };
  }
  return { sure: false };
}

/* ---------- The car a line names (v1.05.1; v1.05.2 — checked on the garage's first 46 invoices) ---------- */

/*
 * The owner (28/11, two of the garage's invoices): «почти всегда они пишут название автомобиля вместе с названием детали в
 * одной строке: SANTAFE AC VALVE … — это к Санта-Фе; CAMRY HIBRID FAN MOTOR … — фан-мотор для Камри». A line is read as a
 * person reads it: the model's name (the catalogue's, written together or apart — «SANTAFE», «SANTA FE»; its own last word —
 * «PRADO»; «LC200»), the make it is of; the rest is the part. A model that is an everyday word («ACCENT», «ROSA», «CANTER»)
 * or a short one («RX», «XA») counts only as the line's first word (or right after another car's name, «RIO/ACCENT») — that
 * is where these papers write the car.
 * v1.05.2 (the first 46 papers read): every model a line names («RIO/ACCENT/VELOSTR 2010-2018» fits three — `fits`), a name
 * a letter or two off («ELENTRA», «SPROTAGE», «MITUSUBISHI»), short makes («MIT»), the garage's own cars' models («XA» —
 * `setGarageModels`, the catalogue has none).
 */
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Models that are words of parts too («SPARK PLUG», «MASTER CYLINDER», «PILOT BEARING», «CROWN PINION»): never a car here. */
const PART_LIKE = new Set(['spark', 'master', 'seal', 'pilot', 'crown', 'charger', 'cooper', 'express', 'partner', 'expert', 'boxer', 'shark', 'ghost', 'phantom']);
type ModelHit = { make: string; model: string; first: boolean };
let modelIdx: Map<string, ModelHit[]> | undefined;
let garageModels: { make: string; model: string }[] = [];

/** The garage's own cars' makes and models (services/papers.ts): a model the catalogue lacks («XA») is read too. */
export function setGarageModels(list: { make?: string; model?: string }[]): void {
  const seen = new Set<string>();
  garageModels = [];
  for (const v of list) {
    const make = canonicalMake(v.make ?? '');
    const model = (v.model ?? '').trim();
    if (!make || !model || !CAR_CATALOG[make]) continue;
    const k = `${make}|${keyOf(model)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    garageModels.push({ make, model });
  }
  modelIdx = undefined;
}

function modelIndex(): Map<string, ModelHit[]> {
  if (modelIdx) return modelIdx;
  const out = new Map<string, ModelHit[]>();
  const add = (k: string, v: ModelHit) => {
    if (k.length < 2 || /^\d+$/.test(k)) return;
    const was = out.get(k) ?? [];
    if (!was.some((x) => x.make === v.make && keyOf(x.model) === keyOf(v.model))) out.set(k, [...was, v]);
  };
  const models = [...Object.entries(CAR_CATALOG).flatMap(([make, list]) => list.map((model) => ({ make, model }))), ...garageModels];
  for (const { make, model } of models) {
    const k = keyOf(model);
    if (PART_LIKE.has(k)) continue;
    add(k, { make, model, first: k.length < 4 || NOT_MODELS.has(model.toLowerCase()) });
    // «PRADO» for «Land Cruiser Prado»: the last word of a longer name, when it is a word of its own
    const words = model.split(/\s+/);
    if (words.length > 1) {
      const last = keyOf(words[words.length - 1]);
      if (last.length >= 4 && !/\d/.test(last)) add(last, { make, model, first: true });
    }
  }
  modelIdx = out;
  return out;
}
const MAKE_WORDS = (() => {
  const m = new Map<string, string>();
  for (const make of Object.keys(CAR_CATALOG)) m.set(keyOf(make), make);
  for (const [k, make] of Object.entries(ALIASES)) m.set(keyOf(k), make);
  // as the papers shorten them
  for (const [k, make] of Object.entries({ mit: 'Mitsubishi', mits: 'Mitsubishi', mitsu: 'Mitsubishi', nis: 'Nissan', toy: 'Toyota', hyun: 'Hyundai', chev: 'Chevrolet' })) m.set(k, make);
  m.delete('mini');
  m.delete('tank');
  return m;
})();
/** A word a letter or two off a name (five letters and more; two off from eight): the name, if only one is that near. */
function nearName<T>(w: string, names: Map<string, T>, min = 5): T | undefined {
  if (w.length < min || /\d/.test(w)) return undefined;
  let hit: T | undefined;
  let n = 0;
  for (const [k, v] of names) {
    if (k.length < min || Math.abs(k.length - w.length) > 2) continue;
    if (editDistance(w, k) <= (Math.max(k.length, w.length) >= 8 ? 2 : 1)) {
      if (hit !== v) n++;
      hit = v;
    }
  }
  return n === 1 ? hit : undefined;
}

export interface LineCar {
  make?: string;
  model?: string;
  /** Every model the line names («RIO/ACCENT/VELOSTR» — three), the first is `model`. */
  fits: { make: string; model: string }[];
  /** Which of its words are the car's (letters and digits, in order). */
  words: number[];
  /** Which of them are a model's (not a make's). */
  models: number[];
}

/** The cars a line (or a paper's car line) names, and which of its words are the cars'. */
export function carsOfLine(text?: string): LineCar {
  const words = (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const idx = modelIndex();
  const made = new Set<string>();
  const makeAt = new Set<number>();
  words.forEach((w, i) => {
    const m = MAKE_WORDS.get(w) ?? (w.length >= 6 ? nearName(w, MAKE_WORDS, 6) : undefined);
    if (m) {
      made.add(m);
      makeAt.add(i);
    }
  });
  const taken = new Set<number>();
  const hits: { at: number; make: string; model?: string }[] = [];
  const free = (i: number, n: number) => Array.from({ length: n }, (_, k) => i + k).every((k) => !taken.has(k) && (k === i || !makeAt.has(k) || words[k] === words[i]));
  const take = (i: number, n: number, make: string, model?: string) => {
    for (let k = i; k < i + n; k++) taken.add(k);
    hits.push({ at: i, make, model });
  };
  const fit = (h: ModelHit) => !made.size || made.has(h.make);
  // what stands between the words («/» — a list of cars: «CONDENSER RIO/ACCENT»); seps[k] is before word k
  const seps = (text ?? '').toLowerCase().split(/[a-z0-9]+/);
  const weak = (j: number) => j >= 0 && j < words.length && !makeAt.has(j) && (idx.get(words[j]) ?? []).some((h) => h.first && fit(h));
  // names, not codes: «T1/T2», «A4/A5» may be sizes (a code counts after its make — «BMW X3/X5»)
  const named = (j: number) => !/\d/.test(words[j] ?? '');
  const listed = (i: number) => named(i) && ((!!seps[i + 1]?.includes('/') && named(i + 1) && weak(i + 1)) || (!!seps[i]?.includes('/') && named(i - 1) && weak(i - 1)));
  /** One pass over the words: `strong` — names that are no everyday word; else the everyday and short ones where a car is. */
  const pass = (strong: boolean) => {
    let more = false;
    for (let i = 0; i < words.length; i++) {
      if (taken.has(i)) continue;
      // «LC200», «LC300», «LC76» — a Land Cruiser
      if (strong && /^lc\d{2,3}$/.test(words[i])) {
        take(i, 1, 'Toyota', 'Land Cruiser');
        more = true;
        continue;
      }
      // first in the line, next to another car's name («RIO/ACCENT», «CONDENSER RIO/ACCENT»), or after its make («MAZDA 6»)
      const near = i === 0 || taken.has(i - 1) || taken.has(i + 1) || makeAt.has(i - 1) || listed(i);
      for (const n of [3, 2, 1]) {
        if (i + n > words.length || !free(i, n)) continue;
        const all = (idx.get(words.slice(i, i + n).join('')) ?? []).filter(fit);
        const hs = all.filter((h) => (strong ? !h.first : h.first && (near || made.has(h.make))));
        if (!hs.length || new Set(hs.map((h) => h.make)).size > 1) continue;
        take(i, n, hs[0].make, hs.length === 1 ? hs[0].model : undefined);
        more = true;
        i += n - 1;
        break;
      }
    }
    return more;
  };
  pass(true);
  // a name a letter or two off («ELENTRA», «SPROTAGE», «VELOSTR»): a long one, only one that near
  words.forEach((w, i) => {
    if (taken.has(i) || makeAt.has(i)) return;
    const one = nearName(w, idx, 6)?.filter(fit);
    if (one?.length === 1 && (!one[0].first || i === 0 || taken.has(i - 1) || taken.has(i + 1))) take(i, 1, one[0].make, one[0].model);
  });
  // the everyday and short names next to those found, again while more are found («RIO/ACCENT/VELOSTR»)
  for (let k = 0; k < 4 && pass(false); k++);
  hits.sort((a, b) => a.at - b.at);
  const fits: { make: string; model: string }[] = [];
  for (const h of hits) if (h.model && !fits.some((f) => f.make === h.make && keyOf(f.model) === keyOf(h.model!))) fits.push({ make: h.make, model: h.model });
  const main = hits[0];
  const make = main?.make ?? (made.size === 1 ? [...made][0] : undefined);
  const used = [...new Set([...taken, ...makeAt])].sort((a, b) => a - b);
  return { ...(make ? { make } : {}), ...(main?.model ? { model: main.model } : {}), fits, words: used, models: [...taken].sort((a, b) => a - b) };
}

/** The car a line names — its first one (`carsOfLine` for all). */
export function carOfLine(text?: string): { make?: string; model?: string; words: number[] } {
  const c = carsOfLine(text);
  return { ...(c.make ? { make: c.make } : {}), ...(c.model ? { model: c.model } : {}), words: c.words };
}

/* ---------- What the part is ---------- */

/**
 * The papers' own shorthand and misspellings (v1.05.2, the first 46 invoices: «RD», «COC ASSY», «FRT BRK PAD», «BREAK FLUID»,
 * «AC COMPARASSOR», «THARMOSTAT»…): written out, as the price book and the jobs' lines name parts.
 */
const PART_FIX: Record<string, string> = {
  RD: 'RADIATOR',
  RAD: 'RADIATOR',
  COC: 'CLUTCH OPERATING CYLINDER',
  CMC: 'CLUTCH MASTER CYLINDER',
  CSC: 'CLUTCH SLAVE CYLINDER',
  FRT: 'FRONT',
  FR: 'FRONT',
  RR: 'REAR',
  BRK: 'BRAKE',
  BRAK: 'BRAKE',
  BREAK: 'BRAKE',
  ENG: 'ENGINE',
  ALTER: 'ALTERNATOR',
  ALTNTR: 'ALTERNATOR',
  ALTR: 'ALTERNATOR',
  COMPARASSOR: 'COMPRESSOR',
  COMPRESOR: 'COMPRESSOR',
  COMPRESURE: 'COMPRESSOR',
  COMPRASSOR: 'COMPRESSOR',
  CONDENSOR: 'CONDENSER',
  AXEL: 'AXLE',
  HOSH: 'HOSE',
  SEALENT: 'SEALANT',
  WINDSHEILD: 'WINDSHIELD',
  THARMOSTAT: 'THERMOSTAT',
  TERMOSTAT: 'THERMOSTAT',
  SUSPENTION: 'SUSPENSION',
  BEARIN: 'BEARING',
  ABSORBAR: 'ABSORBER',
  MOUNTING: 'MOUNT',
  GENIUNE: '',
  GENUINE: '',
  GENUIN: '',
};

/** Two-digit or four-digit years and their spans («07-09», «99-2004», «2006\11», «2010-2018») — not the part. */
const YEARS = /(?<![\w.])((19|20)\d{2}|\d{2})\s*[-\\/]\s*((19|20)\d{2}|\d{2})(?![\w.])|(?<![\w.])(19|20)\d{2}(?![\w.])/g;
const yearSpan = (m: string) =>
  m
    .split(/\s*[-\\/]\s*/)
    .map((x) => Number(x.length === 2 ? (Number(x) > 40 ? `19${x}` : `20${x}`) : x))
    .every((y) => y >= 1980 && y <= 2040);

/**
 * A line's part without its car (its models and make, «HYBRID», its years) and without a kind's code at its end («… G»,
 * «… D»), its shorthand written out: «TUCSON AC EXPANSION VALVE QWE» → «AC EXPANSION VALVE QWE», «RD PAJERO
 * 08- 12AB» → «RADIATOR 12AB», «CON HONDA CIVIC 07-09 (KOYO)» → «CONDENSER (KOYO)», «1/2" A/C HOSE» keeps its size.
 */
export function partWithoutCar(text: string): string {
  const car = carsOfLine(text);
  // the same words carsOfLine counts (letters and digits): taken out where they stand, the rest kept as written
  let k = 0;
  let s = text.replace(/[A-Za-z0-9]+/g, (w) => (car.words.includes(k++) || /^(hybrid|hibrid|hyb)$/i.test(w) ? ' ' : w));
  if (car.words.length) s = s.replace(YEARS, (m) => (yearSpan(m) ? ' ' : m));
  // «08-» of «08- 12AB»: a lone year's dash left behind
  s = s.replace(/(?<![\w.])\d{2}\s*-(?=\s|$)/g, (m) => (car.words.length && yearSpan(`${m.trim().slice(0, 2)}-${m.trim().slice(0, 2)}`) ? ' ' : m));
  const words = s
    .replace(/\s*[-/\\]\s*(?=\s|$)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // a kind's code at the end: «G» genuine, «D» duplicate
  while (words.length > 1 && /^[GD]$/i.test(words[words.length - 1])) words.pop();
  const out: string[] = [];
  words.forEach((w, i) => {
    const up = w.toUpperCase();
    if (up === 'CON') return out.push(/^ROD/i.test(words[i + 1] ?? '') ? 'CONNECTING' : 'CONDENSER');
    if (up === 'PAID' && /BRAKE|BRAK|BRK|BREAK/i.test(words[i - 1] ?? '')) return out.push('PAD');
    if (up === 'ASS' && i === words.length - 1) return out.push('ASSY');
    const fix = PART_FIX[up];
    if (fix !== undefined) {
      if (fix) out.push(fix);
      return;
    }
    out.push(w);
  });
  return lineName(
    out
      .join(' ')
      // «A C», «A/C» — AC, as the garage writes it on its jobs (the price book matches by the words)
      .replace(/\bA\s*[/\s]\s*C\b/gi, 'AC')
      .replace(/^[\s,.\-/&]+|[\s,.\-/&]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** The car some words name: the make (one only), and its model of the catalogue when the words name one. */
export function carOfText(text?: string): { make?: string; model?: string } {
  const line = carOfLine(text);
  if (line.make) return { make: line.make, ...(line.model ? { model: line.model } : {}) };
  if (!text?.trim()) return {};
  const makes = makesInText(text);
  if (makes.length !== 1) return {};
  const make = canonicalMake(makes[0]);
  const words = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const flat = words.replace(/\s+/g, '');
  // The longest name first («LAND CRUISER PRADO» before «LAND CRUISER»); a short one («XA», «RX») only as a word of its own.
  const model = [...(CAR_CATALOG[make] ?? [])]
    .sort((a, b) => b.length - a.length)
    .find((m) => {
      const k = m.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k) return false;
      return k.replace(/\s/g, '').length >= 4 ? flat.includes(k.replace(/\s/g, '')) : words.includes(` ${k} `);
    });
  return { make, ...(model ? { model } : {}) };
}

/* ---------- Original or copy ---------- */

/** Car makers whose name is a word of parts too («COOLANT TANK», «OIL FILTER MINI», «SEAT COVER», v1.06): never a maker in a line. */
const WORD_MAKERS = new Set(['tank', 'mini', 'seat', 'smart', 'genesis', 'lotus', 'jet', 'great', 'wall']);
/** A car maker's own name (not a shortening — «MIT» is the car; not a part's word — «TANK»). */
const makerWord = (w: string) => !WORD_MAKERS.has(keyOf(w)) && !!CAR_CATALOG[canonicalMake(w)] && keyOf(canonicalMake(w)) === keyOf(w);

const OEM_WORDS = /\b(genuine|geniune|genuin|genune|original|orginal|oem|org)\b/i;
const COPY_WORDS = /\b(duplicate|dupl?|copy|aftermarket|after\s*market|taiwan|china|commercial)\b/i;
const USED_WORDS = /\b(used|second\s*hand|scrap)\b/i;

/**
 * What kind a line says it is (v1.05.2, as the garage's suppliers write it): «… G» at its end — genuine, «… D» — duplicate;
 * «genuine» (misspelt too) — original; a car maker's name as the brand («OIL FILTER 15208 NISSAN», «TOYOTA BRAKE OIL») —
 * the maker's own part, original; another maker («KYB», «KOYO», «DENSO») — aftermarket; «used». The car the line is for is
 * not its brand («CON HONDA CIVIC (KOYO)» — KOYO). `brand` — the AI's reading of it.
 */
export function lineKind(name: string, opts: { brand?: string; make?: string } | string = {}): { kind: 'oem' | 'aftermarket' | 'used'; said: boolean; brand?: string } {
  const o = typeof opts === 'string' ? { make: opts } : opts;
  if (USED_WORDS.test(name)) return { kind: 'used', said: true };
  const said = (o.brand ?? '').trim().toUpperCase();
  const toks = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const last = toks[toks.length - 1];
  const code = said === 'G' || said === 'D' ? said : last === 'G' || last === 'D' ? last : '';
  // a maker's own name (not a shortening — «MIT» is the car), not the car the line is for (a maker followed by its model)
  const car = carsOfLine(name);
  const isMaker = (w: string) => makerWord(w);
  const carMake = (w: string) => isMaker(w) && toks.some((t, i) => keyOf(t) === keyOf(w) && car.words.includes(i) && car.models.includes(i + 1));
  // the AI's brand — not «G»/«D» (kind codes), not «genuine» (a kind), not the line's car
  const ai = said && said !== 'G' && said !== 'D' && !OEM_WORDS.test(said) && !COPY_WORDS.test(said) && !carMake(said) ? said : undefined;
  const named = toks.find((w, i) => w.length >= 3 && (brandWord(w.toLowerCase()) || isMaker(w)) && !carMake(w) && !(car.words.includes(i) && !isMaker(w)));
  const brand = ai ?? named;
  const isMake = (b?: string) => !!b && MAKE_WORDS.has(keyOf(b));
  const withBrand = (kind: 'oem' | 'aftermarket') => ({ kind, said: true, ...(brand ? { brand } : {}) });
  if (OEM_WORDS.test(name) || code === 'G') return withBrand('oem');
  if (COPY_WORDS.test(name) || code === 'D') return withBrand('aftermarket');
  if (brand) return withBrand(isMake(brand) ? 'oem' : 'aftermarket');
  return { kind: 'aftermarket', said: false };
}

/**
 * A paper's line as the garage names it, out of what the paper and the AI said (v1.05.2): its cars (its own words, else the
 * AI's word for its car, else the paper's car), its part (the AI's name for it, else its own words — shorthand written out,
 * no car), its kind and brand. Used when a paper is read and when papers read before are tidied again (`PAPER_V`).
 */
export function lineOf(l: { name: string; part?: string; car?: string; brand?: string; kind?: PaperItem['kind']; partNumber?: string; qty: number; unitFils?: number; totalFils?: number }, paperCar: { make?: string; model?: string }, paperKind?: SupplierPaper['kind']): PaperItem {
  const own = carsOfLine(l.name);
  const said = l.car ? carsOfLine(l.car) : undefined;
  const best = own.make ? own : said?.make ? said : undefined;
  // the line's own car, the AI's word for it, the paper's car — else a car maker as its brand («OIL FILTER … NISSAN», v1.06)
  const k0 = lineKind(l.name, { brand: l.brand });
  const byBrand = !best?.make && !paperCar.make && k0.brand && makerWord(k0.brand) ? canonicalMake(k0.brand) : undefined;
  const make = best?.make ?? paperCar.make ?? byBrand;
  const model = best?.make ? (best.model ?? (best.make === paperCar.make ? paperCar.model : undefined)) : paperCar.model;
  const fits = [...(own.fits ?? []), ...(said?.fits ?? [])].filter((f, i, all) => all.findIndex((x) => x.make === f.make && keyOf(x.model) === keyOf(f.model)) === i && !(f.make === make && keyOf(f.model) === keyOf(model ?? '')));
  // the line's own words first; what the AI read of its kind when they say nothing
  const own2 = lineKind(l.name, { brand: l.brand, make });
  const k = own2.said || !l.kind ? own2 : { ...own2, kind: l.kind, said: true };
  const part = partWithoutCar(l.part || l.name) || partWithoutCar(l.name);
  return {
    name: l.name,
    ...(part ? { part } : {}),
    ...(l.partNumber ? { partNumber: l.partNumber } : {}),
    qty: l.qty,
    ...(l.unitFils !== undefined ? { unitFils: l.unitFils } : {}),
    ...(l.totalFils !== undefined ? { totalFils: l.totalFils } : {}),
    ...(make ? { make } : {}),
    ...(model ? { model } : {}),
    ...(fits.length ? { fits } : {}),
    kind: k.kind,
    ...(k.said ? {} : { unsure: true as const }),
    ...(k.brand ? { brand: k.brand } : {}),
    ...(isWorkLine(l.name, paperKind) || isWorkLine(part ?? '', paperKind) ? { service: true as const } : {}),
    ...(l.part || l.car || l.brand || l.kind ? { said: { ...(l.part ? { part: l.part } : {}), ...(l.car ? { car: l.car } : {}), ...(l.brand ? { brand: l.brand } : {}), ...(l.kind ? { kind: l.kind } : {}) } } : {}),
  };
}

/** The version of the reading rules a paper was learnt by: one learnt by older rules is tidied again (services/papers.ts). */
/** 3 (v1.06): a car maker as the brand gives the make; work lines said so; the same paper read twice on two devices told. */
export const PAPER_V = 3;

/* ---------- The day by its number ---------- */

/**
 * An invoice's year by the supplier's own numbering (v1.05.2: a faint 6 read as 4 — 2024 for 2026 — its number lying
 * among the same supplier's papers of that very month). The nearest numbers of the same supplier (3000 apart at most, three at
 * most, two at least), their days sure, all of one other year: when the same day in that year is within four months of the
 * nearest, while this one is over ten months from each — that year (not sure: to be looked at). A day set by a person is not
 * moved (services/papers.ts, `dateBy`).
 */
export function dateByNumbers(p: Pick<SupplierPaper, 'id' | 'supplierId' | 'invoiceNo' | 'date'>, others: Pick<SupplierPaper, 'id' | 'supplierId' | 'invoiceNo' | 'date' | 'dateSure' | 'state'>[]): string | undefined {
  const num = (s?: string) => {
    const d = (s ?? '').match(/\d{3,}/g);
    return d ? Number(d[d.length - 1]) : NaN;
  };
  const n = num(p.invoiceNo);
  if (!p.supplierId || !p.date || !Number.isFinite(n)) return undefined;
  const near = others
    .filter((o) => o.id !== p.id && o.supplierId === p.supplierId && o.date && o.dateSure !== false && (o.state === 'done' || o.state === 'look') && Number.isFinite(num(o.invoiceNo)))
    .map((o) => ({ o, d: Math.abs(num(o.invoiceNo) - n) }))
    .filter((x) => x.d > 0 && x.d <= 3000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.o);
  // the nearest numbers (two at least, three at most) all of one other year: one neighbour alone may be the misread one
  const year = near[0]?.date?.slice(0, 4);
  if (near.length < 2 || !year || year === p.date.slice(0, 4) || near.some((o) => o.date?.slice(0, 4) !== year)) return undefined;
  const moved = `${year}${p.date.slice(4)}`;
  const gap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
  return gap(moved, near[0].date!) <= 120 && near.every((o) => gap(p.date!, o.date!) > 300) ? moved : undefined;
}

/** The paper's own fields out of the server's reading: who sold, when, its number, its sums, each line as the garage names it. */
export interface PaperFields {
  ok: boolean;
  /** Not a supplier's invoice at all (a photo of something else). */
  notPaper: boolean;
  /** A parts shop's, a contractor's, or of another kind (fuel, food…). */
  kind: 'parts' | 'service' | 'other';
  vendor?: string;
  vendorPhone?: string;
  vendorTrn?: string;
  vendorEmail?: string;
  vendorAddress?: string;
  invoiceNo?: string;
  date?: string;
  dateSure: boolean;
  totalFils: number;
  vatFils: number;
  method?: Expense['method'];
  car?: string;
  make?: string;
  model?: string;
  lines: PaperItem[];
  /** The lines add up to the paper's sum (with its VAT or without). */
  adds: boolean;
}

export function paperFields(read: ReceiptRead, today = dubaiDate()): PaperFields {
  const x = receiptExpense(read, today);
  const { date, sure } = paperDate(read, today);
  const car = String(read.carText ?? '').trim().slice(0, 80) || undefined;
  const paperCar = carOfText(car);
  const paperKind: SupplierPaper['kind'] = x.kind === 'parts' || x.kind === 'service' ? x.kind : 'other';
  const lines: PaperItem[] = x.items.map((i) => lineOf({ name: i.name, part: i.part, car: i.car, brand: i.brand, kind: i.kind, partNumber: i.partNumber, qty: i.qty, unitFils: i.unitNetFils, totalFils: i.lineNetFils }, paperCar, paperKind));
  const net = x.amountFils - x.vatFils;
  const sum = lines.reduce((s, l) => s + (l.totalFils ?? 0), 0);
  const near = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(200, Math.round(b * 0.02));
  return {
    ok: x.amountFils > 0 && read.isReceipt !== false,
    notPaper: read.isReceipt === false,
    kind: x.kind === 'parts' || x.kind === 'service' ? x.kind : 'other',
    vendor: x.vendor,
    vendorPhone: x.vendorPhone,
    vendorTrn: x.vendorTrn?.replace(/\D/g, '') || undefined,
    vendorEmail: x.vendorEmail,
    vendorAddress: x.vendorAddress,
    invoiceNo: read.invoiceNo ? String(read.invoiceNo).trim().slice(0, 24) || undefined : undefined,
    date,
    dateSure: sure,
    totalFils: x.amountFils,
    vatFils: x.vatFils,
    method: x.method,
    car,
    ...paperCar,
    lines,
    adds: !lines.length || near(sum, net) || near(sum, x.amountFils),
  };
}

/** What in a paper needs a look: the seller not known, no day or not sure of it, its lines not adding up, no lines. */
export function paperDoubts(p: Pick<SupplierPaper, 'supplierId' | 'date' | 'dateSure' | 'lines' | 'adds'>): ('seller' | 'date' | 'sum' | 'lines')[] {
  const out: ('seller' | 'date' | 'sum' | 'lines')[] = [];
  if (!p.supplierId) out.push('seller');
  if (!p.date || !p.dateSure) out.push('date');
  if (!p.lines?.length) out.push('lines');
  else if (p.adds === false) out.push('sum');
  return out;
}

const digits = (s?: string) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/**
 * The same paper scanned before (photographed twice, or a copy of it): the same seller with the same number, or the same
 * seller, day and sum. `others` — the papers read before it.
 */
export function twinOf<T extends Pick<SupplierPaper, 'id' | 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils' | 'state'>>(p: Pick<SupplierPaper, 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils'> & { id?: string }, others: T[]): T | undefined {
  const seller = (x: Pick<SupplierPaper, 'supplierId' | 'vendor'>) => x.supplierId ?? (x.vendor ? `v:${sellerKey(x.vendor)}` : '');
  const me = seller(p);
  if (!me) return undefined;
  const no = digits(p.invoiceNo);
  return others.find((o) => {
    if (o.id === p.id || o.state === 'twin' || o.state === 'failed' || seller(o) !== me) return false;
    const on = digits(o.invoiceNo);
    if (no.length >= 3 && on.length >= 3) return no === on && (!p.date || !o.date || Math.abs(Date.parse(p.date) - Date.parse(o.date)) < 400 * DAY);
    return !!p.date && p.date === o.date && !!p.totalFils && p.totalFils === o.totalFils;
  });
}

/**
 * The expense the paper already is (scanned by «Расход», or typed): the same seller (its supplier, else its name), the same
 * sum within a dirham, three days apart at most — or its number in the expense's note.
 */
export function expenseOf(p: Pick<SupplierPaper, 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils'>, expenses: Pick<Expense, 'id' | 'supplierId' | 'vendor' | 'note' | 'date' | 'amountFils'>[]): string | undefined {
  if (!p.date || !p.totalFils) return undefined;
  const key = p.vendor ? sellerKey(p.vendor) : '';
  const no = digits(p.invoiceNo);
  const same = (e: (typeof expenses)[number]) => (p.supplierId && e.supplierId === p.supplierId) || (!!key && key.length >= 3 && sellerKey(e.vendor ?? '') === key);
  const hit = expenses.find((e) => {
    if (!same(e)) return false;
    const days = Math.abs(Date.parse(e.date) - Date.parse(p.date!)) / DAY;
    if (no.length >= 3 && digits(e.note?.match(/#\s*([\w-]+)/)?.[1]).includes(no)) return days <= 40;
    return days <= 3 && Math.abs(e.amountFils - p.totalFils!) <= 100;
  });
  return hit?.id;
}

/** What a supplier's papers say of it (its card): how many, the money, since when, what it sold most, for which makes. */
export interface PaperStats {
  papers: number;
  totalFils: number;
  firstAt?: string;
  lastAt?: string;
  /** The parts bought most, the most first: how many times, the last price (one piece), its car. */
  parts: { part: string; times: number; lastFils?: number; make?: string }[];
  makes: { make: string; n: number }[];
}

/** A line's part as the garage names it: the server's generic name, else the line's own. */
export const partOfLine = (l: Pick<PaperItem, 'part' | 'name'>) => lineName((l.part || l.name || '').trim());

export function paperStats(papers: Pick<SupplierPaper, 'state' | 'date' | 'totalFils' | 'lines'>[]): PaperStats {
  const counted = papers.filter((p) => p.state === 'done' || p.state === 'look');
  const parts = new Map<string, { part: string; times: number; lastFils?: number; lastAt: string; make?: string }>();
  const makes = new Map<string, number>();
  let total = 0;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  for (const p of counted) {
    total += p.totalFils ?? 0;
    if (p.date && (!firstAt || p.date < firstAt)) firstAt = p.date;
    if (p.date && (!lastAt || p.date > lastAt)) lastAt = p.date;
    const seen = new Set<string>();
    for (const l of p.lines ?? []) {
      const part = partOfLine(l);
      if (!part) continue;
      const at = p.date ?? '';
      const was = parts.get(part) ?? { part, times: 0, lastAt: '' };
      was.times++;
      if (at >= was.lastAt) Object.assign(was, { lastAt: at, lastFils: l.unitFils ?? was.lastFils, make: l.make ?? was.make });
      parts.set(part, was);
      if (l.make && !seen.has(l.make)) {
        seen.add(l.make);
        makes.set(l.make, (makes.get(l.make) ?? 0) + 1);
      }
    }
  }
  return {
    papers: counted.length,
    totalFils: total,
    firstAt,
    lastAt,
    parts: [...parts.values()].sort((a, b) => b.times - a.times || b.lastAt.localeCompare(a.lastAt)).map(({ lastAt: _, ...x }) => x),
    makes: [...makes.entries()].map(([make, n]) => ({ make, n })).sort((a, b) => b.n - a.n || a.make.localeCompare(b.make)),
  };
}

/* ---------- Work on a paper, and the same paper twice (v1.06) ---------- */

/**
 * Work done, not a part (the first 428 papers: a tyre shop's «JOB-WHEEL ALIGNMENT», a lathe's «BRAKE DISC SKIMMING», «… OPENING &
 * FITTING», «… WELDING»): its price is what the work cost, never a part's. A service paper's lines — unless a part is plainly
 * named with no work word.
 */
const WORK = /^JOB\b|\b(ALIGNMENT|BALANCING|BALANCE|SKIMMING|SKIM|WELDING|WELD|FITTING|OPENING|LABOU?R|REPAIR(ING)?|SERVICE|SERVICING|CHARGES?|REWIND(ING)?|OVERHAUL(ING)?|MACHINING|PAINTING|DENTING|TOWING|RECOVERY|DIAGNOS\w*|PROGRAMMING|CODING|INSTALLATION|TOP\s*UP|REGAS|RE-GAS)\b/i;
export function isWorkLine(name: string, paperKind?: SupplierPaper['kind']): boolean {
  if (WORK.test(name)) return true;
  return paperKind === 'service' && !/\b(ASSY|ASSEMBLY|FILTER|PAD|PADS|BELT|BEARING|BUSH|HOSE|GASKET|SEAL|OIL|TYRE|TIRE|BATTERY|BULB|SENSOR|PUMP|DISC|ROTOR)\b/i.test(name);
}

/**
 * The same paper read twice (v1.06: four pairs among the first 428 — two devices read the same photo at once, neither saw the
 * other): of the same seller and number (or day and sum) — `twinOf` — one is kept: the one whose lines add up, then the one with
 * more lines, the older, the smaller id; every device keeps the same one. The others → their twin (id → the one kept).
 */
export function twinSweep<T extends Pick<SupplierPaper, 'id' | 'supplierId' | 'vendor' | 'invoiceNo' | 'date' | 'totalFils' | 'state' | 'adds' | 'lines' | 'createdAt' | 'alone'>>(papers: T[]): Map<string, string> {
  const live = papers.filter((p) => p.state === 'done' || p.state === 'look');
  const better = (a: T, b: T) => Number(b.adds !== false) - Number(a.adds !== false) || (b.lines?.length ?? 0) - (a.lines?.length ?? 0) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
  const ordered = [...live].sort(better);
  const out = new Map<string, string>();
  const kept: T[] = [];
  for (const p of ordered) {
    // by itself, surer than at reading: the same number and the same day or sum (a number again a year on is another paper)
    // «Не дубль» said by a person: never one again
    const twin = p.alone ? undefined : twinOf(p, kept.filter((k) => k.date === p.date || (!!k.totalFils && k.totalFils === p.totalFils)));
    if (twin) out.set(p.id, twin.id);
    else kept.push(p);
  }
  return out;
}
