import { describe, expect, it } from 'vitest';
import { readCustomerAnswer } from './customerReply';

const lines = [
  { id: 'p', name: 'FRONT BRAKE PADS' },
  { id: 'd', name: 'FRONT BRAKE DISCS' },
  { id: 'l', name: 'LABOR CHARGE: FRONT BRAKE PADS, FRONT BRAKE DISCS', labour: true },
];

describe('the customer’s answer to the quote (audit 27/11)', () => {
  it('yes in any of the garage’s languages — all; no — none', () => {
    for (const t of ['yes', 'Ok', 'ok bro', 'Go ahead please', 'تمام', 'ماشي', 'haan', 'theek hai', 'Да', 'делайте', 'ok 👍', 'Okay thanks']) expect(readCustomerAnswer(t, lines)).toEqual({ kind: 'all' });
    for (const t of ['no', 'Not now', 'لا', 'нет', 'не надо']) expect(readCustomerAnswer(t, lines)).toEqual({ kind: 'none' });
  });

  it('some by name: only the pads; without the discs', () => {
    expect(readCustomerAnswer('only pads', lines)).toEqual({ kind: 'some', agree: ['p', 'l'], refuse: ['d'] });
    // The labour charge goes with the parts agreed, whatever its words.
    expect(readCustomerAnswer('ok without discs', lines)).toEqual({ kind: 'some', agree: ['p', 'l'], refuse: ['d'] });
    expect(readCustomerAnswer('без дисков', lines)).toMatchObject({ kind: 'some', refuse: ['d'] });
    expect(readCustomerAnswer('только колодки', lines)).toMatchObject({ kind: 'some', agree: ['p', 'l'] });
  });

  it('an option by its number, only when options were sent', () => {
    expect(readCustomerAnswer('option 2', lines, 2)).toEqual({ kind: 'option', option: 2 });
    expect(readCustomerAnswer('2', lines, 2)).toEqual({ kind: 'option', option: 2 });
    expect(readCustomerAnswer('вариант 1', lines, 3)).toEqual({ kind: 'option', option: 1 });
    expect(readCustomerAnswer('2', lines, 0).kind).not.toBe('option');
    expect(readCustomerAnswer('option 5', lines, 2).kind).not.toBe('option');
  });

  it('a question or anything else — nothing proposed', () => {
    expect(readCustomerAnswer('how much without discs?', lines)).toEqual({ kind: 'question' });
    expect(readCustomerAnswer('ok but why so expensive?', lines)).toEqual({ kind: 'question' });
    expect(readCustomerAnswer('I will call you', lines)).toEqual({ kind: 'unknown' });
    expect(readCustomerAnswer('yes tomorrow', lines)).toEqual({ kind: 'unknown' });
    expect(readCustomerAnswer('', lines)).toEqual({ kind: 'unknown' });
  });
});
