import { describe, expect, it } from 'vitest';
import { labourName, labourRenames, labourWords, partNames, plainLabour, typedOwnName } from './labourName';
import type { OrderItem } from './types';

/* The labour charge named by the job's parts (v0.80): «LABOR CHARGE: GEAR FILTER, TRANSMISSION COOLER». */

let n = 0;
const line = (over: Partial<OrderItem>): OrderItem => ({ id: `i${++n}`, orderId: 'o1', kind: 'part', block: 'A', qty: 1, unit: 'pcs', unitPriceFils: 0, vatRateBp: 500, approvalState: 'draft', done: false, createdAt: `2026-11-24T10:00:${String(n).padStart(2, '0')}.000Z`, ...over }) as OrderItem;

describe('labourName', () => {
  it('plain labour words — and only they — are named by the parts', () => {
    for (const t of ['LABOR CHARGE', 'Labour charges', 'LABOUR', 'LABOR CHARGE: GEAR FILTER', 'Оплата труда', 'WORKMANSHIP']) expect(plainLabour(t)).toBe(true);
    for (const t of ['LABOUR FOR ENGINE OVERHAUL', 'ENGINE OVERHAUL', 'ALIGNMENT', 'LABOR CHARGE FOR BRAKES']) expect(plainLabour(t)).toBe(false);
    expect(labourWords('LABOR CHARGE: GEAR FILTER, OIL SEAL')).toBe('LABOR CHARGE');
  });

  it('the parts in the lines’ order, each once, not the refused or taken-back ones', () => {
    const items = [
      line({ titleEn: 'TRANSMISSION COOLER', position: 1 }),
      line({ titleEn: 'GEAR FILTER', position: 0 }),
      line({ titleEn: 'GEAR FILTER', position: 2 }),
      line({ titleEn: 'OLD PART', approvalState: 'declined' }),
      line({ kind: 'labor', titleEn: 'LABOR CHARGE' }),
      line({ titleRu: 'ФИЛЬТР КПП' }),
    ];
    expect(partNames(items, 'en')).toEqual(['GEAR FILTER', 'TRANSMISSION COOLER', 'ФИЛЬТР КПП']);
    expect(labourName('LABOR CHARGE', partNames(items, 'en'))).toBe('LABOR CHARGE: GEAR FILTER, TRANSMISSION COOLER, ФИЛЬТР КПП');
    expect(labourName('LABOR CHARGE: OLD', [])).toBe('LABOR CHARGE');
  });

  it('what changes: a draft labour charge; not one told to the customer, done outside, or named by hand', () => {
    const parts = [line({ titleEn: 'GEAR FILTER', position: 0 }), line({ titleEn: 'TRANSMISSION COOLER', position: 1 })];
    const draft = line({ kind: 'labor', titleEn: 'LABOR CHARGE' });
    const told = line({ kind: 'labor', titleEn: 'LABOUR CHARGES', approvalState: 'pending' });
    const outside = line({ kind: 'labor', titleEn: 'LABOR', outsource: { supplierId: 's1' } as OrderItem['outsource'] });
    const own = line({ kind: 'labor', titleEn: 'LABOR CHARGE: SPECIAL', ownName: true });
    const both = line({ kind: 'labor', titleEn: 'LABOUR', titleRu: 'ОПЛАТА ТРУДА' });
    const out = labourRenames([...parts, draft, told, outside, own, both]);
    expect(out).toEqual([
      { id: draft.id, patch: { titleEn: 'LABOR CHARGE: GEAR FILTER, TRANSMISSION COOLER' } },
      { id: both.id, patch: { titleEn: 'LABOUR: GEAR FILTER, TRANSMISSION COOLER', titleRu: 'ОПЛАТА ТРУДА: GEAR FILTER, TRANSMISSION COOLER' } },
    ]);
    // Already said so — nothing to change.
    expect(labourRenames([...parts, { ...draft, titleEn: 'LABOR CHARGE: GEAR FILTER, TRANSMISSION COOLER' }])).toEqual([]);
  });

  it('a name typed by hand stays; plain words again — or what the parts say — are the parts’ again', () => {
    const parts = [line({ titleEn: 'GEAR FILTER' })];
    const labour = line({ kind: 'labor', titleEn: 'LABOR CHARGE: GEAR FILTER' });
    expect(typedOwnName(labour, { titleEn: 'LABOR CHARGE: GEAR FILTER AND FLUSH' }, [...parts, labour])).toBe(true);
    expect(typedOwnName(labour, { titleEn: 'LABOR CHARGE' }, [...parts, labour])).toBeUndefined();
    expect(typedOwnName(labour, { titleEn: 'LABOR CHARGE: GEAR FILTER' }, [...parts, labour])).toBeUndefined();
    expect(typedOwnName(labour, { titleEn: 'ENGINE OVERHAUL' }, [...parts, labour])).toBeUndefined();
    expect(typedOwnName(parts[0], { titleEn: 'OIL FILTER' }, parts)).toBeUndefined();
  });
});
