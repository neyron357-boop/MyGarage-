import { useSyncExternalStore } from 'react';

/*
 * The app's accent colour on this device ("More → Appearance"): the iOS blue, or another iOS colour. It is
 * only a set of CSS variables (styles.css, `data-accent` on <html>): buttons, chips, tabs, links and the
 * glow follow at once, nothing renders again. The steps of a job keep their own colours (PHASE_META).
 */

export const ACCENTS = ['blue', 'indigo', 'purple', 'pink', 'orange', 'green'] as const;
export type Accent = (typeof ACCENTS)[number];

/** The theme colour a swatch of the accent is painted with. */
export const ACCENT_COLOR: Record<Accent, string> = { blue: 'blue', indigo: 'indigo', purple: 'grape', pink: 'pink', orange: 'orange', green: 'green' };

const KEY = 'mygarage.accent';
const EVENT = 'mygarage:accent';

function read(): Accent {
  try {
    const v = localStorage.getItem(KEY);
    return (ACCENTS as readonly string[]).includes(v ?? '') ? (v as Accent) : 'blue';
  } catch {
    return 'blue';
  }
}

let current: Accent | undefined;

/** Puts the accent on the page (at start, before the first paint, and when it is changed). */
export function applyAccent(a: Accent = (current ??= read())): void {
  const root = document.documentElement;
  if (a === 'blue') delete root.dataset.accent;
  else root.dataset.accent = a;
}

export function setAccent(a: Accent): void {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    // private mode: the choice lasts until the app is closed
  }
  current = a;
  applyAccent(a);
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

export function useAccent(): Accent {
  return useSyncExternalStore(subscribe, () => (current ??= read()), () => 'blue' as Accent);
}
