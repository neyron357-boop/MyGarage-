import { useEffect, useState, useSyncExternalStore } from 'react';
import { isDaytime } from '../domain/daylight';

/*
 * Light, dark or auto — the app's own setting (on this device). "Auto" follows the sun in Dubai:
 * light from sunrise, dark from sunset, re-checked every minute and whenever the app comes back.
 * Mantine gets the result as a forced scheme, so the phone's own dark mode does not decide it.
 */

export type SchemePref = 'light' | 'dark' | 'auto';
const KEY = 'mygarage.scheme';
const EVENT = 'mygarage:scheme';

function read(): SchemePref {
  try {
    // Before this setting the choice was Mantine's own (same values).
    const v = localStorage.getItem(KEY) ?? localStorage.getItem('mantine-color-scheme-value');
    return v === 'dark' || v === 'auto' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function setSchemePref(p: SchemePref): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // private mode: the choice lasts until the app is closed
  }
  current = p;
  window.dispatchEvent(new Event(EVENT));
}

let current: SchemePref | undefined;
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};
const snapshot = () => (current ??= read());

export function useSchemePref(): SchemePref {
  return useSyncExternalStore(subscribe, snapshot, () => 'light' as SchemePref);
}

/** The scheme the app shows now: the choice, or day/night in Dubai for "auto". */
export function useResolvedScheme(): 'light' | 'dark' {
  const pref = useSchemePref();
  const [day, setDay] = useState(() => isDaytime());
  useEffect(() => {
    if (pref !== 'auto') return;
    const check = () => setDay(isDaytime());
    check();
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pref]);
  return pref === 'auto' ? (day ? 'light' : 'dark') : pref;
}
