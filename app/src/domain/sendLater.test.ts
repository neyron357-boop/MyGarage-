import { describe, expect, it } from 'vitest';
import { laterAt, laterChoices, laterStart } from './sendLater';

const at = (s: string) => Date.parse(s);

describe('send later (v0.91.7, #76)', () => {
  it('the moments offered: in 30 min, an hour, two; this evening while ahead; tomorrow morning — in Dubai', () => {
    // 10:00 in Dubai.
    const now = at('2026-11-27T06:00:00Z');
    const c = laterChoices(now);
    expect(c.map((x) => x.key)).toEqual(['in30', 'in60', 'in120', 'evening', 'morning']);
    expect(new Date(c[3].at).toISOString()).toBe('2026-11-27T14:00:00.000Z');
    expect(new Date(c[4].at).toISOString()).toBe('2026-11-28T05:00:00.000Z');
    // 17:45 in Dubai: 18:00 is too close — not offered.
    expect(laterChoices(at('2026-11-27T13:45:00Z')).map((x) => x.key)).toEqual(['in30', 'in60', 'in120', 'morning']);
    // 23:30 in Dubai (the next day in Dubai is still «tomorrow» from its own date).
    const late = laterChoices(at('2026-11-27T19:30:00Z'));
    expect(new Date(late.at(-1)!.at).toISOString()).toBe('2026-11-28T05:00:00.000Z');
  });

  it('a time typed for today or tomorrow; past or not a time — none', () => {
    const now = at('2026-11-27T06:00:00Z');
    expect(new Date(laterAt('today', '14:30', now)!).toISOString()).toBe('2026-11-27T10:30:00.000Z');
    expect(new Date(laterAt('tomorrow', '8:05', now)!).toISOString()).toBe('2026-11-28T04:05:00.000Z');
    expect(laterAt('today', '09:00', now)).toBeUndefined();
    expect(laterAt('today', '25:00', now)).toBeUndefined();
    expect(laterAt('today', 'soon', now)).toBeUndefined();
  });

  it('the field starts an hour ahead, on a quarter, in Dubai', () => {
    expect(laterStart(at('2026-11-27T06:07:00Z'))).toBe('11:15');
    expect(laterStart(at('2026-11-27T06:00:00Z'))).toBe('11:00');
  });
});
