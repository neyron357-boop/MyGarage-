import { describe, expect, it } from 'vitest';
import { fitOf, knowOf, pickTop, rankForJob, rankSuppliers, relevance, shownStars, supplierUse, useOf, type BoughtLine } from './supplierRank';
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

  it('for a job: who sold this part for this make (v1.06: before the one already on it), already on it, then who declares the make', () => {
    const history = [line('pads', 'o1', 'FRONT BRAKE PADS'), line('pads', 'o2', 'BRAKE PADS REAR'), line('other', 'o3', 'HEADLIGHT', 'Nissan')];
    const use = supplierUse(history);
    const list = [sup('pads'), sup('declared', { makes: ['Toyota'] }), sup('other', { makes: ['Nissan'] }), sup('picked'), sup('none')];
    const job = { make: 'toyota', parts: [{ name: 'КОЛОДКИ ПЕРЕДНИЕ', title: 'Колодки передние' }], onJob: new Set(['picked']) };
    const r = rankForJob(list, use, history, job, NOW);
    // Every one of them (v0.91, #74), those that fit first.
    expect(r.map((x) => x.supplier.id).slice(0, 3)).toEqual(['pads', 'picked', 'declared']);
    expect(r).toHaveLength(5);
    // Russian «колодки» found the English «pads» they sold; two jobs for this make.
    expect(r[0].why).toEqual([
      { kind: 'boughtFor', make: 'Toyota', jobs: 2 },
      // v1.06: the very part — the front pads, not the rear ones
      { kind: 'sold', part: 'КОЛОДКИ ПЕРЕДНИЕ', times: 1, make: 'Toyota', same: true },
    ]);
    expect(r[2].why).toEqual([{ kind: 'make', make: 'Toyota' }]);
    // What they sold is shown by its own name when it has one.
    const named = rankForJob(list, use, [...history, { ...line('pads', 'o4', 'Brake pads front'), name: 'BRAKE PADS FRONT' }], job, NOW);
    expect(named[0].why[1]).toEqual({ kind: 'sold', part: 'BRAKE PADS FRONT', times: 2, make: 'Toyota', same: true });
  });

  it('what they sell, as written on their card, counts; a part given back counts against', () => {
    const list = [sup('lights', { parts: 'headlights, tail lamps' }), sup('lights2', { parts: 'headlights' })];
    const use = supplierUse([], [{ supplierId: 'lights2' }, { supplierId: 'lights2' }]);
    const r = rankForJob(list, use, [], { make: 'Kia', parts: [{ name: 'HEADLIGHT LH', title: 'Headlight LH' }], onJob: new Set() }, NOW);
    expect(r.map((x) => x.supplier.id)).toEqual(['lights', 'lights2']);
    expect(r[0].why).toEqual([{ kind: 'sells', part: 'HEADLIGHT LH' }]);
  });

  it('none fits — the used and rated ones first, and everybody after them', () => {
    const use = supplierUse([line('used', 'o1', 'X', 'Ford')]);
    const r = rankForJob([sup('used'), sup('rated', { reliability: 4 }), sup('nobody')], use, [], { make: 'Kia', parts: [], onJob: new Set() }, NOW);
    expect(r.filter(fitOf).map((x) => x.supplier.id).sort()).toEqual(['rated', 'used']);
    expect(r.at(-1)!.supplier.id).toBe('nobody');
  });

  it('v0.91: how its WhatsApp answers counts; the makes it answered for, given by hand, said by the AI', () => {
    const t0 = Date.parse(NOW) - 30 * 86_400_000;
    const turns = (n: number, answer: boolean, make: string) => Array.from({ length: n }, (_, k) => ({ t: t0 + k * 86_400_000, ...(answer ? { r: 600, p: 1 as const } : {}), mk: [make] }));
    const know = new Map([
      ['fast', knowOf({ turns: turns(6, true, 'Toyota') }, NOW)!],
      ['mute', knowOf({ turns: turns(6, false, 'Toyota') }, NOW)!],
      ['ai', knowOf({ aiMakes: ['Toyota'] }, NOW)!],
      ['hand', knowOf({ makes: ['Toyota'] }, NOW)!],
    ]);
    const list = [sup('mute'), sup('plain'), sup('ai'), sup('hand'), sup('fast')];
    const r = rankForJob(list, supplierUse([]), [], { make: 'Toyota', parts: [], onJob: new Set() }, NOW, know);
    expect(r.map((x) => x.supplier.id)).toEqual(['fast', 'hand', 'ai', 'plain', 'mute']);
    expect(r[0].why).toEqual([{ kind: 'answers', make: 'Toyota', n: 6 }]);
    expect(r[1].why).toEqual([{ kind: 'make', make: 'Toyota' }]);
    expect(r[2].why).toEqual([{ kind: 'aiMake', make: 'Toyota' }]);
    // The stars its answers earned, when the manager gave none; the manager's own win.
    expect(shownStars(sup('fast'), know.get('fast'))).toEqual({ n: 5, auto: true });
    expect(shownStars(sup('fast', { reliability: 2 }), know.get('fast'))).toEqual({ n: 2 });
    expect(shownStars(sup('mute'), know.get('mute'))!.n).toBeLessThanOrEqual(2);
    // In the whole list too.
    expect(rankSuppliers(list, supplierUse([]), NOW, know).map((s) => s.id)[0]).toBe('fast');
  });
});

