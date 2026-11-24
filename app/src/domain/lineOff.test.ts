import { describe, expect, it } from 'vitest';
import { spreadDiscount } from './discount';
import { invoiceLines, invoiceTotals } from './invoice';
import { amountsBeforeOff, itemAmounts, itemOff, summarize, unitGross } from './items';
import type { OrderItem } from './types';

const line = (over: Partial<OrderItem> = {}): OrderItem =>
  ({ id: 'i1', orderId: 'o', kind: 'part', block: 'A', titleEn: 'BRAKE PADS', qty: 2, unit: 'pcs', unitPriceFils: 10000, vatRateBp: 500, approvalState: 'approved', done: false, createdAt: '2026-11-24T08:00:00.000Z', ...over }) as OrderItem;

describe('a line’s own discount (v0.82: «скидки не общую, а в отдельности на каждую позицию»)', () => {
  it('a percentage off its total with VAT; an amount off it; the VAT taken out of what is left', () => {
    // 2 × 100 + 5 % = 210.00; −10 % → 189.00 (180.00 + 9.00).
    expect(itemAmounts(line({ lineOff: { pctBp: 1000 } }))).toEqual({ net: 18000, vat: 900, gross: 18900 });
    expect(itemOff(line({ lineOff: { pctBp: 1000 } }))).toBe(2000);
    // −50 AED → 160.00 with VAT.
    const a = itemAmounts(line({ lineOff: { grossFils: 5000 } }));
    expect([a.gross, a.net + a.vat]).toEqual([16000, 16000]);
    // A price typed with VAT keeps its total to the fils.
    expect(itemAmounts(line({ qty: 1, unitPriceFils: 9524, unitGrossFils: 10000, lineOff: { pctBp: 1500 } })).gross).toBe(8500);
    // A line without VAT: no VAT after either.
    expect(itemAmounts(line({ vatRateBp: 0, lineOff: { grossFils: 2000 } }))).toEqual({ net: 18000, vat: 0, gross: 18000 });
    // Never below nothing; nothing off a customer's own part or a discount line.
    expect(itemAmounts(line({ lineOff: { grossFils: 99999 } })).gross).toBe(0);
    expect(itemAmounts(line({ customerSupplied: true, lineOff: { pctBp: 1000 } })).gross).toBe(0);
    expect(itemAmounts(line({ kind: 'discount', unitPriceFils: 1000, qty: 1, lineOff: { pctBp: 5000 } })).gross).toBe(-1050);
    // The unit price shown is before it («2 × 105,00»).
    expect([unitGross(line({ lineOff: { pctBp: 1000 } })), amountsBeforeOff(line({ lineOff: { pctBp: 1000 } })).gross]).toEqual([10500, 21000]);
  });

  it('the job’s totals and the invoice follow it; the invoice keeps it apart for its Discount column', () => {
    const items = [line({ lineOff: { pctBp: 1000 } }), line({ id: 'i2', titleEn: 'LABOUR', kind: 'labor', qty: 1, unitPriceFils: 20000 })];
    expect(summarize(items).approvedGross).toBe(18900 + 21000);
    const lines = invoiceLines(items, 'en');
    expect(lines.map((l) => [l.net, l.discountFils])).toEqual([
      [18000, 2000],
      [20000, undefined],
    ]);
    expect(invoiceTotals(lines)).toEqual({ subtotalFils: 38000, vatFils: 1900, totalFils: 39900 });
  });

  it('in the documents: the line’s Discount column holds its own discount and its share of the job’s; price × qty − discount + VAT = total', () => {
    const items = [line({ lineOff: { pctBp: 1000 } }), line({ id: 'i2', titleEn: 'LABOUR', kind: 'labor', qty: 1, unitPriceFils: 20000 })];
    const own = invoiceLines(items, 'en');
    // The job's discount of 21.00 on top (gross), spread over both lines.
    const all = [...own, { description: 'Discount', kind: 'discount' as const, qty: 1, unit: 'pcs' as const, unitPriceFils: -2000, net: -2000, vatRateBp: 500, vat: -100, gross: -2100 }];
    const s = spreadDiscount(all);
    for (const r of s.lines) expect(r.line.unitPriceFils * r.line.qty - r.discount + r.vat).toBe(r.gross);
    expect(s.lines[0].discount).toBeGreaterThan(2000);
    expect(s.lines.reduce((a, r) => a + r.gross, 0)).toBe(39900 - 2100);
    // Without the job's discount: the column is the line's own.
    expect(spreadDiscount(own).lines.map((r) => r.discount)).toEqual([2000, 0]);
  });
});
