import { describe, expect, it } from 'vitest';
import { buildSuggestions, isLabourCharge, type HistJob, type HistLine } from './linePrices';

const jobs = new Map<string, HistJob>([
  ['thisCar', { vehicleId: 'v1', customerId: 'c1', make: 'Toyota', model: 'HiLux' }],
  ['otherCarSameCustomer', { vehicleId: 'v2', customerId: 'c1', make: 'Nissan', model: 'Patrol' }],
  ['sameModel', { vehicleId: 'v3', customerId: 'c9', make: 'TOYOTA', model: 'Hilux' }],
  ['sameMake', { vehicleId: 'v4', customerId: 'c8', make: 'Toyota', model: 'Corolla' }],
  ['any', { vehicleId: 'v5', customerId: 'c7', make: 'Kia', model: 'Rio', complaint: 'brake noise front' }],
  ['now', { vehicleId: 'v1', customerId: 'c1', make: 'Toyota', model: 'HiLux' }],
]);
const line = (orderId: string, titleEn: string, price: number, createdAt: string, extra: Partial<HistLine> = {}): HistLine => ({ orderId, kind: 'labor', titleEn, unitPriceFils: price, approvalState: 'approved', createdAt, ...extra });
const ctx = { lang: 'en' as const, orderId: 'now', vehicleId: 'v1', customerId: 'c1', make: 'Toyota', model: 'HILUX' };

describe('the price a line is offered at', () => {
  // Newest first, as the sheet reads them.
  const lines = [
    line('any', 'Change oil', 15_000, '2026-11-20'),
    line('sameMake', 'Change oil', 17_000, '2026-11-10'),
    line('sameModel', 'Change oil', 19_000, '2026-10-01'),
    line('otherCarSameCustomer', 'Change oil', 20_000, '2026-09-01'),
    line('thisCar', 'Change oil', 21_000, '2026-08-01'),
    line('thisCar', 'Change oil', 18_000, '2026-02-01'),
  ];
  it('is this car’s last price, however old, before any other job’s newer one', () => {
    const s = buildSuggestions(lines, jobs, [], ctx).service.list.get('CHANGE OIL')!;
    expect([s.price, s.from, s.at]).toEqual([21_000, 'car', '2026-08-01']);
  });
  it('then the customer’s other car, then the same model, the same make, any job', () => {
    const drop = (n: number) => lines.slice(0, lines.length - n);
    const at = (l: HistLine[]) => buildSuggestions(l, jobs, [], ctx).work.list.get('CHANGE OIL')!;
    expect([at(drop(2)).price, at(drop(2)).from]).toEqual([20_000, 'customer']);
    expect([at(drop(3)).price, at(drop(3)).from]).toEqual([19_000, 'model']);
    expect([at(drop(4)).price, at(drop(4)).from]).toEqual([17_000, 'make']);
    expect([at(drop(5)).price, at(drop(5)).from]).toEqual([15_000, 'any']);
  });
  it('leaves out this job’s own lines, declined and cancelled ones, lines without a price', () => {
    const s = buildSuggestions(
      [line('now', 'Wash', 9_000, '2026-11-22'), line('thisCar', 'Wash', 8_000, '2026-11-01', { approvalState: 'declined' }), line('thisCar', 'Wash', 0, '2026-10-01'), line('any', 'Wash', 5_000, '2026-01-01')],
      jobs,
      [],
      ctx,
    ).service.list.get('WASH')!;
    expect([s.price, s.from]).toEqual([5_000, 'any']);
  });
  it('keeps how it was typed: VAT inside, its rate', () => {
    const s = buildSuggestions([line('thisCar', 'Wash', 9_524, '2026-11-01', { unitGrossFils: 10_000, vatRateBp: 500 })], jobs, [], ctx).service.list.get('WASH')!;
    expect([s.price, s.gross, s.rate]).toEqual([9_524, 10_000, 500]);
  });
  it('takes the price list only for what was never priced', () => {
    const set = buildSuggestions([line('any', 'Wash', 0, '2026-01-01')], jobs, [{ kind: 'labor', titleRu: '', titleEn: 'Wash', unitPriceFils: 3_000 }, { kind: 'part', titleRu: '', titleEn: 'Oil filter', unitPriceFils: 2_500 }], ctx);
    expect([set.service.list.get('WASH')!.price, set.service.list.get('WASH')!.from]).toEqual([3_000, 'list']);
    expect(set.part.top).toEqual(['OIL FILTER']);
  });
});

describe('which lines come first', () => {
  it('what this car had, then the customer’s, then the model’s, then the usual ones', () => {
    const lines = [
      ...Array.from({ length: 9 }, (_, i) => line('any', 'Car wash', 5_000, `2026-11-${10 + i}`)),
      line('sameModel', 'Disc skimming', 3_000, '2026-10-01'),
      line('otherCarSameCustomer', 'Alignment', 10_000, '2026-09-01'),
      line('thisCar', 'Tyre repair', 5_000, '2025-01-01'),
    ];
    expect(buildSuggestions(lines, jobs, [], ctx).service.top).toEqual(['TYRE REPAIR', 'ALIGNMENT', 'DISC SKIMMING', 'CAR WASH']);
  });
  it('a similar complaint pulls its lines up among the usual ones', () => {
    const lines = [line('any', 'Brake pads change', 8_000, '2026-01-01'), ...Array.from({ length: 5 }, (_, i) => line('sameMake', 'Car wash', 5_000, `2026-11-1${i}`))];
    expect(buildSuggestions(lines, jobs, [], { ...ctx, complaint: 'Brake noise' }).service.top[0]).toBe('BRAKE PADS CHANGE');
  });
});

describe('labour and services', () => {
  it('the labour sheet offers the labour charges; the services everything else that is not a part', () => {
    const lines = [line('any', 'Labour charges', 45_000, '2026-11-01'), line('any', 'Change oil & filter', 20_000, '2026-11-01'), line('any', 'Car wash', 18_000, '2026-11-01'), line('any', 'Oil filter', 3_000, '2026-11-01', { kind: 'part' })];
    const set = buildSuggestions(lines, jobs, [], ctx);
    expect(set.labor.top).toEqual(['LABOUR CHARGES']);
    expect(set.service.top.sort()).toEqual(['CAR WASH', 'CHANGE OIL & FILTER']);
    expect(set.work.top).toHaveLength(3);
    // Typed, any of them is found in either sheet.
    expect(set.labor.list.has('CAR WASH') && set.service.list.has('LABOUR CHARGES')).toBe(true);
  });
  it('knows a labour charge by its first word', () => {
    expect(['LABOUR CHARGES', 'labor', 'Labouer charge', 'Работа мастера', 'MAN HOURS 2'].every(isLabourCharge)).toBe(true);
    expect(['DOOR HANDLE REPAIR WITH LABOUR', 'LABOURER', 'CHANGE OIL', 'ЗАМЕНА МАСЛА'].some(isLabourCharge)).toBe(false);
  });
});