describe('the manager’s marks (v0.71)', () => {
  it('good first whatever else, «does not answer» last, removed out of the job’s list', () => {
    const use = supplierUse([line('busy', 'o1', 'Brake pads'), line('busy', 'o2', 'Brake pads'), line('mute', 'o3', 'Brake pads'), line('gone', 'o4', 'Brake pads')]);
    const list = [sup('busy'), sup('fresh', { mark: 'good' }), sup('mute', { mark: 'silent' }), sup('gone', { mark: 'off' })];
    const r = rankForJob(list, use, [line('busy', 'o1', 'Brake pads'), line('mute', 'o3', 'Brake pads'), line('gone', 'o4', 'Brake pads')], { make: 'Toyota', parts: [{ name: 'BRAKE PADS', title: 'Brake pads' }], onJob: new Set() }, NOW);
    expect(r.map((x) => x.supplier.id)).toEqual(['fresh', 'busy', 'mute']);
    expect(r[0].why[0]).toEqual({ kind: 'good' });
  });
  it('in the whole list: a good one up, one that does not answer down', () => {
    expect(rankSuppliers([sup('b'), sup('a', { mark: 'silent' }), sup('c', { mark: 'good' })], supplierUse([]), NOW).map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('v0.91.6: the garage\'s main suppliers', () => {
  it('relevance: answered, with prices, jobs — weighed by how it answers', () => {
    expect(relevance({ answered: 4, priced: 4 }, 0)).toBe(10);
    expect(relevance(undefined, 2)).toBe(6);
    expect(relevance({ answered: 4, priced: 4 }, 0, { score: 30, stars: 5 })).toBe(15);
    expect(relevance({ answered: 4, priced: 4 }, 0, { score: -30, stars: 1 })).toBe(5);
  });
  it('pinned by hand first, then the most worked with; taken off by hand, the bad and the small — not', () => {
    const top = pickTop(
      [
        { key: 'a', score: 30 },
        { key: 'b', score: 8 },
        { key: 'small', score: 3 },
        { key: 'bad', score: 50, bad: true },
        { key: 'off', score: 99, pin: 'off' },
        { key: 'mine', score: 0, pin: 'on' },
      ],
      3,
    );
    expect(top).toEqual(['mine', 'a', 'b']);
    expect(pickTop([{ key: 'a', score: 30 }, { key: 'b', score: 20 }], 1)).toEqual(['a']);
    // v0.91.7: many pinned by hand — the ones the work found are main too.
    const many = ['p1', 'p2', 'p3', 'p4'].map((key) => ({ key, score: 1, pin: 'on' as const }));
    expect(pickTop([...many, { key: 'a', score: 30 }, { key: 'b', score: 20 }], 2)).toEqual(['p1', 'p2', 'p3', 'p4', 'a', 'b']);
  });
  it('first in the list and for a job (the main ones in their order, then the rest)', () => {
    const list = [sup('x', { reliability: 5 }), sup('main'), sup('y')];
    expect(rankSuppliers(list, supplierUse([]), NOW, undefined, new Map([['main', 0]])).map((s) => s.id)[0]).toBe('main');
    const r = rankForJob(list, supplierUse([]), [], { make: 'Toyota', parts: [], onJob: new Set(['x']) }, NOW, undefined, new Map([['main', 0]]));
    expect(r[0].supplier.id).toBe('main');
    expect(r[0].why[0]).toEqual({ kind: 'top' });
  });
});
