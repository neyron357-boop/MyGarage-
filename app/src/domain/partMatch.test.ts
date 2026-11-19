import { describe, expect, it } from 'vitest';
import { carWordsOf, partName, partSimilarity, sameWord } from './partMatch';

const cars = new Set(['canter', 'fuso', 'pajero', 'nissan', 'pathfinder', 'toyota']);
const sim = (a: string, b: string) => partSimilarity(partName(a, cars), partName(b, cars));

describe('what a part’s name says the part is', () => {
  it('leaves out brands, quality, years, sizes and quantities; sets the car aside; one word for one thing', () => {
    expect(partName('CANTER TALLLAMP COVER 96 -2013', cars)).toEqual({ tokens: ['taillight', 'cover'], pos: [], cars: ['canter'] });
    expect(partName('REAR STOP LIGHT LEFT & RIGHT', cars)).toEqual({ tokens: ['taillight'], pos: ['rear'], cars: [] });
    expect(partName('MUD FLAP 2.5 TON').tokens).toEqual(['mudflap']);
    expect(partName('MUD GUARD REAR LEFT RIGHT').tokens).toEqual(['mudflap']);
    expect(partName('FEBEST PULLY 14 FEB').tokens).toEqual(['pulley']);
    expect(partName('FRONT SHOCK ABSORBER LEFT & RIGHT KYB')).toMatchObject({ tokens: ['shock'], pos: ['front'] });
    expect(partName('GENUINE NISSAN MATIC R ATF (1LTR)', cars).cars).toEqual(['nissan']);
    // A Russian line through the dictionary's English name.
    expect(partName('колодки тормозные передние').tokens).toEqual(['pad']);
  });

  it('a typo within a letter of a word (two in a long one)', () => {
    expect(sameWord('pully', 'pulley')).toBe(true);
    expect(sameWord('deferntial', 'differential')).toBe(false);
    expect(partName('FRONT DEFERNTIAL RIGHT SEAL').tokens).toEqual(['differential', 'seal']);
    expect(sameWord('seal', 'sell')).toBe(true);
    expect(sameWord('oil', 'air')).toBe(false);
  });
});

describe('how sure two names are one part', () => {
  it('the same part under other words', () => {
    expect(sim('MUD FLAP 2.5 TON', 'MUD GUARD REAR LEFT RIGHT')).toBe(1);
    expect(sim('FEBEST PULLY 14 FEB', 'TENSIONER PULLEY')).toBe(1);
    expect(sim('CANTER TALLLAMP COVER 96 -2013', 'REAR STOP LIGHT LEFT & RIGHT')).toBe(0.85);
    expect(sim('BRAKE PAD SET FRONT', 'FRONT BRAKE PADS ORIGINAL')).toBe(1);
    expect(sim('AIR FILTER ELEMENT', 'AIR FILTER')).toBe(1);
  });

  it('a part that shares a word with another is only likely; two of one kind or two sides are not one', () => {
    expect(sim('PATHFINDER BELT TENSIONER FIX', 'TENSIONER PULLEY')).toBe(0.5);
    expect(sim('OIL FILTER', 'AIR FILTER')).toBe(0.15);
    expect(sim('FRONT BRAKE PADS', 'REAR BRAKE PADS')).toBe(0);
    expect(sim('LOWER ARM', 'UPPER ARM BUSHING')).toBe(0);
    expect(sim('ENGINE OIL', 'OIL FILTER')).toBeLessThan(0.5);
    expect(sim('WIPER BLADE', 'OIL FILTER')).toBe(0);
  });
});

describe('a car’s words', () => {
  it('are its make’s and its model’s, Mitsubishi Fuso one maker', () => {
    expect(carWordsOf('Fuso', 'Canter')).toEqual(['fuso', 'mitsubishi', 'canter']);
    expect(carWordsOf('Mitsubishi', 'L200')).toEqual(['mitsubishi', 'fuso', 'l200']);
    expect(carWordsOf('Hyundai', 'H-1 / Starex')).toEqual(['hyundai', 'starex']);
  });
});
