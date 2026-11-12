import type { Lang } from './types';

export const TZ = 'Asia/Dubai';

let clockOffsetMs = 0;
let lastNow = 0;

export function nowIso(): string {
  if (clockOffsetMs !== 0) return new Date(Date.now() + clockOffsetMs).toISOString();
  // Strictly increasing: two records made within the same millisecond still keep their order
  // (the money book sorts same-day entries by the moment they were recorded).
  lastNow = Math.max(Date.now(), lastNow + 1);
  return new Date(lastNow).toISOString();
}

/**
 * Demo data only: run `fn` as if the current time were `at`, so sample jobs get realistic history
 * (sent three hours ago, closed last week). Normal work never shifts the clock.
 */
export async function runAt<T>(at: string, fn: () => Promise<T>): Promise<T> {
  const prev = clockOffsetMs;
  clockOffsetMs = new Date(at).getTime() - Date.now();
  try {
    return await fn();
  } finally {
    clockOffsetMs = prev;
  }
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Calendar date in Dubai as YYYY-MM-DD. */
export function dubaiDate(iso: string | Date = new Date()): string {
  return dayFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function monthKey(iso: string | Date = new Date()): string {
  return dubaiDate(iso).slice(0, 7);
}

function parts(iso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** DD/MM/YYYY (Dubai time). Accepts ISO timestamps or YYYY-MM-DD. */
export function formatDate(iso?: string): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  const p = parts(iso);
  return `${p.day}/${p.month}/${p.year}`;
}

/** DD/MM/YYYY HH:mm (Dubai time). */
const docFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/** Date on invoices and quotations, as the garage's documents show it: "8 Nov 2026, 9:30:00 AM · GST". */
export function formatDocDate(iso?: string): string {
  if (!iso) return '';
  const p = Object.fromEntries(docFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} ${(p.dayPeriod ?? '').toUpperCase()} · GST`;
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const p = parts(iso);
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.day}/${p.month}/${p.year} ${hour}:${p.minute}`;
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}

/** "HH:mm" in Dubai. */
export function dubaiTime(iso: string): string {
  const p = parts(iso);
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** A moment in Dubai (UTC+4 all year — no daylight saving): a day and a time. */
export function dubaiAt(day: string, hour: number, minute = 0): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+04:00`).toISOString();
}

/** A calendar day (YYYY-MM-DD) moved by whole days. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one calendar day to another (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000);
}

/**
 * A promised moment, short, for the screen: the day ('' — today; "завтра", "пт", "14/11") and the time.
 * The screens put them together ("сегодня к 18:00", "пт к 18:00").
 */
export function whenParts(iso: string, lang: Lang, now: string = nowIso()): { day: string; time: string; today: boolean } {
  const day = dubaiDate(iso);
  const today = dubaiDate(now);
  const time = dubaiTime(iso);
  const ru = lang === 'ru';
  const diff = daysBetween(today, day);
  if (diff === 0) return { day: '', time, today: true };
  if (diff === 1) return { day: ru ? 'завтра' : 'tomorrow', time, today: false };
  if (diff === -1) return { day: ru ? 'вчера' : 'yesterday', time, today: false };
  if (diff > 1 && diff < 7) {
    const wd = new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-GB', { weekday: 'short', timeZone: TZ }).format(new Date(iso));
    return { day: wd.replace('.', ''), time, today: false };
  }
  return { day: formatDate(day).slice(0, 5), time, today: false };
}

export function hoursBetween(fromIso: string, toIso: string = nowIso()): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3600000;
}

/** Short human duration: "35 мин" / "5 ч" / "3 д". */
export function shortDuration(hours: number, lang: Lang): string {
  const ru = lang === 'ru';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} ${ru ? 'мин' : 'min'}`;
  if (hours < 48) return `${Math.floor(hours)} ${ru ? 'ч' : 'h'}`;
  return `${Math.floor(hours / 24)} ${ru ? 'д' : 'd'}`;
}

/** Inclusive date range check on YYYY-MM-DD strings. */
/** First and last day of a month "YYYY-MM" as "YYYY-MM-DD". */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

export function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}
