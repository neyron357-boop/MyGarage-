import { describe, expect, it } from 'vitest';
import { boardMatches, type FindJob } from './boardSearch';
import { withMarkup } from './money';

const job: FindJob = { number: 357, plate: { emirate: 'DXB', code: 'A', number: '12345' }, make: 'Toyota', model: 'Land Cruiser', name: 'Ahmed Ali', company: '', phone: '+971501234567', driver: 'Rashid' };

describe('the board’s own search (v0.81): a plate, a name, a phone — every word', () => {
  it('finds the car by its plate however it is typed, the customer by a name’s start, the phone by its digits', () => {
    for (const q of ['12345', '234', 'A12345', 'a 12345', 'ahmed', 'ali', 'AHM', 'toyota', 'land cru', '0501234567', '50123', '357', 'rash', 'ahmed 12345'])
      expect([q, boardMatches(job, q)]).toEqual([q, true]);
  });
  it('a word not in it — not this car', () => {
    for (const q of ['nissan', '99999', 'B12345', 'ahmed nissan', '0559999999']) expect([q, boardMatches(job, q)]).toEqual([q, false]);
    expect(boardMatches(job, '  ')).toBe(true);
  });
});

describe('the price from a cost at the garage’s markup (v0.81, one place for it)', () => {
  it('30 % on the cost without VAT; whole fils', () => {
    expect(withMarkup(10000, 3000)).toBe(13000);
    expect(withMarkup(2050, 3000)).toBe(2665);
    expect(withMarkup(333, 3000)).toBe(433);
    expect(withMarkup(0, 3000)).toBe(0);
    expect(withMarkup(10000, 0)).toBe(10000);
  });
});
