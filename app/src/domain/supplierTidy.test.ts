import { describe, expect, it } from 'vitest';
import { arabicToEnglish, englishName, guessFromName, kindsOf, regionOf, tidyOf, unknownParts } from './supplierTidy';
import type { Supplier } from './types';

const book = (contact: Record<string, string>) => ({ id: 'CT-1', contact: Object.fromEntries(Object.entries(contact).map(([k, v]) => [k, { v }])) });
const supplier = (extra: Partial<Supplier>): Supplier => ({ id: 's', name: 'X', createdAt: '2026-11-20T00:00:00Z', ...extra });

describe('the supplier base in order (v0.60)', () => {
  it('finds the region: the base’s emirate and area, an area in the address, a landline’s code', () => {
    expect(regionOf({ name: 'A', book: book({ Эмират: 'Sharjah', Геозона: '3 · Sharjah Industrial / BMW Road' }) })).toEqual({ emirate: 'SHJ', area: 'BMW Road' });
    expect(regionOf({ name: 'A', address: 'Al Quoz Industrial Area 3, Dubai' })).toEqual({ emirate: 'DXB', area: 'Al Quoz' });
    expect(regionOf({ name: 'A', address: 'Industrial Area 11' })).toEqual({ emirate: 'SHJ', area: 'Industrial Area 11' });
    expect(regionOf({ name: 'A', address: 'Mussafah M-12' })).toEqual({ emirate: 'AUH', area: 'Mussafah' });
    expect(regionOf({ name: 'A', address: 'الصناعية 6 الشارقة' })).toEqual({ emirate: 'SHJ', area: 'Industrial Area 6' });
    expect(regionOf({ name: 'A', phone: '+97142223344' })).toEqual({ emirate: 'DXB' });
    // 06 is three emirates: not guessed
    expect(regionOf({ name: 'A', phone: '+97165556677' })).toEqual({});
    // a mobile says nothing
    expect(regionOf({ name: 'A', phone: '+971501234567' })).toEqual({});
    // the earliest emirate named
    expect(regionOf({ name: 'A', address: 'Dubai, near the Sharjah border' })).toEqual({ emirate: 'DXB' });
  });

  it('puts a name in English: the English beside the Arabic, else the Arabic by the trade’s words', () => {
    expect(englishName('Test Motors LLC')).toBe('Test Motors LLC');
    expect(englishName('Star Auto | ستار اوتو')).toBe('Star Auto');
    expect(englishName('Star Auto ستار اوتو')).toBe('Star Auto');
    expect(englishName('البركة لقطع غيار السيارات الاصلية')).toBe('Al Barakah Genuine Auto Spare Parts');
    expect(englishName('مؤسسة النور لقطع غيار السيارات المستعملة')).toBe('Al Noor Used Auto Spare Parts Est.');
    expect(englishName('الخليج لقطع غيار تويوتا ولكزس ذ.م.م')).toBe('Al Khaleej Toyota Lexus Spare Parts LLC');
    expect(englishName('شركة الامارات للزيوت ش.ذ.م.م')).toBe('Emirates Oils Co. LLC');
    expect(arabicToEnglish('محمد سعيد للبطاريات والاطارات')).toBe('Mohammed Saeed Batteries Tyres');
    // a word the dictionary does not know is spelled in Latin letters
    expect(englishName('هاواك لقطع غيار السيارات')).toBe('Hawak Auto Spare Parts');
  });

  it('guesses what a shop sells and its makes from its name — only what its words say', () => {
    expect(guessFromName({ name: 'Al Noor Batteries & Tyres Trading' })).toEqual({ parts: 'Batteries, Tyres & wheels' });
    expect(guessFromName({ name: 'Korean Star Auto Spare Parts' })).toEqual({ parts: 'Spare parts', makes: ['Hyundai', 'Kia'] });
    expect(guessFromName({ name: 'Desert Used Auto Parts' })).toEqual({ parts: 'Used parts', condition: 'used' });
    expect(guessFromName({ name: 'Al Fajr Toyota Genuine Parts' })).toEqual({ parts: 'Spare parts', makes: ['Toyota'], condition: 'new' });
    // a proper name that only looks like a word: «First Key» is no locksmith, «Nikiah» no Kia
    expect(guessFromName({ name: 'First Key Trading' }).parts).toBeUndefined();
    expect(guessFromName({ name: 'Nikiah General Trading' })).toEqual({});
    // the Arabic counts too
    expect(guessFromName({ name: 'Al Waha', nameAr: 'الواحة لزجاج السيارات' }).parts).toBe('Glass');
  });

  it('knows a «what it sells» that says nothing, and reads the kinds of a supplier', () => {
    for (const v of [undefined, '', 'неизвестно', 'Unknown', '—', '?', 'N/A', 'нет данных']) expect(unknownParts(v)).toBe(true);
    expect(unknownParts('Двигатели')).toBe(false);
    expect(kindsOf({ name: 'Al Sahra Auto', parts: 'Радиаторы, тормоза, АКБ' })).toEqual(['ac', 'suspension', 'batteries']);
  });

  it('changes only what it should: the name (Arabic kept), and guesses only where nothing was known — marked', () => {
    expect(tidyOf(supplier({ name: 'Test Motors', parts: 'Engines', makes: ['Toyota'] }))).toBeNull();
    expect(tidyOf(supplier({ name: 'البركة لقطع غيار السيارات المستعملة', parts: 'неизвестно' }))).toEqual({
      name: 'Al Barakah Used Auto Spare Parts',
      nameAr: 'البركة لقطع غيار السيارات المستعملة',
      parts: 'Used parts',
      condition: 'used',
      guessed: ['parts', 'condition'],
    });
    // the manager's own words stay
    expect(tidyOf(supplier({ name: 'Korean Star Auto Spare Parts', parts: 'Hyundai engines' }))).toEqual({ makes: ['Hyundai', 'Kia'], guessed: ['makes'] });
    // a contractor's «what it sells» is not guessed
    expect(tidyOf(supplier({ name: 'Al Noor Radiators Repair', service: true }))).toBeNull();
  });
});
