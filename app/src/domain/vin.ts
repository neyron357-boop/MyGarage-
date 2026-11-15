/*
 * A car's VIN (ISO 3779): 17 characters of A–Z and 0–9 — never I, O or Q — the last four always digits. Read off
 * a photo it comes with the usual slips of reading — O for 0, I for 1, a space in the middle, a 5 for an S — that
 * its own rules catch: the length, the letters it never has, the digits at its end, the check digit (the 9th: on
 * every VIN made for North America and on many others), the maker's code (its first characters), the model year
 * (the 10th). A VIN is taken as read only when it proves itself — its check digit adding up, read so more than
 * once, or the same VIN read off two photos (the plate and the Mulkiya); anything less is offered to be looked at,
 * never written by itself.
 */

/** The characters a VIN is made of. */
export const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const VIN_RE = /^[A-HJ-NPR-Z0-9]{13}[0-9]{4}$/;

export const isVin = (s: string): boolean => VIN_RE.test(s);

const VALUE: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHT = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** The check digit a VIN should carry in its 9th place ("X" for ten). */
export function vinCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (c >= '0' && c <= '9' ? Number(c) : VALUE[c] ?? 0) * WEIGHT[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

export const checkDigitOk = (vin: string): boolean => isVin(vin) && vin[8] === vinCheckDigit(vin);

/** In how many places two VINs differ. */
const apart = (a: string, b: string) => [...a].filter((c, i) => c !== b[i]).length;

/**
 * A piece of read text in a VIN's own characters: upper case, no spaces, dashes or dots; the letters a VIN never
 * has read as the digits they must have been (O, Q → 0; I → 1).
 */
export function vinChars(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/I/g, '1')
    .replace(/[^A-Z0-9]/g, '');
}

/** Words of a VIN's label, glued to the VIN by a reading ("CHASSISNO.JTM…", "VIN:JTM…"). */
const LABEL = /(CHASSIS|CHASS1S|VIN|V1N|FRAME|NUMBER|NO\.)(?=[A-Z0-9])/g;

const plausible = (v: string) => isVin(v) && /[A-Z]/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 5;

/**
 * Every VIN in a text read off a photo, each once: whole words of 17 characters, or a VIN split by spaces into a
 * few whole words; a word longer than 17 only at its start or its end (a label or a stray mark glued to it) —
 * never a window cut across words, which only makes up VINs that are not there.
 */
export function vinsInText(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const words = line
      .toUpperCase()
      .replace(LABEL, '$1 ')
      .split(/[\s:;,|/\\]+/)
      .map(vinChars)
      .filter(Boolean);
    for (let a = 0; a < words.length; a++) {
      const w = words[a];
      if (w.length > 17) {
        for (const v of [w.slice(0, 17), w.slice(-17)]) if (plausible(v)) out.add(v);
        continue;
      }
      let joined = '';
      for (let b = a; b < words.length && b < a + 4 && joined.length < 17; b++) joined += words[b];
      if (joined.length === 17 && plausible(joined)) out.add(joined);
    }
  }
  return [...out];
}

/**
 * The characters a reading mixes up most — each with what it may really have been (both are VIN characters). Kept
 * short on purpose: every extra pair is one more way to "fix" a VIN into a wrong one that still adds up.
 */
const LOOKALIKE: Record<string, string> = {
  '0': 'D', D: '0', '8': 'B', B: '8', '5': 'S', S: '5', '2': 'Z', Z: '2', '6': 'G', G: '6',
  '1': '7L', '7': '1', L: '1', U: 'V', V: 'U', M: 'N', N: 'M',
};

/**
 * A VIN read with a check digit that does not add up: the one look-alike swap (or the check digit itself misread)
 * that makes it right — only when there is exactly one; otherwise nothing.
 */
export function fixByCheckDigit(vin: string): string | undefined {
  if (!isVin(vin) || checkDigitOk(vin)) return undefined;
  const fixes = new Set<string>();
  for (let i = 0; i < 17; i++) {
    for (const c of LOOKALIKE[vin[i]] ?? '') {
      const v = vin.slice(0, i) + c + vin.slice(i + 1);
      if (checkDigitOk(v)) fixes.add(v);
    }
  }
  return fixes.size === 1 ? [...fixes][0] : undefined;
}

