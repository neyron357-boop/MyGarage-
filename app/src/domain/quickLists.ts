import type { Settings } from './types';

/**
 * Quick-pick lists: one tap puts the words into a field that ends up in the customer's documents
 * (complaint, warning lights and checks of the check-in report, why a photo is missing). Documents go
 * out in English by default, so the lists are English; the manager edits them in Settings → Lists.
 */
export type QuickListKey = 'complaints' | 'warningLights' | 'functionChecks' | 'skipReasons';
export type QuickLists = Partial<Record<QuickListKey, string[]>>;

export const QUICK_LIST_KEYS: QuickListKey[] = ['complaints', 'warningLights', 'functionChecks', 'skipReasons'];

export const DEFAULT_QUICK_LISTS: Record<QuickListKey, string[]> = {
  complaints: [
    'Scheduled service',
    'Oil change',
    'Brake noise',
    'Brakes weak',
    'A/C not cooling',
    'Check Engine light on',
    'Suspension noise',
    'Steering pulls to one side',
    'Vibration at speed',
    'Engine overheating',
    'Oil leak',
    'Coolant leak',
    'Battery weak',
    'Electrical problem',
    'Won’t start',
    'Strange noise',
    'Gearbox problem',
    'Tyres / wheel alignment',
    'Pre-purchase inspection',
  ],
  warningLights: [
    'Check Engine',
    'ABS',
    'Airbag',
    'Oil pressure',
    'Battery',
    'Coolant temperature',
    'Brake',
    'Tyre pressure',
    'ESP / Traction',
    'Glow plug',
    'Service due',
    'Other',
  ],
  functionChecks: [
    'A/C',
    'Power windows',
    'Central locking',
    'Radio / screen',
    'Headlights',
    'Indicators',
    'Brake lights',
    'Wipers',
    'Horn',
    'Mirrors',
    'Alarm',
    'Rear camera',
    'Parking sensors',
  ],
  skipReasons: ['Too dark', 'Car is dirty', 'No space around the car', 'Customer in a hurry'],
};

/** The list the garage uses: its own one from Settings (even an emptied one), or the standard one. */
export function quickList(s: Pick<Settings, 'quickLists'> | undefined | null, key: QuickListKey): string[] {
  return s?.quickLists?.[key] ?? DEFAULT_QUICK_LISTS[key];
}

/** The list with the line at `from` moved to `to`. */
export function moveLine(items: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** A list edited by hand: trimmed lines, no empty ones, no repeats (case does not count). */
export function cleanList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.replace(/\s+/g, ' ').trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

type T = (key: string, options?: { defaultValue?: string }) => string;

/**
 * The name of a warning light or a check as it is stored on a report: the words of the list as they
 * are, or (reports from before the lists) a built-in code such as `check_engine`, said in `t`'s language.
 */
export function lightLabel(t: T, value: string): string {
  return t(`light.${value}`, { defaultValue: value });
}
export function checkLabel(t: T, value: string): string {
  return t(`check.${value}`, { defaultValue: value });
}
