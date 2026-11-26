import { describe, expect, it } from 'vitest';
import { itemAmounts } from './items';
import { chosenLines, freshOptionLines, liveOptions, optionGross, optionItems, optionName } from './quoteOptions';
import type { OrderItem, QuoteOption } from './types';

const line = (id: string, gross: number, p: Partial<OrderItem> = {}): OrderItem => ({
  id,
  orderId: 'o',
  kind: 'part',
  block: 'A',
  qty: 1,
  unit: 'pcs',
  unitPriceFils: Math.round(gross / 1.05),
  unitGrossFils: gross,
  vatRateBp: 500,
  approvalState: 'draft',
  done: false,
  createdAt: '2026-11-26T08:00:00Z',
  position: Number(id.slice(1)),
  titleEn: id.toUpperCase(),
  ...p,
});
const opt = (id: string, itemIds: string[], name = ''): QuoteOption => ({ id, name, itemIds, createdAt: '2026-11-26T08:00:00Z' });

describe('quote options (v0.90, #72)', () => {
  const items = [line('l1', 50_400), line('l2', 30_000), line('l3', 31_500, { kind: 'labor' }), line('l4', 10_000, { unconfirmed: true })];

  it('each option — its lines in the job’s order and its total', () => {
    const a = opt('a', ['l3', 'l1']);
    expect(optionItems(items, a).map((i) => i.id)).toEqual(['l1', 'l3']);
    expect(optionGross(items, a)).toBe(81_900);
    expect(optionGross(items, opt('b', ['l2', 'l3']))).toBe(61_500);
  });

  it('the job’s discount on each option’s lines: a percentage of them, an amount as given (never more than they are)', () => {
    const pct = [...items, line('d1', 0, { kind: 'discount', discountPctBp: 1000, unitPriceFils: 0, unitGrossFils: 0 })];
    const a = optionItems(pct, opt('a', ['l1', 'l3']));
    expect(a.filter((i) => i.kind === 'discount').reduce((s, i) => s + itemAmounts(i).gross, 0)).toBe(-8_190);
    const sum = [...items, line('d1', 0, { kind: 'discount', unitPriceFils: 95_238, unitGrossFils: 100_000 })];
    expect(optionGross(sum, opt('b', ['l2']))).toBe(0);
  });

  it('a new option: the last one’s lines; the first — the lines that count (not the unconfirmed)', () => {
    expect(freshOptionLines(items, [])).toEqual(['l1', 'l2', 'l3']);
    expect(freshOptionLines(items, [opt('a', ['l1', 'l3'])])).toEqual(['l1', 'l3']);
  });

  it('lines gone from the job are gone from the options; names said by number', () => {
    const gone = items.map((i) => (i.id === 'l2' ? { ...i, approvalState: 'declined' as const } : i));
    expect(liveOptions(gone, [opt('a', ['l1', 'l2'])])[0].itemIds).toEqual(['l1']);
    expect(optionName({ name: '' }, 2, 'ru')).toBe('Вариант 2');
    expect(optionName({ name: ' Копия ' }, 2, 'en')).toBe('Копия');
  });

  it('chosen: its drafts confirmed, the other drafts not', () => {
    expect(chosenLines(items, opt('b', ['l2', 'l3', 'l4']))).toEqual({ confirm: ['l4'], unconfirm: ['l1'] });
  });
});
