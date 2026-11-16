import { describe, expect, it } from 'vitest';
import { jobSummary } from './jobSummary';
import type { OrderItem } from './types';

const line = (kind: OrderItem['kind'], titleEn: string, approvalState: OrderItem['approvalState'] = 'draft') => ({ kind, titleEn, approvalState, qty: 1, unitPriceFils: 100, vatRateBp: 500 }) as OrderItem;

describe('a job in a line, for its card (v0.30)', () => {
  it('its work first, then its parts — the first three and how many more', () => {
    const items = [line('part', 'Oil filter'), line('labor', 'Oil change'), line('part', 'Engine oil 5W-30'), line('part', 'Air filter'), line('labor', 'Brake check')];
    expect(jobSummary(items, 'Noise', 'en')).toBe('OIL CHANGE · BRAKE CHECK · OIL FILTER +2');
  });
  it('refused and cancelled lines and the discount are not what it is about', () => {
    const items = [line('labor', 'AC service', 'declined'), line('discount', 'Discount'), line('part', 'Wiper', 'approved')];
    expect(jobSummary(items, '', 'en')).toBe('WIPER');
  });
  it('nothing on it yet: what the customer complained of', () => {
    expect(jobSummary([], '  Brakes  squeak,\n AC weak ', 'en')).toBe('Brakes squeak, AC weak');
    expect(jobSummary([], undefined, 'en')).toBe('');
  });
});
