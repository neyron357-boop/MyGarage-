import { describe, expect, it } from 'vitest';
import { expiryState, mulkiyaExpiry } from './mulkiya';

const TODAY = '2026-11-27';

describe('the Mulkiya’s expiry off its front', () => {
  it('the day after «Exp. Date» — not the insurance’s, not the registration’s', () => {
    const text = ['UNITED ARAB EMIRATES', 'Traffic Plate No. Q 12345  Place of Issue DUBAI', 'Owner JOHN SAMPLE', 'Exp. Date 14/03/2027   Reg. Date 15/03/2019', 'Ins. Exp. 13/03/2027  Policy No. 00123'].join('\n');
    expect(mulkiyaExpiry(text, TODAY)).toEqual({ date: '2027-03-14', sure: true });
  });

  it('labels the reader missed: the one day ahead (or the earlier of two close ones), unsure', () => {
    expect(mulkiyaExpiry('Owner X\n14/03/2027   15/03/2019\n', TODAY)).toEqual({ date: '2027-03-14', sure: false });
    expect(mulkiyaExpiry('14-03-2027\n10.03.2027\n', TODAY)).toEqual({ date: '2027-03-10', sure: false });
    // Two days far apart, none labelled — not guessed.
    expect(mulkiyaExpiry('14/03/2027\n20/09/2027', TODAY)).toBeUndefined();
  });

  it('nothing: no day, a day that does not exist, too far, the registration’s only', () => {
    expect(mulkiyaExpiry('Owner JOHN SAMPLE', TODAY)).toBeUndefined();
    expect(mulkiyaExpiry('Exp. Date 31/02/2027', TODAY)).toBeUndefined();
    expect(mulkiyaExpiry('Exp. Date 14/03/2035', TODAY)).toBeUndefined();
    expect(mulkiyaExpiry('Reg. Date 15/03/2019', TODAY)).toBeUndefined();
  });

  it('how it stands for a reminder', () => {
    expect(expiryState('2026-11-20', TODAY)).toBe('past');
    expect(expiryState('2026-12-20', TODAY)).toBe('soon');
    expect(expiryState('2027-03-14', TODAY)).toBe('later');
    expect(expiryState(undefined, TODAY)).toBeUndefined();
  });
});
