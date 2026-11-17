import { describe, expect, it } from 'vitest';
import { rankForJob, rankSuppliers, supplierUse, useOf, type BoughtLine } from './supplierRank';
import type { Supplier } from './types';

const NOW = '2026-11-17T08:00:00.000Z';
const sup = (id: string, extra: Partial<Supplier> = {}): Supplier => ({ id, name: id, createdAt: '2026-01-01T00:00:00.000Z', ...extra });
const line = (supplierId: string, orderId: string, title: string, make = 'Toyota', at = '2026-11-01T08:00:00.000Z'): BoughtLine => ({ supplierId, orderId, title, make, at });

describe('suppliers by what was bought from them (v0.38)', () => {
  it('counts jobs, lines, jobs per make, the last time and the returns', () => {
    const use = supplierUse(
      [line('a', 'o1', 'BRAKE PADS'), line('a', 'o1', 'DISC'), line('a', 'o2', 'FILTER', 'Nissan', '2026-11-10T08:00:00.000Z'), line('b', 'o3', 'BUMPER')],
      [{ supplierId: 'a' }],
    );
    const a = useOf(use, 'a');
    expect(a.jobs).toBe(2);
    expect(a.lines).toBe(3);
    expect(a.makeJobs).toEqual({ toyota: 1, nissan: 1 });
    expect(a.lastAt).toBe('2026-11-10T08:00:00.000Z');
    expect(a.returns).toBe(1);
    expect(useOf(use, 'zzz').jobs).toBe(0);
  });

  it('the list: most used and best rated first, then by name', () => {
    const use = supplierUse([line('busy', 'o1', 'X'), line('busy', 'o2', 'Y'), line('busy', 'o3', 'Z')]);
    const order = rankSuppliers([sup('alpha'), sup('busy'), sup('star', { reliability: 5 }), sup('bad', { reliability: 1 })], use, NOW).map((s) => s.id);
    expect(order.slice(0, 2).sort()).toEqual(['busy', 'star']);
    expect(order.at(-1)).toBe('bad');
    expect(order.indexOf('busy')).toBeLessThan(order.indexOf('alpha'));
  });

  it('for a job: already on it, then who sold such a part for this make, then who declares the make', () => {
    const history = [line('pads', 'o1', 'FRONT BRAKE PADS'), line('pads', 'o2', 'BRAKE PADS REAR'), line('other', 'o3', 'HEADLIGHT', 'Nissan')];
    const use = supplierUse(history);
    const list = [sup('pads'), sup('declared', { makes: ['Toyota'] }), sup('other', { makes: ['Nissan'] }), sup('picked'), sup('none')];
    const job = { make: 'toyota', parts: [{ name: 'КОЛОДКИ ПЕРЕДНИЕ', title: 'Колодки передние' }], onJob: new Set(['picked']) };
    const r = rankForJob(list, use, history, job, NOW);
    expect(r.map((x) => x.supplier.id)).toEqual(['picked', 'pads', 'declared']);
    // Russian «колодки» found the English «pads» they sold; two jobs for this make.
    expect(r[1].why).toEqual([
      { kind: 'boughtFor', make: 'Toyota', jobs: 2 },
      { kind: 'sold', part: 'КОЛОДКИ ПЕРЕДНИЕ', times: 2 },
    ]);
    expect(r[2].why).toEqual([{ kind: 'make', make: 'Toyota' }]);
    // What they sold is shown by its own name when it has one.
    const named = rankForJob(list, use, [...history, { ...line('pads', 'o4', 'Brake pads front'), name: 'BRAKE PADS FRONT' }], job, NOW);
    expect(named[1].why[1]).toEqual({ kind: 'sold', part: 'BRAKE PADS FRONT', times: 3 });
  });

  it('what they sell, as written on their card, counts; a part given back counts against', () => {
    const list = [sup('lights', { parts: 'headlights, tail lamps' }), sup('lights2', { parts: 'headlights' })];
    const use = supplierUse([], [{ supplierId: 'lights2' }, { supplierId: 'lights2' }]);
    const r = rankForJob(list, use, [], { make: 'Kia', parts: [{ name: 'HEADLIGHT LH', title: 'Headlight LH' }], onJob: new Set() }, NOW);
    expect(r.map((x) => x.supplier.id)).toEqual(['lights', 'lights2']);
    expect(r[0].why).toEqual([{ kind: 'sells', part: 'HEADLIGHT LH' }]);
  });

  it('none fits — the used and rated ones, never an empty screen of strangers', () => {
    const use = supplierUse([line('used', 'o1', 'X', 'Ford')]);
    const r = rankForJob([sup('used'), sup('rated', { reliability: 4 }), sup('nobody')], use, [], { make: 'Kia', parts: [], onJob: new Set() }, NOW);
    expect(r.map((x) => x.supplier.id).sort()).toEqual(['rated', 'used']);
  });
});
