import { describe, expect, it } from 'vitest';
import { withBought } from './linePrices';
import { isWorkLine, lineOf, twinSweep } from './papers';
import { historyBefore, historyBest, historyOffers, historyPatch, searchBought } from './priceBook';
import { quickMatches } from './quickAdd';
import { rankForJob, supplierUse, type BoughtLine } from './supplierRank';
import type { OrderItem, PricePoint, Supplier, SupplierPaper } from './types';

/*
 * v1.06 — the garage's history at work: the price of a part bought for this car on the job's line, «Цены из истории», the
 * suppliers who sold this part for this car first, the parts bought searched, the suggestions. Every seller, number, part and
 * price here is made up.
 */

const NOW = '2026-11-28T08:00:00.000Z';
const pt = (id: string, x: Partial<PricePoint>): PricePoint => ({
  id,
  part: 'FRONT BUMPER',
  kind: 'aftermarket',
  via: 'paper',
  at: '2026-03-10T08:00:00.000Z',
  orderId: '',
  itemId: '',
  updatedAt: NOW,
  supplierId: 's1',
  costFils: 45000,
  ...x,
});
const POINTS = [
  pt('paper:a:0', { make: 'Toyota', model: 'Land Cruiser', supplierId: 's1', costFils: 45000, name: 'LC200 FRONT BUMPER' }),
  pt('paper:b:0', { make: 'Toyota', model: 'Land Cruiser', supplierId: 's2', costFils: 52000, at: '2026-06-01T08:00:00.000Z' }),
  pt('paper:c:0', { make: 'Toyota', model: 'Corolla', supplierId: 's3', costFils: 30000 }),
  pt('paper:d:0', { make: 'Nissan', model: 'Patrol', supplierId: 's4', costFils: 60000 }),
  // the paper named no car
  pt('paper:e:0', { supplierId: 's5', costFils: 20000 }),
  // a supplier's word on another job
  pt('wa1', { make: 'Toyota', model: 'Land Cruiser', supplierId: 's6', costFils: 40000, via: 'wa', at: '2026-11-01T08:00:00.000Z' }),
  // work, not a part
  pt('paper:f:0', { part: 'FRONT BUMPER FITTING', make: 'Toyota', model: 'Land Cruiser', supplierId: 's7', costFils: 5000, service: true }),
];

describe('v1.06: a part’s prices of the history on a job', () => {
  it('this car first, bought before told, the newest within; a car not said or another make — never', () => {
    const h = historyOffers(POINTS, { part: 'Front bumper', make: 'Toyota', model: 'Land Cruiser' }, 5);
    expect(h.map((x) => [x.point.id, x.near])).toEqual([
      ['paper:b:0', 2],
      ['paper:a:0', 2],
      ['wa1', 2],
      ['paper:c:0', 1],
    ]);
    // «Цены из истории» takes the newest bought for this very model
    expect(historyBest(h)?.point.id).toBe('paper:b:0');
    // a car unknown — nothing to offer
    expect(historyOffers(POINTS, { part: 'Front bumper' })).toEqual([]);
    // the same make only: that make's, no best
    const yaris = historyOffers(POINTS, { part: 'FRONT BUMPER', make: 'Toyota', model: 'Yaris' });
    expect(yaris.length).toBeGreaterThan(0);
    expect(yaris.every((x) => x.near === 1)).toBe(true);
    expect(historyBest(yaris)).toBeUndefined();
  });
  it('taken: the cost (one piece, without VAT), its supplier, the customer’s price by the markup — only when it has none', () => {
    const s = { defaultMarkupBp: 3000, vatRateBp: 500, pricesIncludeVat: false };
    const draft = { approvalState: 'draft', unitPriceFils: 0 } as OrderItem;
    const p = historyPatch(draft, POINTS[0], s);
    expect(p).toMatchObject({ costPriceFils: 45000, supplierId: 's1', unitPriceFils: 58500, costFrom: { point: 'paper:a:0', fils: 45000, price: 58500 } });
    // a price typed by hand stays
    expect(historyPatch({ ...draft, unitPriceFils: 70000 }, POINTS[0], s).unitPriceFils).toBeUndefined();
    // the history's own price follows another pick
    const again = historyPatch({ ...draft, unitPriceFils: 58500, costFrom: { point: 'paper:a:0', fils: 45000, price: 58500 } }, POINTS[1], s);
    expect([again.costPriceFils, again.unitPriceFils]).toEqual([52000, 67600]);
    // prices typed with VAT: the gross kept
    expect(historyPatch(draft, POINTS[0], { ...s, pricesIncludeVat: true })).toMatchObject({ unitPriceFils: 58500, unitGrossFils: 61425 });
    // what it had, for «Отменить»
    expect(historyBefore({ ...draft, costPriceFils: 1, supplierId: 'x' } as OrderItem)).toMatchObject({ costPriceFils: 1, supplierId: 'x', unitPriceFils: 0 });
  });
});

describe('v1.06: the parts bought, searched — «front bumper land cruiser»', () => {
  it('the part’s words in either language, the car named: its model first, its make, a paper naming none; another make never', () => {
    const hits = searchBought(POINTS, { tokens: ['front', 'bumper'], car: { make: 'Toyota', model: 'Land Cruiser' } });
    expect(hits.map((h) => [h.point.id, h.near])).toEqual([
      ['paper:b:0', 2],
      ['paper:a:0', 2],
      ['paper:c:0', 1],
      ['paper:e:0', 0],
    ]);
    // in Russian, through the garage's dictionary
    expect(searchBought(POINTS, { tokens: ['бампер'], car: { make: 'Nissan' } }).map((h) => h.point.id)).toEqual(['paper:d:0', 'paper:e:0']);
    // only bought (a word on a job is not a purchase), no work
    expect(searchBought(POINTS, { tokens: ['bumper'] }).some((h) => h.point.id === 'wa1' || h.point.id === 'paper:f:0')).toBe(false);
  });
});

