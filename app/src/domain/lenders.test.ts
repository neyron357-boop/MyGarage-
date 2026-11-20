import { describe, expect, it } from 'vitest';
import { owedIndex, owedToOf } from './debts';
import { noteBesides } from './ledger';
import { findOwed, pickKey, recentOwed, sameLender } from './lenders';
import { owedInNotes } from './moneySheet';
import type { Expense, Lender, Supplier } from './types';

const ahmed: Lender = { id: 'l1', name: 'Ahmed', phone: '+971501112233', createdAt: '2026-11-01T08:00:00.000Z' };
const omar: Lender = { id: 'l2', name: 'Omar', phone: '', createdAt: '2026-11-18T08:00:00.000Z' };
const noor = { id: 's1', name: 'Al Noor Auto Spare Parts LLC', phone: '+97165551234' } as Supplier;
const credit = (id: string, at: string, e: Partial<Expense>) => ({ id, method: 'credit', createdAt: at, ...e }) as Expense;

describe('whom an expense on credit is owed to (v0.61)', () => {
  const idx = owedIndex([noor], [ahmed, omar]);
  it('the person who paid for it first; else its supplier, the same supplier written another way, the seller as written; else nobody', () => {
    expect(owedToOf({ vendor: 'Al Noor Auto', supplierId: 's1', lenderId: 'l1' }, idx)).toMatchObject({ key: 'l:l1', name: 'Ahmed', phone: '+971501112233' });
    expect(owedToOf({ supplierId: 's1' }, idx)).toMatchObject({ key: 's:s1', name: 'Al Noor Auto Spare Parts LLC' });
    expect(owedToOf({ vendor: 'AL NOOR AUTO SPARE PARTS L.L.C' }, idx)?.key).toBe('s:s1');
    expect(owedToOf({ vendor: '  Gulf Star ' }, idx)).toEqual({ key: 'v:gulfstar', name: 'Gulf Star' });
    expect(owedToOf({ vendor: '' }, idx)).toBeUndefined();
    // A person no longer in the list: the seller is owed.
    expect(owedToOf({ supplierId: 's1', lenderId: 'gone' }, idx)?.key).toBe('s:s1');
  });

  it('the chips: whom it owed lately, one each, the latest first; a person added and not owed yet among them', () => {
    const list = recentOwed(
      [
        credit('e1', '2026-11-05T10:00:00.000Z', { lenderId: 'l1' }),
        credit('e2', '2026-11-10T10:00:00.000Z', { supplierId: 's1' }),
        credit('e3', '2026-11-12T10:00:00.000Z', { lenderId: 'l1' }),
        credit('e4', '2026-11-20T10:00:00.000Z', { vendor: 'Gulf Star', voidedAt: '2026-11-20T11:00:00.000Z' }),
        { ...credit('e5', '2026-11-20T10:00:00.000Z', { vendor: 'Cash shop' }), method: 'cash' } as Expense,
      ],
      idx,
      [ahmed, omar],
    );
    expect(list.map((p) => [p.kind, p.name])).toEqual([
      ['lender', 'Omar'],
      ['lender', 'Ahmed'],
      ['supplier', 'Al Noor Auto Spare Parts LLC'],
    ]);
    expect(list.map(pickKey)).toEqual(['l:l2', 'l:l1', 's:s1']);
  });

  it('typing finds the people first, then the suppliers — by a part of the name or of the phone as it is said', () => {
    expect(findOwed('al', [ahmed, omar], [noor]).map((p) => p.name)).toEqual(['Al Noor Auto Spare Parts LLC']);
    expect(findOwed('ahm', [ahmed, omar], [noor]).map((p) => p.kind)).toEqual(['lender']);
    expect(findOwed('050 111', [ahmed, omar], [noor]).map((p) => p.name)).toEqual(['Ahmed']);
    expect(findOwed('06 555', [ahmed, omar], [noor]).map((p) => p.name)).toEqual(['Al Noor Auto Spare Parts LLC']);
    expect(findOwed(' ', [ahmed], [noor])).toEqual([]);
  });

  it('one man is never saved twice: the same phone, or the same name (another phone is another man)', () => {
    expect(sameLender([ahmed, omar], { name: 'Someone', phone: '+971501112233' })?.id).toBe('l1');
    expect(sameLender([ahmed, omar], { name: ' omar. ', phone: '' })?.id).toBe('l2');
    expect(sameLender([ahmed, omar], { name: 'Omar', phone: '+971509999999' })?.id).toBe('l2');
    expect(sameLender([ahmed, omar], { name: 'Ahmed', phone: '+971509999999' })).toBeUndefined();
  });

  it('the seller owed is named once beside the note; the sheet’s notes give back whom it is owed to', () => {
    expect(noteBesides({ note: 'Al Noor · pads', owedTo: 'Al Noor' })).toBe('pads');
    expect(noteBesides({ note: 'Al Noor', owedTo: 'Al Noor' })).toBeUndefined();
    expect(noteBesides({ note: 'Al Noor · pads', owedTo: 'Ahmed' })).toBe('Al Noor · pads');
    expect(owedInNotes('Owed to Ahmed — #351 Toyota Camry — pads')).toEqual({ name: 'Ahmed', rest: '#351 Toyota Camry — pads' });
    expect(owedInNotes('Owed to Rashid')).toEqual({ name: 'Rashid', rest: '' });
    expect(owedInNotes('bolts')).toEqual({ rest: 'bolts' });
  });
});