/**
 * Several readings of the same VIN that each got a character or two wrong — in different places — voted into
 * one: at each place the character the readings were surest of (by how sure each was, or one vote each). Only
 * readings close to the most common one take part (another VIN on the photo does not). The vote never looks at
 * the check digit: a voted VIN that adds up proves itself as much as one read whole.
 */
export function voteVin(reads: { vin: string; conf?: number[] }[]): string | undefined {
  if (reads.length < 2) return undefined;
  const count = new Map<string, number>();
  for (const r of reads) count.set(r.vin, (count.get(r.vin) ?? 0) + 1);
  const common = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const near = reads.filter((r) => apart(r.vin, common) <= 4);
  if (near.length < 2) return undefined;
  let out = '';
  for (let i = 0; i < 17; i++) {
    const score = new Map<string, number>();
    for (const r of near) score.set(r.vin[i], (score.get(r.vin[i]) ?? 0) + (r.conf?.[i] ?? 60));
    out += [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  return isVin(out) ? out : undefined;
}

/** The model year a VIN's 10th character tells — only the latest it may be that is not past next year. */
export function vinYear(vin: string, now = new Date()): number | undefined {
  const codes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const i = codes.indexOf(vin[9] ?? '');
  if (!isVin(vin) || i < 0) return undefined;
  const last = now.getUTCFullYear() + 1;
  let year = 1980 + i;
  while (year + 30 <= last) year += 30;
  return year;
}

/** Makers by the first characters of their VINs — the ones a garage in the UAE sees most; brands of one maker together. */
const MAKERS: [makes: string[], prefixes: string[]][] = [
  [['toyota', 'lexus'], ['JT', '2T', '4T', '5T', 'MR0', 'MR1', 'MR2', '6T1', 'VNK', 'SB1', 'AHT', 'NMT', 'LTV', 'LFM', 'MHF']],
  [['nissan', 'infiniti'], ['JN', '1N', '3N', '5N', 'MNT', 'VSK', 'SJN', 'MDH', 'VNV']],
  [['mitsubishi'], ['JA3', 'JA4', 'JA7', 'JMB', 'JMY', 'JMA', 'JMF', 'ML3', 'MMB', 'MMC', 'MMT', 'MMA', 'MME', '4A3', '4A4']],
  [['honda', 'acura'], ['JH', '1HG', '2HG', '5FN', '5J6', '5J8', '19X', '19U', 'MRH', 'SHH', 'SHS', 'LUC', '7FA']],
  [['mazda'], ['JM1', 'JM3', 'JMZ', '1YV', '4F2', 'MM7', 'MM8', '3MZ', '3MD', '3MV', 'PE1']],
  [['hyundai', 'genesis'], ['KMH', 'KM8', 'KMF', 'KMT', 'KMJ', '5NP', '5NM', 'MAL', 'NLH', 'TMA', 'KMC']],
  [['kia'], ['KNA', 'KNC', 'KND', 'KNE', '5XY', '3KP', 'U5Y', 'U6Y', 'MZB', 'KNM']],
  [['suzuki'], ['JS', 'MA3', 'TSM', 'MBH', 'MMS']],
  [['isuzu'], ['JAA', 'JAL', 'JAC', 'MPA', 'MP1', '4S1']],
  [['subaru'], ['JF1', 'JF2', '4S3', '4S4']],
  [['ford', 'lincoln'], ['1F', '2F', '3F', 'WF0', 'MAJ', 'MNB', '6FP', 'NM0', '1L', '5L', '2L', '1Z', 'LVS']],
  [['chevrolet', 'gmc', 'cadillac', 'buick', 'hummer'], ['1G', '2G', '3G', 'KL', '5GA', '5GT', 'LSG', '6G']],
  [['dodge', 'chrysler', 'jeep', 'ram'], ['1C', '2C', '3C', '1J', '1D', '2D', '3D', 'ZAC']],
  [['mercedes-benz', 'mercedes'], ['WDB', 'WDC', 'WDD', 'WDF', 'WMX', 'W1K', 'W1N', 'W1V', 'W1W', '4JG', '55S']],
  [['bmw', 'mini'], ['WBA', 'WBS', 'WBX', 'WBY', '5UX', '5YM', '4US', 'WMW']],
  [['audi'], ['WAU', 'WA1', 'TRU', 'WUA']],
  [['volkswagen', 'vw'], ['WVW', 'WVG', 'WV1', 'WV2', '3VW', '1VW', '9BW', 'AAV']],
  [['porsche'], ['WP0', 'WP1']],
  [['land rover', 'range rover'], ['SAL']],
  [['jaguar'], ['SAJ', 'SAD']],
  [['volvo'], ['YV1', 'YV4', 'LYV']],
  [['peugeot'], ['VF3', 'VR3']],
  [['renault', 'dacia'], ['VF1', 'VF6', 'UU1']],
  [['citroen'], ['VF7']],
  [['fiat'], ['ZFA']],
  [['alfa romeo'], ['ZAR']],
  [['maserati'], ['ZAM']],
  [['ferrari'], ['ZFF']],
  [['lamborghini'], ['ZHW']],
  [['bentley'], ['SCB']],
  [['rolls-royce', 'rolls royce'], ['SCA']],
  [['aston martin'], ['SCF']],
  [['tesla'], ['5YJ', '7SA', 'LRW', 'XP7']],
  [['mg'], ['LSJ', 'SAR']],
  [['geely'], ['LB3', 'L6T']],
  [['chery'], ['LVV']],
  [['haval', 'great wall', 'gwm'], ['LGW']],
  [['changan'], ['LS5']],
  [['byd'], ['LGX', 'LC0']],
  [['ssangyong'], ['KPT']],
];

const plainMake = (s: string) => s.toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();

function makersOf(vin: string): string[] | undefined {
  let best: [string[], number] | undefined;
  for (const [makes, prefixes] of MAKERS)
    for (const p of prefixes) if (vin.startsWith(p) && (!best || p.length > best[1])) best = [makes, p.length];
  return best?.[0];
}

/** The maker a VIN's first characters belong to, when it is one of those known. */
export const vinMaker = (vin: string): string | undefined => makersOf(vin)?.[0];

/** Whether the VIN is one of the car's maker's: yes, no — or not known (the code or the car's make unknown). */
export function makeMatches(vin: string, make?: string): boolean | undefined {
  const makes = makersOf(vin);
  const m = make ? plainMake(make) : '';
  if (!makes || !m) return undefined;
  return makes.some((x) => m === x || m.startsWith(`${x} `));
}

/**
 * The model year printed on a Mulkiya ("Model 2016", "Model Year: 2016"), out of the text read off it — only a
 * year beside its label (the card's other years are dates: registration, expiry, insurance).
 */
export function mulkiyaYear(text: string, now = new Date()): number | undefined {
  const last = now.getUTCFullYear() + 1;
  const words = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (!/^(MODEL|MODE1|M0DEL|YEAR)$/.test(words[i])) continue;
    // The value follows its label within a few words (the card's two columns may put another label between).
    for (let k = i + 1; k < words.length && k <= i + 4; k++) {
      const y = /^(19|20)\d{2}$/.test(words[k]) ? Number(words[k]) : NaN;
      if (y >= 1970 && y <= last) return y;
    }
  }
  return undefined;
}

/**
 * One VIN read off one photo (`source` — the photo; `from` — as it was read, when its check digit made it right;
 * `conf` — how sure the reading was of each character, 0–100, when known).
 */
export interface VinRead {
  vin: string;
  source: string;
  from?: string;
  conf?: number[];
}

export interface VinPick {
  vin?: string;
  year?: number;
  /** The VIN proved itself: its check digit, or two photos read the same. */
  sure: boolean;
  /** The year is the Mulkiya's printed one (agreeing with the VIN's), or a sure VIN's own. */
  yearSure: boolean;
  /** How it proved itself. */
  why?: 'check' | 'photos';
  /** The VIN's maker by its code, and whether it is the car's. */
  maker?: string;
  makeOk?: boolean;
  /** Places where the reads differ or a look-alike was swapped: to look at first. */
  doubt: number[];
}

/**
 * The VIN and the year out of all that was read off a car's photos. A VIN is sure when its check digit adds up
 * and it was read so more than once (one lucky misreading may add up too) — its maker not another make's — or two
 * different photos read the same VIN; a VIN fixed by its check digit needs a second photo too. The year: the
 * Mulkiya's, when the VIN does not say otherwise; else a sure VIN's own — only one that carries a check digit (a
 * VIN made for elsewhere may not tell its year in the 10th place).
 */
export function pickVin(reads: VinRead[], years: number[], car: { make?: string } = {}, now = new Date()): VinPick {
  const by = new Map<string, { votes: number; plain: number; sources: Set<string> }>();
  for (const r of reads) {
    const e = by.get(r.vin) ?? { votes: 0, plain: 0, sources: new Set<string>() };
    e.votes++;
    // Read as it is, not fitted to its check digit.
    if (!r.from) e.plain++;
    e.sources.add(r.source);
    by.set(r.vin, e);
  }
  const scored = [...by.entries()].map(([vin, e]) => {
    const adds = checkDigitOk(vin);
    const check = adds && e.plain >= 2;
    const fixed = !e.plain;
    const make = makeMatches(vin, car.make);
    const proven = make !== false && (check || e.sources.size >= 2);
    // A VIN that adds up only once fitted (a look-alike swapped) still ranks above the misreading it was fitted from.
    const score = e.votes + 4 * e.sources.size + (check ? 12 : adds ? 6 : 0) + (make === true ? 4 : make === false ? -8 : 0) - (fixed ? 2 : 0);
    return { vin, e, check, make, proven, score };
  });
  scored.sort((a, b) => b.score - a.score || a.vin.localeCompare(b.vin));
  const top = scored[0];
  // The Mulkiya's printed year: sure only when every read of it says the same, and more than one did.
  const tally = new Map<number, number>();
  for (const y of years) tally.set(y, (tally.get(y) ?? 0) + 1);
  const printed = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  const printedSure = printed !== undefined && tally.size === 1 && (tally.get(printed) ?? 0) >= 2;
  if (!top) return { year: printed, yearSure: printedSure, sure: false, doubt: [] };

  // Proven, and no other VIN proven beside it (two photos of two cars, two VINs that both add up: ask).
  const sure = top.proven && !scored.slice(1).some((x) => x.proven);
  const why = !sure ? undefined : top.check ? 'check' : 'photos';
  // To look at first: where other reads of it disagree (a different VIN altogether marks nothing), and where a
  // look-alike was swapped to make it add up.
  const doubt = new Set<number>();
  for (const other of scored.slice(1)) if (apart(other.vin, top.vin) <= 4) for (let i = 0; i < 17; i++) if (other.vin[i] !== top.vin[i]) doubt.add(i);
  for (const r of reads) if (r.vin === top.vin && r.from) for (let i = 0; i < 17; i++) if (r.from[i] !== r.vin[i]) doubt.add(i);
  // …and characters the reading itself was unsure of (in every read of it that says how sure it was).
  const confident = reads.filter((r) => r.vin === top.vin && r.conf?.length === 17);
  if (confident.length) for (let i = 0; i < 17; i++) if (confident.every((r) => r.conf![i] < 80)) doubt.add(i);

  // A VIN with a check digit tells its model year in the 10th place; one made for elsewhere may not.
  const own = top.check ? vinYear(top.vin, now) : undefined;
  const year = printed ?? (sure ? own : undefined);
  // The printed year read the same over and over (and not against the VIN's), or once and just what a sure VIN says
  // — two things that agree; with no printed year, a sure VIN's own.
  const yearSure =
    printed !== undefined ? (printedSure && (own === undefined || own === printed)) || (sure && own === printed) : sure && own !== undefined;
  return { vin: top.vin, year, sure, yearSure, why, maker: vinMaker(top.vin), makeOk: top.make, doubt: [...doubt].sort((a, b) => a - b) };
}
