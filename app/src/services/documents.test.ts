import { describe, expect, it } from 'vitest';
import { documentFileName } from './documents';

describe("a document's file name", () => {
  it('says what it is, then the car and its plate', () => {
    const car = { make: 'Honda', model: 'Accord', plate: { emirate: 'DXB', code: 'R', number: '7720' } } as const;
    expect(documentFileName('Quotation', car)).toBe('Quotation - Honda Accord - Dubai R 7720.pdf');
    expect(documentFileName('INV-2026-00005', car)).toBe('INV-2026-00005 - Honda Accord - Dubai R 7720.pdf');
    expect(documentFileName('Quotation', { make: '', model: '', plate: { emirate: 'AUH', code: '5', number: '31415' } })).toBe('Quotation - Abu Dhabi 5 31415.pdf');
    expect(documentFileName('Debt')).toBe('Debt.pdf');
    expect(documentFileName('Quotation', { make: 'A/B', model: 'C:D', plate: { emirate: 'DXB', code: 'A', number: '1' } })).toBe('Quotation - A B C D - Dubai A 1.pdf');
  });
});
