import { describe, expect, it } from 'vitest';
import { boardStatusOf } from './boardStatus';

describe('the board’s tab of a job (v0.70)', () => {
  it('where the manager put it, whatever its step', () => {
    expect(boardStatusOf({ boardTab: 'wait' }, 'work')).toBe('wait');
    expect(boardStatusOf({ boardTab: 'request' }, 'price')).toBe('request');
  });
  it('else by its step: booked — a request, waiting for the answer — waiting, the rest — in work', () => {
    expect(boardStatusOf({}, 'booked')).toBe('request');
    expect(boardStatusOf({}, 'wait')).toBe('wait');
    for (const p of ['look', 'price', 'work', 'pay', 'out'] as const) expect(boardStatusOf({}, p)).toBe('work');
  });
});
