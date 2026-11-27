import { describe, expect, it } from 'vitest';
import { dailyText } from './dailySummary';

describe('the owner’s summary of the day (audit 27/11)', () => {
  it('the cars, the money, the cash counted, the discounts, what is owed — lines without a number left out', () => {
    const text = dailyText(
      { garage: 'Garage', date: '27/11/2026', carsIn: 3, carsOut: 2, onBoard: 5, revenueFils: 425000, paid: { cash: 120000, card: 200000, transfer: 0 }, expensesFils: 83000, cash: { expected: 234000, counted: 230000 }, discountsFils: 15000, creditNotes: 1, owedFils: 1260000 },
      'en',
    );
    expect(text.split('\n')).toEqual([
      '📊 *Garage · The day 27/11/2026*',
      '🚗 Cars: in 3 · out 2 · on the board 5',
      '💰 Revenue (invoices): 4,250.00 AED',
      '💵 Paid: cash 1,200.00 AED · card 2,000.00 AED',
      '🧾 Expenses: 830.00 AED',
      '🏦 Cash box: should be 2,340.00 AED · counted 2,300.00 AED (−40.00 AED)',
      '📉 Discounts: 150.00 AED · credit notes: 1',
      '⏳ Customers owe: 12,600.00 AED',
    ]);
    const quiet = dailyText({ garage: '', date: '27/11/2026', carsIn: 0, carsOut: 0, onBoard: 4, revenueFils: 0, paid: { cash: 0, card: 0, transfer: 0 }, expensesFils: 0, discountsFils: 0, creditNotes: 0, owedFils: 0 }, 'ru');
    expect(quiet.split('\n')).toHaveLength(3);
  });
});
