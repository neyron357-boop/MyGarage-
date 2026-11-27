import { describe, expect, it } from 'vitest';
import { bestOffer, buyable, supplierOrderText } from './supplierOrder';

describe('the order to a supplier (audit 27/11)', () => {
  it('the car, each part as offered with its price, when it is collected — in English', () => {
    const text = supplierOrderText({ title: 'Toyota Camry 2018', vin: 'JTNB11HK103456789' }, [
      { name: 'FRONT BRAKE PADS', qty: 1, kind: 'oem', costFils: 18000 },
      { name: 'OIL FILTER', qty: 2, kind: 'aftermarket', brand: 'TRW' },
    ], { by: 'pickup', at: 'today at 16:00' });
    expect(text).toBe('*Toyota Camry 2018* · VIN JTNB11HK103456789\n\nPlease keep for us:\n1. FRONT BRAKE PADS (original) — 180.00 AED\n2. OIL FILTER (copy TRW) × 2\n\nWe will collect today at 16:00.\nThank you!');
    expect(supplierOrderText({ title: 'Nissan Patrol' }, [{ name: 'BATTERY', qty: 1 }], { by: 'deliver' })).toContain('Please deliver to the garage.');
  });
});

describe('what to buy and the offer picked first', () => {
  const offers = [
    { id: 'a', kind: 'oem' as const, costFils: 18000, supplierId: 's1' },
    { id: 'b', kind: 'aftermarket' as const, costFils: 9500, supplierId: 's2' },
    { id: 'c', kind: 'oem' as const, supplierId: 's3', na: true as const },
  ];
  it('a part not bought yet, with an offer from a supplier', () => {
    expect(buyable({ kind: 'part', approvalState: 'approved', offers })).toBe(true);
    expect(buyable({ kind: 'part', approvalState: 'approved', procurementStatus: 'ordered', offers })).toBe(false);
    expect(buyable({ kind: 'part', approvalState: 'declined', offers })).toBe(false);
    expect(buyable({ kind: 'labor', approvalState: 'approved', offers })).toBe(false);
    expect(buyable({ kind: 'part', approvalState: 'approved', offers: [offers[2]] })).toBe(false);
  });
  it('the line’s own offer first, else the cheapest', () => {
    expect(bestOffer({ offers, supplierId: 's1', costPriceFils: 18000 })?.id).toBe('a');
    expect(bestOffer({ offers })?.id).toBe('b');
    expect(bestOffer({ offers: [offers[2]] })).toBeUndefined();
  });
});
