import { useSyncExternalStore } from 'react';

/**
 * Tactile feedback, named like UIKit's feedback generators.
 *
 * - iPhone and iPad (iOS 18+): WebKit has no vibration API, but toggling a native switch
 *   (`<input type="checkbox" switch>`) plays the system "selection" tap. A hidden switch is toggled from
 *   inside the user's own tap; heavier kinds are two or three taps.
 * - Android: `navigator.vibrate` with short patterns.
 * - Everything else: silent.
 *
 * Can be switched off in "More → Appearance" (kept per device).
 */
export type Haptic = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const KEY = 'mygarage.haptics';

/** Android vibration patterns (ms on, ms off, …). */
const PATTERNS: Record<Haptic, number[]> = {
  selection: [5],
  light: [10],
  medium: [18],
  heavy: [28],
  success: [10, 70, 16],
  warning: [18, 90, 18],
  error: [24, 60, 24, 60, 24],
};
/** iPhone: when each switch tap happens, ms after the first. */
const TAPS: Record<Haptic, number[]> = {
  selection: [0],
  light: [0],
  medium: [0],
  heavy: [0, 55],
  success: [0, 90],
  warning: [0, 130],
  error: [0, 90, 180],
};

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

let enabled = read();
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
  subs.forEach((f) => f());
  if (on) haptic('selection');
}

export function useHaptics(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, hapticsEnabled), setHapticsEnabled];
}

/** iPhone, iPad (also the ones that call themselves a Mac). */
export function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && !isApple();
}

let switchLabel: HTMLLabelElement | null | undefined;

/** The hidden native switch (iOS 17.4+ renders it; iOS 18+ taps when it flips). */
function iosSwitch(): HTMLLabelElement | null {
  if (switchLabel !== undefined) return switchLabel;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  if (!('switch' in input)) {
    switchLabel = null;
    return null;
  }
  input.tabIndex = -1;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
  label.appendChild(input);
  document.body.appendChild(label);
  switchLabel = label;
  return label;
}

/** Whether this device can answer a tap at all (the setting is shown only then). */
export function hapticsAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  if (canVibrate()) return true;
  if (!isApple()) return false;
  const probe = document.createElement('input');
  probe.type = 'checkbox';
  return 'switch' in probe;
}

export function haptic(kind: Haptic = 'light') {
  if (!enabled) return;
  try {
    if (isApple()) {
      const label = iosSwitch();
      if (!label) return;
      for (const ms of TAPS[kind]) {
        if (ms === 0) label.click();
        else window.setTimeout(() => label.click(), ms);
      }
      return;
    }
    if (canVibrate()) navigator.vibrate(PATTERNS[kind]);
  } catch {
    // not supported
  }
}

/** Controls that tick like iOS does: tabs, segmented controls, chips, switches, check boxes. */
const SELECTION =
  '.tab-bar a, .scroll-tabs button, .chip, .wizard-steps button, .mantine-SegmentedControl-label, .mantine-Switch-track, .mantine-Switch-input, ' +
  '.mantine-Checkbox-inner, .mantine-Checkbox-input, .mantine-Chip-label, .mantine-Radio-radio, .choice-card, [role="tab"], [role="radio"]';
/** A light impact for the actions that do something: filled buttons, the "+" of the tab bar. */
const LIGHT = '.mantine-Button-root[data-variant="filled"], .mantine-ActionIcon-root[data-variant="filled"], .tab-plus, .suggest';

/**
 * One listener for the whole app, so every control answers the same way without each screen asking.
 * Runs on the tap itself (click), before the handlers: inside the user gesture, which iOS requires.
 */
export function installHaptics() {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function') return;
      // Explicit camera and photo buttons answer on their own.
      if (t.closest('.cam, .viewer')) return;
      if (t.closest(LIGHT)) haptic('light');
      else if (t.closest(SELECTION)) haptic('selection');
    },
    { capture: true, passive: true },
  );
}
