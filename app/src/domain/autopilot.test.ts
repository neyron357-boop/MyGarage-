import { describe, expect, it } from 'vitest';
import { autopilotStep, partsToPrice } from './autopilot';
import type { OrderItem } from './types';

const line = (over: Partial<OrderItem>): OrderItem => ({ id: 'i' + Math.random().toString(36).slice(2), orderId: 'o', kind: 'part', approvalState: 'draft', qty: 1, block: 'A', unitPriceFils: 0, vatRateBp: 500, ...over }) as OrderItem;

describe('a request’s autopilot — the step it is on', () => {
  it('parts without a price, nobody asked — «ask»; asked — «wait»; priced, the labour unknown — «left»; all priced — «quote»', () => {
    const pads = line({ titleEn: 'FRONT BRAKE PADS' });
    const labour = line({ kind: 'labor', titleEn: 'LABOUR CHARGES', autoLabour: true });
    expect(autopilotStep([pads, labour])).toBe('ask');
    expect(partsToPrice([pads, labour]).map((i) => i.titleEn)).toEqual(['FRONT BRAKE PADS']);
    expect(autopilotStep([pads, labour], [{ items: [pads.id], at: '2026-11-27T10:00:00Z' }])).toBe('wait');
    const priced = { ...pads, costPriceFils: 18_000, unitPriceFils: 24_000 };
    expect(autopilotStep([priced, labour], [{ items: [pads.id], at: '2026-11-27T10:00:00Z' }])).toBe('left');
    expect(autopilotStep([priced, { ...labour, unitPriceFils: 10_000 }])).toBe('quote');
    // A supplier's offer with a price counts as priced (its line's cost is set by it, or by hand).
    expect(partsToPrice([line({ offers: [{ id: 'x', kind: 'oem', costFils: 9000, supplierId: 's' }] })])).toEqual([]);
  });

  it('sent to the customer, nothing on it, the customer’s own part — none of the autopilot’s', () => {
    expect(autopilotStep([])).toBe('none');
    expect(autopilotStep([line({ approvalState: 'pending', unitPriceFils: 5000 })])).toBe('none');
    const own = line({ customerSupplied: true, titleEn: 'BATTERY' });
    expect(partsToPrice([own])).toEqual([]);
    expect(autopilotStep([own, line({ kind: 'labor', unitPriceFils: 5000 })])).toBe('quote');
  });
});
