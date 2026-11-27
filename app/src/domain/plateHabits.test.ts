import { describe, expect, it } from 'vitest';
import { plateHabitsOf } from './plateHabits';

describe('plateHabitsOf', () => {
  it('takes the emirate most cars come from, Dubai with nothing', () => {
    expect(plateHabitsOf([]).emirate).toBe('DXB');
    expect(plateHabitsOf([{ emirate: 'SHJ', code: '3' }, { emirate: 'SHJ', code: '1' }, { emirate: 'DXB', code: 'A' }]).emirate).toBe('SHJ');
    // A tie stays with Dubai.
    expect(plateHabitsOf([{ emirate: 'SHJ', code: '3' }, { emirate: 'DXB', code: 'A' }]).emirate).toBe('DXB');
  });

  it('lists an emirate’s codes from the most frequent, case and spaces aside', () => {
    const h = plateHabitsOf([
      { emirate: 'DXB', code: 'b' },
      { emirate: 'DXB', code: 'A' },
      { emirate: 'DXB', code: ' a' },
      { emirate: 'DXB', code: '' },
      { emirate: 'AUH', code: '1' },
    ]);
    expect(h.codes.DXB).toEqual(['A', 'B']);
    expect(h.codes.AUH).toEqual(['1']);
    expect(h.codes.SHJ).toBeUndefined();
  });

  it('keeps only the first few codes', () => {
    const plates = 'ABCDEFGH'.split('').map((code) => ({ emirate: 'DXB' as const, code }));
    expect(plateHabitsOf(plates, 3).codes.DXB).toHaveLength(3);
  });
});