describe('v1.06: who sold this part for this car — first, above the main suppliers', () => {
  const sup = (id: string, x: Partial<Supplier> = {}): Supplier => ({ id, name: id, phone: '+971500000000', createdAt: '2026-01-01', ...x });
  const line = (supplierId: string, name: string, make?: string, model?: string): BoughtLine => ({ supplierId, orderId: `paper:${supplierId}:${name}`, at: '2026-05-01T08:00:00.000Z', title: name, name, make, model, fils: 45000, paper: true });
  const history = [line('forCar', 'FRONT BUMPER', 'Toyota', 'Land Cruiser'), line('forMake', 'FRONT BUMPER', 'Toyota', 'Corolla'), line('word', 'BUMPER BRACKET', 'Toyota', 'Land Cruiser'), line('anyCar', 'FRONT BUMPER')];
  const list = [sup('main'), sup('word'), sup('anyCar'), sup('forMake'), sup('forCar')];
  it('the very part for this model, then this make, then the main ones; a word of it («BUMPER BRACKET») is not the part', () => {
    const r = rankForJob(list, supplierUse(history), history, { make: 'Toyota', model: 'Land Cruiser', parts: [{ name: 'FRONT BUMPER', title: 'FRONT BUMPER' }], onJob: new Set() }, NOW, undefined, new Map([['main', 0]]));
    expect(r.map((x) => x.supplier.id)).toEqual(['forCar', 'forMake', 'main', 'anyCar', 'word']);
    expect(r[0].why).toContainEqual(expect.objectContaining({ kind: 'sold', model: 'Land Cruiser', fils: 45000, same: true }));
    expect(r[1].why).toContainEqual(expect.objectContaining({ kind: 'sold', make: 'Toyota' }));
  });
});

describe('v1.06: the suggestions — what was bought for this car, said beside it', () => {
  it('a title of the history marked; one only bought offered at the markup; this model before the rest', () => {
    const part = {
      list: new Map([
        ['FRONT BUMPER', { titleRu: '', titleEn: 'FRONT BUMPER', price: 60000, uses: 3, from: 'any' as const }],
        ['FRONT BUMPER BRACKET', { titleRu: '', titleEn: 'FRONT BUMPER BRACKET', price: 9000, uses: 9, from: 'any' as const }],
      ]),
      top: [],
    };
    const set = withBought(part, [...POINTS, pt('paper:g:0', { part: 'FRONT GRILLE', make: 'Toyota', model: 'Land Cruiser', costFils: 20000 })], { make: 'Toyota', model: 'Land Cruiser' }, 3000, new Map([['s2', 'Desert Star']]));
    expect(set.list.get('FRONT BUMPER')?.bought).toMatchObject({ point: 'paper:b:0', fils: 52000, who: 'Desert Star', near: 2 });
    expect(set.list.get('FRONT BUMPER')?.price).toBe(60000);
    expect(set.list.get('FRONT GRILLE')).toMatchObject({ price: 26000, bought: { near: 2 } });
    expect(quickMatches(set, 'front', 3)).toEqual(['FRONT BUMPER', 'FRONT GRILLE', 'FRONT BUMPER BRACKET']);
  });
});

describe('v1.06: the papers — work lines, a maker as the brand, the same paper twice', () => {
  it('work is told; a car maker as the brand gives the make — not a part’s word that is a maker too', () => {
    expect(isWorkLine('JOB-WHEEL ALIGNMENT-4X4')).toBe(true);
    expect(isWorkLine('BRAKE DISC SKIMMING')).toBe(true);
    expect(isWorkLine('O-RING WASHER')).toBe(false);
    expect(isWorkLine('BOLT THREAD MAKING', 'service')).toBe(true);
    expect(isWorkLine('OIL FILTER', 'service')).toBe(false);
    expect(lineOf({ name: 'OIL FILTER 90210 NISSAN', qty: 1 }, {})).toMatchObject({ make: 'Nissan', kind: 'oem' });
    expect(lineOf({ name: 'COOLANT TANK', qty: 1 }, {}).make).toBeUndefined();
    expect(lineOf({ name: 'OIL FILTER MINI B38', qty: 1 }, {}).make).toBeUndefined();
    expect(lineOf({ name: 'JOB-WHEEL BALANCING', qty: 1 }, {}).service).toBe(true);
  });
  it('read twice on two devices: the reading that adds up and has more lines kept, on every device the same; «Не дубль» stays', () => {
    const p = (id: string, x: Partial<SupplierPaper>): SupplierPaper => ({ id, hash: id, mediaId: id, state: 'done', supplierId: 's1', invoiceNo: '7001', date: '2026-01-27', totalFils: 10000, createdAt: `2026-11-28T10:0${id.length}:00Z`, updatedAt: '', lines: [], ...x });
    const two = [p('a', { lines: [{ name: 'X', qty: 1, kind: 'aftermarket' }] }), p('bb', { lines: [{ name: 'X', qty: 1, kind: 'aftermarket' }, { name: 'Y', qty: 1, kind: 'aftermarket' }] })];
    expect([...twinSweep(two)]).toEqual([['a', 'bb']]);
    expect([...twinSweep([...two].reverse())]).toEqual([['a', 'bb']]);
    // the same number a year on, another day and sum: another paper
    expect(twinSweep([p('a', {}), p('bb', { date: '2027-01-20', totalFils: 5000 })]).size).toBe(0);
    expect(twinSweep([two[0], { ...two[1], alone: true }]).size).toBe(1);
    expect(twinSweep([{ ...two[0], alone: true }, two[1]]).size).toBe(0);
  });
});
