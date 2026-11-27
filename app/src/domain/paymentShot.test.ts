import { describe, expect, it } from 'vitest';
import { paymentPlan } from './paymentShot';

const read = (o: Partial<Parameters<typeof paymentPlan>[0] & object> = {}) => ({ isPayment: true, amount: 1250, currency: 'AED', date: '2026-11-26', reference: 'FT2611270042', bank: 'Emirates NBD', confidence: 0.9, ...o });

describe('a customer’s payment screenshot → what to propose', () => {
  it('a transfer in dirhams: its amount, its printed day, the bank and the reference', () => {
    expect(paymentPlan(read(), 125_000, '2026-11-27', '2026-11-27')).toEqual({ amountFils: 125_000, shotFils: 125_000, method: 'transfer', date: '2026-11-26', reference: 'Emirates NBD · FT2611270042' });
  });

  it('never more than is due; a card slip is card', () => {
    const p = paymentPlan(read({ amount: 1300, way: 'card' }), 125_000, '2026-11-27', '2026-11-27')!;
    expect([p.amountFils, p.shotFils, p.method]).toEqual([125_000, 130_000, 'card']);
    expect(paymentPlan(read({ amount: 600.5 }), 125_000, '2026-11-27', '2026-11-27')!.amountFils).toBe(60_050);
  });

  it('the day: printed if real, not after today and not a week before the picture — else the day it came', () => {
    expect(paymentPlan(read({ date: '2026-11-28' }), 1, '2026-11-27', '2026-11-27')!.date).toBe('2026-11-27');
    expect(paymentPlan(read({ date: '2026-10-01' }), 1, '2026-11-27', '2026-11-27')!.date).toBe('2026-11-27');
    expect(paymentPlan(read({ date: '26/11/2026' }), 1, '2026-11-25', '2026-11-27')!.date).toBe('2026-11-25');
  });

  it('nothing: not a payment, unsure, another currency, no amount, nothing due', () => {
    expect(paymentPlan(read({ isPayment: false }), 125_000, '2026-11-27', '2026-11-27')).toBeUndefined();
    expect(paymentPlan(read({ confidence: 0.4 }), 125_000, '2026-11-27', '2026-11-27')).toBeUndefined();
    expect(paymentPlan(read({ currency: 'USD' }), 125_000, '2026-11-27', '2026-11-27')).toBeUndefined();
    expect(paymentPlan(read({ amount: 0 }), 125_000, '2026-11-27', '2026-11-27')).toBeUndefined();
    expect(paymentPlan(read(), 0, '2026-11-27', '2026-11-27')).toBeUndefined();
    expect(paymentPlan(undefined, 125_000, '2026-11-27', '2026-11-27')).toBeUndefined();
    // No currency printed, or the Arabic word: still dirhams.
    expect(paymentPlan(read({ currency: '' }), 125_000, '2026-11-27', '2026-11-27')).toBeDefined();
    expect(paymentPlan(read({ currency: 'درهم' }), 125_000, '2026-11-27', '2026-11-27')).toBeDefined();
  });
});
