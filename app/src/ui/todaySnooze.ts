import { useSyncExternalStore } from 'react';
import { dubaiDate } from '../domain/dates';

/*
 * «Отложить» a thing of «Сегодня» (v0.99, audit Д25): «Заказать запчасти» hung there and went red, and it could not be put
 * off for an hour. The device's own (not the garage's data): the thing is out of the list until its time, then back.
 */

const KEY = 'mygarage.today.snooze';
let until: Record<string, number> = read();
const subs = new Set<() => void>();

function read(): Record<string, number> {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, t]) => t > now));
  } catch {
    return {};
  }
}

function keep() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(until));
  } catch {
    // kept while the app is open
  }
  subs.forEach((f) => f());
}

export type SnoozeFor = 'hour' | 'evening' | 'tomorrow';

/** The moment a thing put off comes back: in an hour, this evening at 18:00 (or in three hours, later than that), tomorrow at 9:00. */
export function snoozeUntil(how: SnoozeFor, now = Date.now()): number {
  if (how === 'hour') return now + 3600_000;
  const today = dubaiDate(new Date(now).toISOString());
  if (how === 'evening') {
    const six = Date.parse(`${today}T18:00:00+04:00`);
    return six > now + 30 * 60_000 ? six : now + 3 * 3600_000;
  }
  const next = dubaiDate(new Date(now + 86400_000).toISOString());
  return Date.parse(`${next}T09:00:00+04:00`);
}

export function snooze(key: string, how: SnoozeFor): void {
  until = { ...until, [key]: snoozeUntil(how) };
  keep();
}

export function unsnooze(key: string): void {
  const { [key]: _gone, ...rest } = until;
  until = rest;
  keep();
}

export function useSnoozed(): Record<string, number> {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      // Back at its time: the list looks again each minute.
      const timer = window.setInterval(() => {
        const now = Date.now();
        if (Object.values(until).some((t) => t <= now)) {
          until = Object.fromEntries(Object.entries(until).filter(([, t]) => t > now));
          keep();
        }
      }, 60_000);
      return () => {
        subs.delete(f);
        window.clearInterval(timer);
      };
    },
    () => until,
  );
}
