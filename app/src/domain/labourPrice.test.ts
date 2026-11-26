import { describe, expect, it } from 'vitest';
import { labourGuess, type LabourJob } from './labourPrice';

const job = (p: Partial<LabourJob> & Pick<LabourJob, 'parts' | 'net'>): LabourJob => ({
  orderId: Math.random().toString(36).slice(2),
  vehicleId: 'v-other',
  customerId: 'c-other',
  make: 'Toyota',
  model: 'Corolla',
  at: '2026-10-01',
  ...p,
});
const ctx = { orderId: 'now', vehicleId: 'v1', customerId: 'c1', make: 'Nissan', model: 'Altima' };

describe('labourGuess (v0.90, #70: the labour charge priced by the history)', () => {
  it('the same work before: its labour, from the nearest job, the newest of the circle', () => {
    const past = [
      job({ parts: ['ENGINE MOUNT FULL SET AFTERMARKET'], net: 30_000, gross: 31_500, at: '2026-09-01' }),
      job({ parts: ['ENGINE MOUNT ORIGINAL'], net: 40_000, at: '2026-11-01' }),
      job({ parts: ['Engine mounting'], net: 33_333, make: 'Nissan', model: 'Altima', at: '2026-05-01' }),
    ];
    // «Engine mounting» on the same model is nearer than the newer ones on other cars.
    expect(labourGuess(['ENGINE MOUNT FULL SET ORIGINAL'], past, ctx, 500, true)).toMatchObject({ fils: 33_333, basis: 'same', jobs: 3 });
    // Without it — the newest of «any».
    expect(labourGuess(['ENGINE MOUNT FULL SET ORIGINAL'], past.slice(0, 2), ctx, 500, true)).toEqual({ fils: 40_000, jobs: 2, basis: 'same' });
    // The price as it was typed: with its VAT.
    expect(labourGuess(['ENGINE MOUNT'], [past[0]], ctx, 500, true)).toEqual({ fils: 30_000, gross: 31_500, jobs: 1, basis: 'same' });
  });

  it('else each part’s labour: its share of the jobs it was in, rounded to 5 AED as typed', () => {
    const past = [
      job({ parts: ['FRONT BRAKE PADS'], net: 10_000 }),
      job({ parts: ['FRONT BRAKE PADS'], net: 12_000 }),
      job({ parts: ['FRONT BRAKE PADS'], net: 50_000 }),
      job({ parts: ['RADIATOR', 'RADIATOR HOSE'], net: 40_000 }),
    ];
    // Pads: the middle of 100 · 120 · 500 → 120; radiator: 400 / 2 → 200. 320 net → 336 with VAT → 335.
    const g = labourGuess(['Front brake pads', 'RADIATOR'], past, ctx, 500, true)!;
    expect(g).toMatchObject({ gross: 33_500, basis: 'parts', jobs: 4 });
    expect(g.fils).toBe(31_905);
    // Typed without VAT: the net, rounded.
    expect(labourGuess(['Front brake pads', 'RADIATOR'], past, ctx, 500, false)).toEqual({ fils: 32_000, jobs: 4, basis: 'parts' });
  });

  it('a part never charged for — the garage’s middle, only beside one it knows; nothing known — no price', () => {
    const past = [job({ parts: ['ALTERNATOR'], net: 20_000 }), job({ parts: ['STARTER'], net: 30_000 })];
    expect(labourGuess(['ALTERNATOR', 'WATER PUMP'], past, ctx, 500, false)).toEqual({ fils: 45_000, jobs: 1, basis: 'parts' });
    expect(labourGuess(['WATER PUMP'], past, ctx, 500, false)).toBeUndefined();
    expect(labourGuess([], past, ctx, 500, false)).toBeUndefined();
    expect(labourGuess(['ALTERNATOR'], [], ctx, 500, false)).toBeUndefined();
  });

  it('this job, and jobs without a labour charge or parts, are not its history', () => {
    const past = [job({ orderId: 'now', parts: ['ALTERNATOR'], net: 99_000 }), job({ parts: ['ALTERNATOR'], net: 0 }), job({ parts: [], net: 5_000 })];
    expect(labourGuess(['ALTERNATOR'], past, ctx, 500, false)).toBeUndefined();
  });

  it('front and rear are two parts', () => {
    const past = [job({ parts: ['REAR BRAKE PADS'], net: 9_000 })];
    expect(labourGuess(['FRONT BRAKE PADS'], past, ctx, 500, false)).toBeUndefined();
  });
});

describe('labourGuess — an original and its copy (v0.90, #72)', () => {
  it('are one part: the same work as one engine mount before', () => {
    const past = [job({ parts: ['ENGINE MOUNT'], net: 30_000, gross: 31_500 })];
    expect(labourGuess(['ENGINE MOUNT ORIGINAL', 'ENGINE MOUNT AFTERMARKET'], past, ctx, 500, true)).toEqual({ fils: 30_000, gross: 31_500, jobs: 1, basis: 'same' });
  });
});
