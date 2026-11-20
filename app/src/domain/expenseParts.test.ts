import { describe, expect, it } from 'vitest';
import { partRows, partsFit, partsOf, partsRest, restWay, shareVat } from './expenseParts';

describe('an expense paid in parts (v0.58)', () => {
  it('the rest goes on credit when it is one of the ways, else to the last; it is the last row', () => {
    expect(restWay(['credit', 'cash'])).toBe('credit');
    expect(restWay(['card', 'cash'])).toBe('card');
    expect(restWay(['outside', 'cash', 'transfer'])).toBe('outside');
    expect(partRows(['credit', 'card', 'cash'])).toEqual(['cash', 'card', 'credit']);
    expect(partRows(['transfer', 'cash'])).toEqual(['cash', 'transfer']);
  });

  it('the parts: the sums typed, the rest what is left; nothing while a sum is missing or nothing is left', () => {
    // The user's case: 150, 100 of it in cash — 50 stays on credit.
    expect(partsOf(15_000, ['cash', 'credit'], { cash: 10_000 })).toEqual([
      { method: 'cash', amountFils: 10_000 },
      { method: 'credit', amountFils: 5_000 },
    ]);
    expect(partsOf(15_000, ['card', 'cash', 'credit'], { cash: 10_000, card: 2_000 })).toEqual([
      { method: 'cash', amountFils: 10_000 },
      { method: 'card', amountFils: 2_000 },
      { method: 'credit', amountFils: 3_000 },
    ]);
    expect(partsOf(15_000, ['cash', 'credit'], {})).toBeUndefined();
    expect(partsOf(15_000, ['cash', 'credit'], { cash: 15_000 })).toBeUndefined();
    expect(partsOf(15_000, ['cash', 'credit'], { cash: 16_000 })).toBeUndefined();
    expect(partsOf(undefined, ['cash', 'credit'], { cash: 1 })).toBeUndefined();
    expect(partsOf(15_000, ['cash'], { cash: 1 })).toBeUndefined();
    expect(partsRest(15_000, ['cash', 'credit'], { cash: 16_000 })).toBe(-1_000);
  });

  it('parts fit: two ways or more, each once and above zero, adding up to the whole', () => {
    expect(partsFit(150, [{ method: 'cash', amountFils: 100 }, { method: 'credit', amountFils: 50 }])).toBe(true);
    expect(partsFit(150, [{ method: 'cash', amountFils: 100 }, { method: 'credit', amountFils: 40 }])).toBe(false);
    expect(partsFit(150, [{ method: 'cash', amountFils: 100 }, { method: 'cash', amountFils: 50 }])).toBe(false);
    expect(partsFit(150, [{ method: 'cash', amountFils: 150 }, { method: 'credit', amountFils: 0 }])).toBe(false);
    expect(partsFit(150, [{ method: 'cash', amountFils: 150 }])).toBe(false);
  });

  it('the VAT shared by the sums, to the fils, adding up to the receipt’s', () => {
    expect(shareVat(714, [{ method: 'cash', amountFils: 10_000 }, { method: 'credit', amountFils: 5_000 }])).toEqual([476, 238]);
    expect(shareVat(100, [{ method: 'cash', amountFils: 1 }, { method: 'card', amountFils: 1 }, { method: 'credit', amountFils: 1 }])).toEqual([34, 33, 33]);
    expect(shareVat(0, [{ method: 'cash', amountFils: 100 }, { method: 'credit', amountFils: 50 }])).toEqual([0, 0]);
    const shares = shareVat(1_001, [{ method: 'cash', amountFils: 3_333 }, { method: 'card', amountFils: 3_333 }, { method: 'credit', amountFils: 3_334 }]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(1_001);
  });
});
