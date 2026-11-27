import { describe, expect, it } from 'vitest';
import { kmPerDay, serviceForecast } from './serviceDue';

const at = (d: string) => `${d}T08:00:00.000Z`;

describe('the next oil service by the mileage', () => {
  it('the pace: the earliest and the latest visit a month or more apart', () => {
    expect(kmPerDay([{ at: at('2026-01-01'), km: 50_000 }, { at: at('2026-03-02'), km: 56_000 }])).toBeCloseTo(100, 0);
    // Too close in time, the mileage not grown, a wrong reading — no pace.
    expect(kmPerDay([{ at: at('2026-03-01'), km: 50_000 }, { at: at('2026-03-20'), km: 51_000 }])).toBeUndefined();
    expect(kmPerDay([{ at: at('2026-01-01'), km: 50_000 }, { at: at('2026-04-01'), km: 50_000 }])).toBeUndefined();
    expect(kmPerDay([{ at: at('2026-01-01'), km: 50_000 }, { at: at('2026-03-01'), km: 950_000 }])).toBeUndefined();
    expect(kmPerDay([{ at: at('2026-01-01'), km: 50_000 }])).toBeUndefined();
    // Older than two years before the latest — not read.
    expect(kmPerDay([{ at: at('2021-01-01'), km: 10_000 }, { at: at('2026-01-01'), km: 20_000 }])).toBeUndefined();
  });

  it('a taxi (250 km a day) — in 40 days; a car of 20 km a day — the half-year rule stays', () => {
    const taxi = serviceForecast([{ at: at('2026-06-01'), km: 100_000 }, { at: at('2026-10-01'), km: 130_500 }], { at: at('2026-10-01'), km: 130_500 }, at('2026-11-15'))!;
    expect(taxi.dueAt.slice(0, 10)).toBe('2026-11-10');
    expect(taxi.nowKm).toBe(142_000); // 130 500 + 45 days × 250, to 500
    expect(taxi.atKm).toBe(130_500);
    const slow = serviceForecast([{ at: at('2026-01-01'), km: 40_000 }, { at: at('2026-05-01'), km: 42_400 }], { at: at('2026-05-01'), km: 42_400 }, at('2026-06-01'))!;
    // 10 000 km at 20 a day — 500 days: later than half a year (domain/today.ts takes the earlier of the two).
    expect(slow.dueAt > at('2027-01-01')).toBe(true);
  });

  it('never sooner than a month after the service; no mileage at the service — nothing', () => {
    const fast = serviceForecast([{ at: at('2026-01-01'), km: 10_000 }, { at: at('2026-03-01'), km: 50_000 }], { at: at('2026-03-01'), km: 50_000 }, at('2026-03-10'))!;
    expect(fast.dueAt.slice(0, 10)).toBe('2026-03-31');
    expect(serviceForecast([{ at: at('2026-01-01'), km: 10_000 }, { at: at('2026-03-01'), km: 20_000 }], { at: at('2026-03-01') }, at('2026-03-10'))).toBeUndefined();
  });
});
