import { describe, expect, it } from 'vitest';
import type { Suggestion, Suggestions } from './linePrices';
import { exactTitle, quickMatches, sideless, sideOf } from './quickAdd';

const s = (titleEn: string, extra: Partial<Suggestion> = {}): [string, Suggestion] => [titleEn, { titleEn, titleRu: '', price: 0, uses: 1, from: 'any', ...extra }];
const set = (...list: [string, Suggestion][]): Suggestions => ({ list: new Map(list), top: list.filter(([, x]) => x.price > 0).map(([k]) => k) });

describe('the quick «＋» sheet: what is offered as it is typed (v0.81)', () => {
  it('reads a side off a title — left, right, or none (both sides, or no side)', () => {
    expect(['HEADLIGHT LH', 'HEADLIGHT RH', 'MIRROR LEFT', 'DOOR HANDLE RIGHT', 'FENDER L', 'ФАРА ЛЕВАЯ', 'BRAKE PADS', 'HEADLIGHT LH & RH', 'OIL 4L'].map(sideOf)).toEqual(['L', 'R', 'L', 'R', 'L', 'L', undefined, undefined, undefined]);
    expect(sideless('HEADLIGHT LH')).toBe(sideless('HEADLIGHT RH'));
  });

  it('every word typed found at a word’s start, in either language, through the dictionary; this car’s price first', () => {
    const list = set(
      s('REAR BRAKE PADS', { price: 15000, from: 'any', uses: 9 }),
      s('FRONT BRAKE PADS', { price: 18000, from: 'car' }),
      s('BRAKE PADS REPLACEMENT', { price: 8000 }),
      s('WHEEL BEARING', { titleRu: 'ПОДШИПНИК СТУПИЦЫ' }),
      s('AIR FILTER'),
    );
    expect(quickMatches(list, 'pads')).toEqual(['FRONT BRAKE PADS', 'REAR BRAKE PADS', 'BRAKE PADS REPLACEMENT']);
    expect(quickMatches(list, 'brake rear')).toEqual(['REAR BRAKE PADS']);
    // Typed in Russian, the history in English: the garage's dictionary (domain/search.ts) — and the line's own Russian name.
    expect(quickMatches(list, 'колодки')).toContain('REAR BRAKE PADS');
    expect(quickMatches(list, 'подшипник')).toEqual(['WHEEL BEARING']);
    // Begins as typed — before one that only holds it.
    expect(quickMatches(list, 'brake')[0]).toBe('BRAKE PADS REPLACEMENT');
    expect(quickMatches(list, 'zzz')).toEqual([]);
  });

  it('the left and the right of one part are two lines, next to each other, the left first', () => {
    const list = set(s('HEADLIGHT RH', { price: 50000, from: 'car' }), s('BUMPER FRONT'), s('HEADLIGHT LH', { price: 50000 }), s('HEADLIGHT BULB'));
    const found = quickMatches(list, 'headl');
    expect(found.slice(0, 2)).toEqual(['HEADLIGHT LH', 'HEADLIGHT RH']);
    expect(found).toContain('HEADLIGHT BULB');
    // Typed with its side — only that side.
    expect(quickMatches(list, 'headlight rh')).toEqual(['HEADLIGHT RH']);
  });

  it('nothing typed — the usual ones; a title typed as the history has it is that one (its price comes with it)', () => {
    const list = set(s('OIL CHANGE', { price: 12000 }), s('WASH', { price: 3000 }), s('AIR FILTER'));
    expect(quickMatches(list, '')).toEqual(['OIL CHANGE', 'WASH']);
    expect(exactTitle(list, 'oil change')).toBe('OIL CHANGE');
    expect(exactTitle(list, 'oil')).toBeUndefined();
    expect(quickMatches(undefined, 'oil')).toEqual([]);
  });
});
