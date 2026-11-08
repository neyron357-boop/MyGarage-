import { useSyncExternalStore } from 'react';

/**
 * Tactile feedback.
 *
 * iPhone (iOS 18+): WebKit has no vibration API. The one haptic a page gets is the system tap of a
 * switch control (`<input type="checkbox" switch>`), and since iOS 26.5 only for a trusted click —
 * the user's own tap, not a script's `click()` (WebKit: CheckboxInputType::willDispatchClick needs
 * `state.trusted`; a label forwards trust from the tap, Element::dispatchSimulatedClick). So every
 * control that should tick gets a transparent `<label for="mg-haptic">` laid over it: the finger
 * lands on the label, the click bubbles to the control as usual (its handler runs), and the label
 * forwards a trusted click to one hidden switch, which plays the tap. Labels do not catch scrolling
 * and only click on a real tap. Mantine's own check boxes and switches become switch controls
 * themselves. Segments of a segmented control (labels already) get a switch laid over them that
 * selects the segment.
 *
 * Android: `navigator.vibrate` with short patterns, from the same taps.
 * Everything else: silent. Switched off in "More → Appearance" (kept per device).
 */
export type Haptic = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const KEY = 'mygarage.haptics';
/** Dev aid: lay the labels in any browser (to check that controls still work under them). */
const FORCE_LABELS_KEY = 'mygarage.hapticLabels';
const SWITCH_ID = 'mg-haptic';

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
  document.documentElement.classList.toggle('no-haptics', !on);
  subs.forEach((f) => f());
  scheduleScan();
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

/**
 * iOS major.minor from the user agent, only good for "older than 18" (iOS 26 reports a frozen 18.x;
 * iPads that present themselves as a Mac report none).
 */
export function iosVersion(): number | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const m = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) + Number(m[2]) / 100 : undefined;
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && !isApple();
}

function supportsSwitch(): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('input');
  probe.type = 'checkbox';
  return 'switch' in probe;
}

function forcedLabels(): boolean {
  try {
    return localStorage.getItem(FORCE_LABELS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Taps get their haptic from labels over the controls (iPhone; or forced for a check in another browser). */
function usesLabels(): boolean {
  return (isApple() && supportsSwitch()) || forcedLabels();
}

/** Whether this device can answer a tap at all (the setting is shown only then). */
export function hapticsAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  if (isApple()) {
    // The switch control exists since iOS 17.4; it taps since iOS 18.
    const v = iosVersion();
    return supportsSwitch() && (v === undefined || v >= 18);
  }
  return canVibrate();
}

/**
 * A haptic started by the app itself (after a payment is saved, a photo taken). Android only: on an
 * iPhone a page cannot start one — there the user's taps tick through the labels.
 */
export function haptic(kind: Haptic = 'light') {
  if (!enabled || !canVibrate()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // not supported
  }
}

/* ---------------- Labels over the controls ---------------- */

/** Controls that tick: buttons of every kind, chips, tabs, the tab bar, wizard steps, camera and photo buttons. */
const TAPPABLE = [
  'button.mantine-Button-root:not([type="submit"])',
  'button.mantine-ActionIcon-root:not([type="submit"])',
  'button.mantine-CloseButton-root',
  'button.mantine-UnstyledButton-root.choice-card',
  'button.chip',
  '.scroll-tabs > button',
  '.wizard-steps > button',
  '.tab-bar button',
  'button.tab-plus',
  'button.suggest',
  'button.search-cancel',
  'button.photo-slot',
  '.cam button',
  '.viewer button',
].join(',');
/** Real check boxes and switches: they become switch controls and tick by themselves. */
const CHECKABLE = '.mantine-Switch-input, .mantine-Checkbox-input, .mantine-Chip-input';
/** Segments are labels of radio buttons already: a switch laid over each selects its radio. */
const SEGMENT = '.mantine-SegmentedControl-control';

let switchEl: HTMLInputElement | null = null;

function ensureSwitch(): HTMLInputElement {
  if (switchEl?.isConnected) return switchEl;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = SWITCH_ID;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // No box: it is never focused (a label click must not take the keyboard away) and never shown.
  input.style.display = 'none';
  document.body.appendChild(input);
  switchEl = input;
  return input;
}

function addLabel(el: Element) {
  for (const c of Array.from(el.children)) if (c.classList.contains('haptic-hit')) return;
  const label = document.createElement('label');
  label.className = 'haptic-hit';
  label.htmlFor = SWITCH_ID;
  label.setAttribute('aria-hidden', 'true');
  el.appendChild(label);
}

function addSegmentSwitch(control: Element) {
  for (const c of Array.from(control.children)) if (c.classList.contains('haptic-switch')) return;
  const radio = control.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) return;
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.className = 'haptic-switch';
  sw.tabIndex = -1;
  sw.setAttribute('aria-hidden', 'true');
  // The finger lands on the switch (it ticks); the segment is then chosen as if its label was tapped.
  sw.addEventListener('click', () => {
    if (!radio.checked && !radio.disabled) radio.click();
  });
  control.appendChild(sw);
}

let frame = 0;
function scan() {
  frame = 0;
  if (typeof document === 'undefined') return;
  const on = enabled && usesLabels();
  if (on) {
    ensureSwitch();
    document.querySelectorAll(TAPPABLE).forEach(addLabel);
    document.querySelectorAll(SEGMENT).forEach(addSegmentSwitch);
  }
  document.querySelectorAll<HTMLInputElement>(CHECKABLE).forEach((input) => {
    if (on && !input.hasAttribute('switch')) input.setAttribute('switch', '');
    else if (!on && input.hasAttribute('switch')) input.removeAttribute('switch');
  });
}

function scheduleScan() {
  if (!frame && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(scan);
}

/** Selectors for the Android vibration (taps on the same controls). */
const SELECTION = '.tab-bar button, .scroll-tabs button, .chip, .wizard-steps button, .mantine-SegmentedControl-label, .mantine-Switch-track, .mantine-Switch-input, .mantine-Checkbox-input, .mantine-Chip-label, .choice-card';
const LIGHT = '.mantine-Button-root, .mantine-ActionIcon-root, .tab-plus, .suggest';

/**
 * Called once at start: lays the labels over controls as they appear (one observer for the whole
 * app, so no screen has to ask), and vibrates on Android.
 */
export function installHaptics() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('no-haptics', !enabled);
  if (usesLabels()) {
    document.documentElement.classList.add('haptic-labels');
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    scheduleScan();
  }
  if (canVibrate()) {
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target as Element | null;
        if (!e.isTrusted || !t || typeof t.closest !== 'function') return;
        if (t.closest('.cam, .viewer')) return;
        if (t.closest(LIGHT)) haptic('light');
        else if (t.closest(SELECTION)) haptic('selection');
      },
      { capture: true, passive: true },
    );
  }
}
