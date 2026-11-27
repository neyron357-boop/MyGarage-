/*
 * The Mulkiya's expiry (audit 27/11: «полное чтение Mulkiya — срок регистрации и напоминание о продлении»): the card's
 * front prints «Exp. Date», «Reg. Date» and «Ins. Exp.» each with a day (DD/MM/YYYY). Read on the phone itself — the card
 * carries the owner's name and nationality, so it does not go to the AI. Only the day after an «Exp» that is not the
 * insurance's is sure; else the one day in the year ahead that no label calls the registration's — unsure, shown to be
 * looked at. The day only reminds the customer: a wrong one is put right with a tap.
 */

export interface MulkiyaExpiry {
  /** YYYY-MM-DD */
  date: string;
  sure: boolean;
}

const DATE = /(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?((?:19|20)\d{2})/g;
const DAY = 86_400_000;

const dayOf = (d: string, m: string, y: string): string | undefined => {
  const dd = Number(d);
  const mm = Number(m);
  const yy = Number(y);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  const t = Date.UTC(yy, mm - 1, dd);
  if (new Date(t).getUTCDate() !== dd) return undefined;
  return new Date(t).toISOString().slice(0, 10);
};

/** What the words before a day call it: the expiry, the insurance's, the registration's day, or nothing. */
function labelOf(before: string): 'exp' | 'ins' | 'reg' | undefined {
  const w = before
    .toUpperCase()
    .replace(/[^A-Z؀-ۿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(-3)
    .join(' ');
  if (/\bINS/.test(w) || /تأمين/.test(before)) return 'ins';
  if (/\bEXP|EXPIRY|EXPIRES|انتهاء/.test(w) || /انتهاء/.test(before)) return 'exp';
  if (/\bREG\b|REGISTRATION|تسجيل/.test(w) || /تسجيل/.test(before)) return 'reg';
  return undefined;
}

/**
 * The expiry read off the card's text (its rows, top to bottom). `today` — YYYY-MM-DD: a registration runs a year (a new
 * car's — up to three), so a day more than three years ahead or more than a year past is not it.
 */
export function mulkiyaExpiry(text: string, today: string): MulkiyaExpiry | undefined {
  const now = Date.parse(`${today}T00:00:00Z`);
  const inRange = (day: string) => {
    const t = Date.parse(`${day}T00:00:00Z`);
    return t >= now - 400 * DAY && t <= now + 3 * 366 * DAY;
  };
  const found: { day: string; label?: 'exp' | 'ins' | 'reg' }[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(DATE)) {
      const day = dayOf(m[1], m[2], m[3]);
      if (!day || !inRange(day)) continue;
      found.push({ day, label: labelOf(line.slice(Math.max(0, m.index! - 30), m.index)) });
    }
  }
  const exp = [...new Set(found.filter((f) => f.label === 'exp').map((f) => f.day))];
  if (exp.length === 1) return { date: exp[0], sure: true };
  // No label read: the one day of the year ahead that is not the registration's day (the insurance's is the same as a
  // rule, or a few days off — the earlier of two such days, so the customer hears in time).
  const ahead = [...new Set(found.filter((f) => f.label !== 'reg' && f.label !== 'ins' && Date.parse(`${f.day}T00:00:00Z`) >= now - 60 * DAY).map((f) => f.day))].sort();
  if (ahead.length === 1 || (ahead.length === 2 && Math.abs(Date.parse(ahead[1]) - Date.parse(ahead[0])) <= 31 * DAY)) return { date: ahead[0], sure: false };
  return undefined;
}

/** How the expiry stands for a reminder: past, within a month, or later. */
export function expiryState(date: string | undefined, today: string): 'past' | 'soon' | 'later' | undefined {
  if (!date) return undefined;
  if (date < today) return 'past';
  return Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) <= 30 * DAY ? 'soon' : 'later';
}
