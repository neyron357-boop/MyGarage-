import { describe, expect, it } from 'vitest';
import { BOARD_TABS, DEFAULT_VIEW, normalizeBoardView } from './boardView';

describe('the board view on this device', () => {
  it('nothing stored, or nonsense: the board as it was', () => {
    expect(normalizeBoardView(undefined)).toEqual(DEFAULT_VIEW);
    expect(normalizeBoardView('x')).toEqual(DEFAULT_VIEW);
    expect(normalizeBoardView({ order: 5, hidden: 'look', size: 'huge' })).toEqual(DEFAULT_VIEW);
  });

  it('keeps the order the user dragged, «Все» first, every tab once', () => {
    const dragged = ['archive', 'debts', 'price', 'look', 'wait', 'work', 'pay', 'out', 'booked'];
    const v = normalizeBoardView({ order: [dragged[0], 'all', ...dragged.slice(1), 'debts', 'nope'], size: 'compact' });
    expect(v.order).toEqual(['all', ...dragged]);
    expect([...v.order].sort()).toEqual([...BOARD_TABS].sort());
    expect(v.size).toBe('compact');
  });

  it('a tab the stored order does not know goes after its neighbour', () => {
    // An order saved before "out" existed: it comes right after "pay".
    const v = normalizeBoardView({ order: ['all', 'debts', 'look', 'price', 'wait', 'work', 'pay', 'booked', 'archive'] });
    expect(v.order.indexOf('out')).toBe(v.order.indexOf('pay') + 1);
  });

  it('only steps can be hidden', () => {
    expect(normalizeBoardView({ hidden: ['all', 'debts', 'archive', 'booked', 'booked', 'pay'] }).hidden).toEqual(['booked', 'pay']);
  });
});
