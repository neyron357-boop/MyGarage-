import { describe, expect, it } from 'vitest';
import { checkLabel, cleanList, DEFAULT_QUICK_LISTS, lightLabel, moveLine, quickList } from './quickLists';

describe('quick lists', () => {
  it('uses the standard English list until the garage has its own (an emptied list stays empty)', () => {
    expect(quickList(undefined, 'complaints')).toEqual(DEFAULT_QUICK_LISTS.complaints);
    expect(quickList({ quickLists: {} }, 'warningLights')).toEqual(DEFAULT_QUICK_LISTS.warningLights);
    expect(quickList({ quickLists: { skipReasons: ['Rain'] } }, 'skipReasons')).toEqual(['Rain']);
    expect(quickList({ quickLists: { complaints: [] } }, 'complaints')).toEqual([]);
  });

  it('keeps the standard lists in English', () => {
    for (const list of Object.values(DEFAULT_QUICK_LISTS)) for (const line of list) expect(line).not.toMatch(/[а-яё]/i);
  });

  it('cleans a list typed by hand: trims, drops empty lines and repeats', () => {
    expect(cleanList(['  Brakes ', '', 'brakes', 'A/C  not cooling', '   '])).toEqual(['Brakes', 'A/C not cooling']);
  });

  it('moves a line up and down', () => {
    expect(moveLine(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveLine(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveLine(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('says a stored light or check: the words as they are, an old built-in code in the language of t', () => {
    const texts: Record<string, string> = { 'light.check_engine': 'Check Engine', 'check.ac': 'A/C' };
    const t = (key: string, o?: { defaultValue?: string }) => texts[key] ?? o?.defaultValue ?? key;
    expect(lightLabel(t, 'check_engine')).toBe('Check Engine');
    expect(lightLabel(t, 'Glow plug')).toBe('Glow plug');
    expect(checkLabel(t, 'ac')).toBe('A/C');
    expect(checkLabel(t, 'Parking sensors')).toBe('Parking sensors');
  });
});
