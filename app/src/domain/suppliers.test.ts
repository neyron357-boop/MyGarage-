import { describe, expect, it } from 'vitest';
import { cardName, localPhone, looksLikePhone, phonesInText, alreadyInBase, sellerKey, supplierMatches } from './suppliers';

describe('adding a supplier (v0.24)', () => {
  it('reads the numbers a card prints, mobiles first, each once', () => {
    const text = 'AL QUOZ AUTO PARTS\nTel: 04 333 4455  Fax: +971-4-333-4456\nMob: +971 50 123 4567 / 055-7654321\nWhatsApp 00971501234567\nwww.alquozparts.ae';
    expect(phonesInText(text)).toEqual(['+971501234567', '+971557654321', '+97143334455', '+97143334456']);
    // Several in one run of digits (the card's line read without the slash between them).
    expect(phonesInText('050 1234567 055 7654321')).toEqual(['+971501234567', '+971557654321']);
    expect(phonesInText('Office (06) 555 6677')).toEqual(['+97165556677']);
    // Not a phone: a trade licence number, a P.O. box, a year.
    expect(phonesInText('TRN 100234567800003 · P.O. Box 12345 · since 1998')).toEqual([]);
  });

  it('takes the name in the largest letters — not a number, an address, a web site or a title', () => {
    expect(
      cardName([
        { text: 'Sales Manager', height: 30 },
        { text: 'www.alquoz.ae', height: 40 },
        { text: '+971 50 123 4567', height: 60 },
        { text: 'AL QUOZ  AUTO PARTS', height: 52 },
        { text: 'Ahmed Khan', height: 24 },
      ]),
    ).toBe('AL QUOZ AUTO PARTS');
    expect(cardName([{ text: '050 123', height: 40 }])).toBeUndefined();
  });

  it('finds a supplier by its number as it is said here', () => {
    const s = { name: 'Sharjah Spares', phone: '+971501234567', makes: ['Toyota'], parts: 'brakes' };
    expect(localPhone('+971501234567')).toBe('0501234567');
    expect(supplierMatches(s, '050 123')).toBe(true);
    expect(supplierMatches(s, '0501234567')).toBe(true);
    expect(supplierMatches(s, 'toyota brakes')).toBe(true);
    expect(supplierMatches(s, 'nissan')).toBe(false);
    expect(looksLikePhone('050 123 4567')).toBe(true);
    expect(looksLikePhone('Al Quoz')).toBe(false);
  });

  it('knows the one already in the base: the same number however typed, or the same name', () => {
    const list = [
      { id: 'a', name: 'Al Quoz Auto Parts', phone: '+971501234567' },
      { id: 'b', name: 'Sharjah Spares', phone: '0557654321' },
      { id: 'c', name: 'Gone Ltd', phone: '+971521111111', archivedAt: '2026-11-01T00:00:00Z' },
    ];
    expect(alreadyInBase(list, { name: 'X', phone: '050 123 4567' })?.id).toBe('a');
    expect(alreadyInBase(list, { phone: '+971 55 765 4321' })?.id).toBe('b');
    expect(alreadyInBase(list, { name: 'al quoz auto-parts' })?.id).toBe('a');
    expect(alreadyInBase(list, { name: 'Gone Ltd' })).toBeUndefined();
    // Itself is not a twin of itself.
    expect(alreadyInBase(list, { id: 'a', name: 'Al Quoz Auto Parts', phone: '0501234567' })).toBeUndefined();
    expect(alreadyInBase(list, { name: 'Al' })).toBeUndefined();
  });
});

describe('a seller’s name as one seller (v0.50.2)', () => {
  it('leaves out the company’s own words and the signs', () => {
    const k = sellerKey('AL MAROOF AUTO SPARE PARTS TRADING L.L.C');
    expect(k).toBe('almaroofautospareparts');
    expect(sellerKey('Al Maroof Auto Spare Parts Trading LLC')).toBe(k);
    expect(sellerKey('AL MAROOF AUTO SPARE PARTS TR. L.L.C.')).toBe(k);
    expect(sellerKey('Gulf Star FZE')).toBe('gulfstar');
    expect(sellerKey('Al Quoz Auto Parts')).not.toBe(k);
  });
});
