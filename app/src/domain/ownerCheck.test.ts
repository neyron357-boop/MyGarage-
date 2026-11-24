import { describe, expect, it } from 'vitest';
import { ownerCheckOf } from './ownerCheck';
import type { OrderItem } from './types';

const line = (over: Partial<OrderItem>): OrderItem =>
  ({ id: Math.random().toString(36).slice(2), orderId: 'o', kind: 'part', block: 'A', qty: 1, unit: 'pcs', unitPriceFils: 0, vatRateBp: 500, approvalState: 'draft', done: false, createdAt: '2026-11-24T08:00:00.000Z', ...over }) as OrderItem;

const make = (items: OrderItem[], extra: { partsBeyond?: number; expenses?: Parameters<typeof ownerCheckOf>[0]['expenses'] } = {}) =>
  ownerCheckOf({ items, expenses: extra.expenses ?? [], categoryName: () => 'Towing', profit: 0, partsBeyond: extra.partsBeyond ?? 0, docLang: 'en', beyondName: 'Parts — by expenses', vatRateBp: 500 });

describe('the job for the owner to check (v0.82)', () => {
  it('every line bought and sold for — without VAT, its VAT, with it; the job’s VAT laid out; the profit without VAT', () => {
    const c = make([
      // 2 × 100 to the customer (+5 %), bought 2 × 60 (+5 % of the seller).
      line({ titleEn: 'Brake pads', qty: 2, unitPriceFils: 10000, costPriceFils: 6000, supplierId: 's1' }),
      line({ titleEn: 'Labour charge', kind: 'labor', unitPriceFils: 20000 }),
    ]);
    expect(c.parts[0].sale).toEqual({ net: 20000, vat: 1000, gross: 21000 });
    expect(c.parts[0].buy).toEqual({ net: 12000, vat: 600, gross: 12600 });
    expect(c.sale).toEqual({ net: 40000, vat: 2000, gross: 42000 });
    expect(c.buy).toEqual({ net: 12000, vat: 600, gross: 12600 });
    expect(c.vat).toEqual({ out: 2000, in: 600, due: 1400 });
    expect(c.profit.net).toBe(28000);
    expect([c.unpriced, c.noCost, c.askLabour]).toEqual([0, 0, false]);
  });

  it('the sellers each with their lines and what they are paid; a part with no cost or no price — counted, said', () => {
    const c = make([
      line({ titleEn: 'Pads', unitPriceFils: 10000, costPriceFils: 6000, supplierId: 's1' }),
      line({ titleEn: 'Disc', unitPriceFils: 0, supplierId: 's1' }),
      line({ titleEn: 'Filter', unitPriceFils: 3000, costPriceFils: 1000, supplierId: 's2' }),
      line({ titleEn: 'Own part', customerSupplied: true }),
    ]);
    expect(c.sellers.map((s) => [s.supplierId, s.lines.length, s.total])).toEqual([
      ['s1', 2, 6300],
      ['s2', 1, 1050],
    ]);
    expect([c.unpriced, c.noCost]).toEqual([1, 1]);
  });

  it('no labour charge priced — the message asks what to charge; work outside, the job’s discount, other expenses counted', () => {
    const c = make(
      [
        line({ titleEn: 'Pads', unitPriceFils: 10000, costPriceFils: 6000 }),
        line({ titleEn: 'Labour charge', kind: 'labor', unitPriceFils: 0 }),
        line({ titleEn: 'Painting', kind: 'labor', unitPriceFils: 50000, costPriceFils: 30000, outsource: { state: 'todo', supplierId: 'p1' } }),
        line({ titleEn: 'Discount', kind: 'discount', unitPriceFils: 1000 }),
      ],
      { expenses: [{ id: 'e1', amountFils: 5250, vatFils: 250, categoryId: 'tow', vendor: 'Tow truck' }], partsBeyond: 2100 },
    );
    expect(c.askLabour).toBe(true);
    expect(c.work[1].outside).toBe(true);
    expect(c.work[1].buy).toEqual({ net: 30000, vat: 0, gross: 30000 });
    expect(c.discount.gross).toBe(-1050);
    expect(c.extra.map((x) => [x.name, x.buy.gross, x.buy.vat])).toEqual([
      ['Parts — by expenses', 2100, 100],
      ['Towing · Tow truck', 5250, 250],
    ]);
    expect(c.sale.gross).toBe(10500 + 52500 - 1050);
    expect(c.sellers.map((s) => s.supplierId)).toEqual(['p1']);
  });
});
