import { describe, expect, it } from 'vitest';
import type { Suggestion, Suggestions } from './linePrices';
import { autoMatches, exactTitle, guessKind, quickMatches, sideless, sideOf, typedPrice } from './quickAdd';

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

describe('typedPrice (v0.90, «два дефиса и сумма»)', () => {
  it('reads the price after two hyphens, or the dash an iPhone makes of them', () => {
    expect(typedPrice('GEAR OIL -- 450')).toEqual({ name: 'GEAR OIL', priceFils: 45_000 });
    expect(typedPrice('GEAR OIL--450')).toEqual({ name: 'GEAR OIL', priceFils: 45_000 });
    expect(typedPrice('Oil filter — 35.50')).toEqual({ name: 'Oil filter', priceFils: 3_550 });
    expect(typedPrice('ENGINE MOUNT – 1,200')).toEqual({ name: 'ENGINE MOUNT', priceFils: 120_000 });
    expect(typedPrice('масло -- 45,5')).toEqual({ name: 'масло', priceFils: 4_550 });
    expect(typedPrice('BRAKE PADS -- 1 250 AED')).toEqual({ name: 'BRAKE PADS', priceFils: 125_000 });
  });
  it('keeps a name with a hyphen of its own, and anything that is not a price', () => {
    expect(typedPrice('ENGINE OIL 5W-30 -- 120')).toEqual({ name: 'ENGINE OIL 5W-30', priceFils: 12_000 });
    expect(typedPrice('ENGINE OIL 5W-30')).toEqual({ name: 'ENGINE OIL 5W-30' });
    expect(typedPrice('CLIP -- 2PCS')).toEqual({ name: 'CLIP -- 2PCS' });
    expect(typedPrice('GEAR OIL --')).toEqual({ name: 'GEAR OIL --' });
    expect(typedPrice('-- 450')).toEqual({ name: '-- 450' });
    expect(typedPrice('GEAR OIL -- 0')).toEqual({ name: 'GEAR OIL -- 0' });
  });
});

describe('one «Добавить» for every kind (v0.91.7)', () => {
  const s = (titleEn: string, price = 0, uses = 1): [string, Suggestion] => [titleEn, { titleRu: '', titleEn, price, uses, from: price ? 'any' : 'list' }];
  const sets = {
    part: set(s('FRONT BRAKE PADS', 18000, 5), s('HEADLIGHT LH', 90000, 2), s('HEADLIGHT RH', 90000, 2), s('OIL FILTER', 2500, 9)),
    work: set(s('LABOR CHARGE', 20000, 7), s('WHEEL ALIGNMENT', 12000, 4), s('BRAKE PADS REPLACEMENT', 15000, 3)),
    service: set(s('WHEEL ALIGNMENT', 12000, 4)),
  };

  it('the kind of what is typed: its history first, then its words, then the dictionary; else a part, not sure', () => {
    expect(guessKind('front brake pads', sets)).toEqual({ kind: 'part', sure: true });
    expect(guessKind('WHEEL ALIGNMENT', sets)).toEqual({ kind: 'service', sure: true });
    expect(guessKind('LABOR CHARGE', sets)).toEqual({ kind: 'labor', sure: true });
    expect(guessKind('labour', undefined)).toEqual({ kind: 'labor', sure: true });
    expect(guessKind('AC GAS RECHARGE')).toEqual({ kind: 'service', sure: true });
    expect(guessKind('замена масла')).toEqual({ kind: 'service', sure: true });
    expect(guessKind('CAR WASH')).toEqual({ kind: 'service', sure: true });
    // A washer and a repair kit are parts.
    expect(guessKind('WASHER PUMP', undefined, true)).toEqual({ kind: 'part', sure: true });
    expect(guessKind('CLUTCH REPAIR KIT')).toEqual({ kind: 'part', sure: true });
    // Work words that begin parts' names: not sure — the AI looks.
    expect(guessKind('CHECK VALVE', undefined, true)).toEqual({ kind: 'part', sure: false });
    expect(guessKind('AC CHECK')).toEqual({ kind: 'service', sure: false });
    // Nothing known: a part, not sure.
    expect(guessKind('XYZ 123')).toEqual({ kind: 'part', sure: false });
  });

  it('suggestions of every kind together, each with its kind; a part’s sides together; the spelling put right looked for too', () => {
    // As typed from the start first.
    expect(autoMatches(sets, 'brake')).toEqual([
      { title: 'BRAKE PADS REPLACEMENT', kind: 'service' },
      { title: 'FRONT BRAKE PADS', kind: 'part' },
    ]);
    expect(autoMatches(sets, 'head').map((x) => x.title)).toEqual(['HEADLIGHT LH', 'HEADLIGHT RH']);
    expect(autoMatches(sets, 'labor')).toEqual([{ title: 'LABOR CHARGE', kind: 'labor' }]);
    // Nothing typed: the most used of both.
    expect(autoMatches(sets, '', 3).map((x) => x.title)).toEqual(['OIL FILTER', 'LABOR CHARGE', 'FRONT BRAKE PADS']);
    // «BRAKS» found nothing; «BRAKE» (put right) did.
    expect(autoMatches(sets, 'braks', 8, 'BRAKE').map((x) => x.title)).toContain('FRONT BRAKE PADS');
  });
});
