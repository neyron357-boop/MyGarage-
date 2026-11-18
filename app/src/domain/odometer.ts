/*
 * A car's mileage read off a photo of its dashboard (v0.44): which of the numbers there is the odometer. A dashboard
 * shows many — the speedometer's scale (20 · 40 · … 260), the trip meters (123.4), the clock (12:45), the
 * temperature (24°), the range, the speed (km/h) — the odometer is the long whole number, often beside «km» or «ODO»;
 * and the car's mileage on its last visit says the rest: an odometer only goes up, and not by a lifetime between two
 * visits. Pure: the readings come from services/odometerReader.ts.
 */

/** The most an odometer here is believed to show (a million and a half km is a lorry's long life). */
export const MAX_KM = 1_999_999;
/** Between two visits a car does not go further than this (a taxi in a year and more). */
const MAX_BETWEEN = 150_000;

/**
 * The whole numbers in a line as a dashboard shows them — "123456", "123 456", "123,456 km", a zero read as an O
 * inside the digits — but not a time (12:45), a trip's tenths (123.4), a temperature (24°), a share (80%) or a speed
 * (120 km/h).
 */
export function numbersIn(text: string): number[] {
  const t = text.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0');
  const out: number[] = [];
  const re = /\d(?:[\d,. ]*\d)?/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const raw = m[0];
    const before = t.slice(Math.max(0, m.index - 1), m.index);
    const after = t.slice(m.index + raw.length).replace(/^\s+/, '');
    // A time, a temperature, a share, a speed: not the mileage.
    if (/^[:°%]/.test(after) || before === ':' || /^(km\/h|kmh|kph|mph)\b/i.test(after)) continue;
    for (const part of groups(raw)) {
      const n = Number(part);
      if (Number.isInteger(n) && n >= 0) out.push(n);
    }
  }
  return out;
}

/**
 * One run of digits and marks as numbers: thousands parted by a space, a comma or a point are one number
 * ("123 456", "123,456", "1.234.567"); a point or comma before one digit is a trip's tenths — none; other runs apart
 * are numbers of their own (a speedometer's "20 40 60").
 */
function groups(raw: string): string[] {
  if (/[.,]\d$/.test(raw) && !/[.,]\d{3}$/.test(raw)) return [];
  const parts = raw.split(/[ ,.]/).filter(Boolean);
  if (parts.length > 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3)) return [parts.join('')];
  // Commas or points between groups that are not thousands: a decimal or a list — nothing sure.
  if (/[.,]/.test(raw)) return [];
  return parts;
}

/** One number read off the photo: by which reading (`source`), how sure it was (0–100), «km» / «ODO» beside it. */
export interface OdoRead {
  km: number;
  conf: number;
  source: string;
  label?: boolean;
}

export interface OdoPick {
  /** The likeliest mileage (none — nothing like one was read). */
  km?: number;
  /** Read the same by two readings (or more), long enough or by its label, and fitting the last visit: it may go in by itself. */
  sure: boolean;
  /** The likeliest numbers, best first, to pick from with one tap. */
  offered: number[];
}

/** Does a mileage fit the car's mileage on its last visit (none known — anything does)? */
export function fitsPrevious(km: number, previousKm?: number): boolean {
  return previousKm === undefined || (km >= previousKm && km - previousKm <= MAX_BETWEEN);
}

/**
 * The odometer among the numbers read: the one more readings agree on, by «km» / «ODO», five digits and more, fitting
 * the last visit; a speedometer's round scale number is hardly one. Sure only when two readings read it alike and no
 * other comes close.
 */
export function pickOdometer(reads: OdoRead[], previousKm?: number): OdoPick {
  const by = new Map<number, { km: number; votes: Set<string>; conf: number; label: boolean }>();
  for (const r of reads) {
    if (!(r.km >= 100 && r.km <= MAX_KM)) continue;
    const x = by.get(r.km) ?? { km: r.km, votes: new Set<string>(), conf: 0, label: false };
    x.votes.add(r.source);
    x.conf = Math.max(x.conf, r.conf);
    x.label ||= !!r.label;
    by.set(r.km, x);
  }
  const known = previousKm !== undefined;
  const score = (x: { km: number; votes: Set<string>; conf: number; label: boolean }) =>
    x.votes.size * 2 +
    (x.label ? 2 : 0) +
    (String(x.km).length >= 5 ? 1.5 : String(x.km).length === 4 ? 0.5 : 0) +
    x.conf / 100 -
    (x.km <= 400 && x.km % 10 === 0 ? 3 : 0) +
    (known ? (fitsPrevious(x.km, previousKm) ? 3 : -4) : 0);
  const list = [...by.values()].map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s || b.x.km - a.x.km);
  const best = list[0];
  if (!best) return { sure: false, offered: [] };
  const close = list[1] && list[1].s > best.s - 1.5;
  // Four digits only beside the last visit's mileage (a trip meter's 345.6 read without its point is four digits too).
  const long = String(best.x.km).length >= 5 || (known && String(best.x.km).length === 4);
  const sure = best.x.votes.size >= 2 && fitsPrevious(best.x.km, previousKm) && long && !close;
  // Offered to pick: what may be a mileage — not the scale's 200 or a clock's 920 (a new car's 150 km only beside its
  // last visit's).
  const offered = list.filter((y) => y.x.km >= 1000 || (known && fitsPrevious(y.x.km, previousKm))).map((y) => y.x.km);
  return { km: sure ? best.x.km : offered[0], sure, offered: offered.slice(0, 3) };
}

/**
 * The numbers of a seven-segment row as read by its segments (domain/sevenSegment.ts): its runs of digits — a mark that
 * is no digit ('?', ' ') parts them, never joins them as thousands; a point or a colon — a trip meter or a clock: none.
 */
export function segNumbers(digits: string): number[] {
  if (/[.:]/.test(digits)) return [];
  return digits
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
}

/** "123 456" — a mileage as it is read aloud (a space between the thousands, whatever the language). */
export function formatKm(km: number): string {
  return String(Math.round(km)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A mileage typed: digits only (spaces, commas and points between them are the thousands); nothing — none. */
export function parseKm(typed: string): number | undefined {
  const digits = typed.replace(/[\s,.'’]/g, '');
  if (!/^\d{1,7}$/.test(digits)) return undefined;
  const n = Number(digits);
  return n <= MAX_KM ? n : undefined;
}
