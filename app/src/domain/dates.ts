import type { Lang } from './types';

export const TZ = 'Asia/Dubai';

let clockOffsetMs = 0;

export function nowIso(): string {
  return new Date(Date.now() + clockOffsetMs).toISOString();
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
export function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}
