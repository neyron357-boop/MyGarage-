import { describe, expect, it } from 'vitest';
import { bookMakes, groupPrices, pointsOf, priceHints } from './priceBook';
import type { OrderItem, PricePoint } from './types';

const NOW = '2026-11-27T08:00:00.000Z';
const item = (over: Partial<OrderItem> = {}): OrderItem =>
  ({ id: 'i1', orderId: 'o1', kind: 'part', block: 'A', qty: 1, unit: 'pcs', unitPriceFils: 0, vatRateBp: 500, done: false, approvalState: 'draft', titleEn: 'FRONT BRAKE PADS', createdAt: NOW, updatedAt: NOW, ...over }) as OrderItem;
const pt = (over: Partial<PricePoint>): PricePoint => ({ id: Math.random().toString(36).slice(2), part: 'FRONT BRAKE PADS', kind: 'oem', via: 'wa', at: NOW, orderId: 'o1', itemId: 'i1', updatedAt: NOW, supplierId: 's1', costFils: 18000, ...over });

describe('the price book (v0.91.7)', () => {
  it('a line’s offers become records with its car; the moment of the answer; none without a supplier; work — none', () => {
    const it1 = item({
      offers: [
        { id: 'wa:x:0:0', kind: 'oem', costFils: 18000, supplierId: 's1', msg: 'M1' },
        { id: 'wa:x:0:1', kind: 'aftermarket', costFils: 9500, supplierId: 's1', msg: 'M1', brand: 'TRW', ai: true },
        { id: 'wa:y:0:0', kind: 'oem', supplierId: 's2', msg: 'M2', na: true },
        { id: 'h1', kind: 'oem', costFils: 20000 },
      ],
    });
    const order = { id: 'o1', asks: [{ id: 'a', supplierId: 's1', phone: '9715', at: NOW, items: ['i1'], text: '', via: 'server' as const, replies: [{ id: 'M1', at: '2026-11-26T10:00:00.000Z', text: '', lines: 1 }] }] };
    const out = pointsOf(it1, order, { make: 'Toyota', model: 'Camry', year: 2018, vin: 'JTNB11HK103456789' }, NOW);
    expect(out.map((p) => [p.id, p.costFils, p.kind, p.brand, p.na, p.ai, p.at, p.make, p.model, p.vin])).toEqual([
      ['wa:x:0:0', 18000, 'oem', undefined, undefined, undefined, '2026-11-26T10:00:00.000Z', 'Toyota', 'Camry', 'JTNB11HK103456789'],
      ['wa:x:0:1', 9500, 'aftermarket', 'TRW', undefined, true, '2026-11-26T10:00:00.000Z', 'Toyota', 'Camry', 'JTNB11HK103456789'],
      ['wa:y:0:0', undefined, 'oem', undefined, true, undefined, NOW, 'Toyota', 'Camry', 'JTNB11HK103456789'],
    ]);
    expect(pointsOf(item({ kind: 'labor', offers: [{ id: 'z', kind: 'oem', costFils: 1, supplierId: 's1' }] }), undefined, undefined, NOW)).toEqual([]);
  });

  it('by part, the most recent first; the lowest price the best; a make, a model, a VIN, a brand found', () => {
    const list = [
      pt({ part: 'FRONT BRAKE PADS', make: 'Toyota', model: 'Camry', costFils: 18000, at: '2026-11-20T00:00:00Z' }),
      pt({ part: 'FRONT BRAKE PADS', make: 'Toyota', model: 'Camry', costFils: 9500, kind: 'aftermarket', brand: 'TRW', supplierId: 's2', at: '2026-11-21T00:00:00Z' }),
      pt({ part: 'OIL FILTER', make: 'Nissan', model: 'Patrol', costFils: 2500, at: '2026-11-25T00:00:00Z' }),
      pt({ part: 'OIL FILTER', make: 'Nissan', na: true, costFils: undefined, at: '2026-11-26T00:00:00Z' }),
    ];
    const g = groupPrices(list);
    expect(g.map((x) => [x.part, x.points.length, x.best?.costFils, x.suppliers, x.makes])).toEqual([
      ['OIL FILTER', 2, 2500, 1, ['Nissan']],
      ['FRONT BRAKE PADS', 2, 9500, 2, ['Toyota']],
    ]);
    expect(groupPrices(list, { query: 'trw' }).map((x) => x.part)).toEqual(['FRONT BRAKE PADS']);
    expect(groupPrices(list, { query: 'patrol' }).map((x) => x.part)).toEqual(['OIL FILTER']);
    expect(groupPrices(list, { make: 'Toyota' }).map((x) => x.part)).toEqual(['FRONT BRAKE PADS']);
    expect(bookMakes(list)).toEqual([
      { make: 'Nissan', n: 2 },
      { make: 'Toyota', n: 2 },
    ]);
  });

  it('the prices for a line: the same part — this car, the model, the make first; another make’s left out; one per supplier and kind', () => {
    const list = [
      pt({ id: 'a', make: 'Toyota', model: 'Corolla', costFils: 15000, at: '2026-11-25T00:00:00Z' }),
      pt({ id: 'b', make: 'Toyota', model: 'Camry', costFils: 18000, at: '2026-11-20T00:00:00Z' }),
      pt({ id: 'c', make: 'Toyota', model: 'Camry', costFils: 17000, at: '2026-11-22T00:00:00Z' }),
      pt({ id: 'd', make: 'Nissan', model: 'Sunny', costFils: 9000, supplierId: 's3' }),
      pt({ id: 'e', part: 'BRAKE PADS FRONT', make: 'Toyota', model: 'Camry', costFils: 9500, kind: 'aftermarket', supplierId: 's2' }),
      pt({ id: 'f', part: 'OIL FILTER', make: 'Toyota', model: 'Camry', costFils: 2500 }),
    ];
    const h = priceHints(list, { part: 'FRONT BRAKE PADS', make: 'Toyota', model: 'Camry' });
    // The Camry's first (the newest of s1 oem; s2's copy), then the Corolla's (the same make) — s1's oem only once.
    expect(h.map((x) => [x.point.id, x.near])).toEqual([
      ['e', 2],
      ['c', 2],
    ]);
    expect(priceHints(list, { part: 'FRONT BRAKE PADS' }).length).toBeGreaterThan(0);
  });
});
