import { describe, expect, it } from 'vitest';
import { editDistance, nameFix, onlyTypos, provenNumber, vinFill } from './ai';

const NOW = new Date('2026-11-19T08:00:00Z');
const VIN = 'JTDBR42E39J016456'; // a Toyota (JT…), model year 2009 (10th: 9)
const empty = { make: '', model: '' };

describe('a VIN read by the AI', () => {
  const ai = { vin: VIN, make: 'TOYOTA', model: 'corolla', year: 2009, engine: '1.8L 4-cyl', body: 'sedan', confidence: 0.9, facts: { make: 'TOYOTA', year: '2009' } };
  it('fills what the card is missing, in the catalogue’s spelling', () => {
    expect(vinFill(empty, VIN, ai, NOW)).toEqual({ make: 'Toyota', model: 'Corolla', year: 2009, engine: '1.8L 4-cyl', type: 'sedan' });
  });
  it('never over what is typed; the same make typed — the rest filled', () => {
    expect(vinFill({ make: 'Toyota', model: 'Auris', year: 2010, engine: '2.0', type: 'suv' }, VIN, ai, NOW)).toEqual({});
    expect(vinFill({ make: 'toyota', model: '' }, VIN, ai, NOW)).toEqual({ model: 'Corolla', year: 2009, engine: '1.8L 4-cyl', type: 'sedan' });
  });
  it('takes nothing that disagrees with the VIN itself', () => {
    // A make not the VIN's maker (JT… is Toyota's).
    expect(vinFill(empty, VIN, { ...ai, make: 'Nissan' }, NOW)).toEqual({});
    // The card says another make: one of them is wrong — the model is not taken either.
    expect(vinFill({ make: 'Lexus', model: '' }, VIN, ai, NOW)).toEqual({});
    // A year the 10th character cannot be, or not the official decoder’s.
    expect(vinFill(empty, VIN, { ...ai, year: 2012 }, NOW).year).toBeUndefined();
    expect(vinFill(empty, VIN, { ...ai, year: 2009, facts: { year: '2010' } }, NOW).year).toBeUndefined();
    expect(vinFill(empty, VIN, { ...ai, year: 1979 }, NOW).year).toBeUndefined();
    // Not sure enough, another VIN, not a VIN, a body not one of the app's.
    expect(vinFill(empty, VIN, { ...ai, confidence: 0.4 }, NOW)).toEqual({});
    expect(vinFill(empty, VIN, { ...ai, vin: 'JTDBR42E39J016457' }, NOW)).toEqual({});
    expect(vinFill(empty, 'JTDBR42E39J01645', { ...ai, vin: 'JTDBR42E39J01645' }, NOW)).toEqual({});
    expect(vinFill(empty, VIN, { ...ai, body: 'hatchback' }, NOW).type).toBeUndefined();
  });
});

describe('a part’s name looked at by the AI', () => {
  it('counts a swap of two letters as one mistake', () => {
    expect(editDistance('ПЕЕРДНИЕ', 'ПЕРЕДНИЕ')).toBe(1);
    expect(editDistance('ALTERNATER', 'ALTERNATOR')).toBe(1);
  });
  it('only typing mistakes: the same words in the same order, numbers as typed', () => {
    expect(onlyTypos('КОЛОДКИ ТОРМАЗНЫЕ ПЕРДНИЕ', 'КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ')).toBe(true);
    expect(onlyTypos('ALTERNATER BELT', 'ALTERNATOR BELT')).toBe(true);
    expect(onlyTypos('PADS', 'FRONT BRAKE PADS')).toBe(false);
    expect(onlyTypos('OIL FILTER', 'AIR FILTER')).toBe(false);
    expect(onlyTypos('TYRE 265/65 R17', 'TYRE 265/60 R17')).toBe(false);
  });
  it('puts the spelling right when sure; the English name for a name typed in Russian', () => {
    const r = nameFix('колодки тормазные пердние', { fixed: 'колодки тормозные передние', english: 'Front brake pads', isPart: true, confidence: 0.95 }, false);
    expect(r).toEqual({ title: 'КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', english: 'FRONT BRAKE PADS' });
    // Typed in English: the spelling only; an English name already there stays.
    expect(nameFix('alternater belt', { fixed: 'alternator belt', english: 'ALTERNATOR BELT', isPart: true, confidence: 0.98 }, false)).toEqual({ title: 'ALTERNATOR BELT' });
    expect(nameFix('колодки', { fixed: 'колодки', english: 'BRAKE PADS', isPart: true, confidence: 0.9 }, true)).toEqual({});
  });
  it('changes nothing it is not sure of, or that is more than a typing mistake', () => {
    expect(nameFix('alternater', { fixed: 'alternator', english: 'ALTERNATOR', isPart: true, confidence: 0.5 }, false)).toEqual({});
    expect(nameFix('blah', { fixed: 'blah', english: 'BLAH', isPart: false, confidence: 0.9 }, false)).toEqual({});
    expect(nameFix('pads', { fixed: 'front brake pads', english: 'FRONT BRAKE PADS', isPart: true, confidence: 0.9 }, false)).toEqual({});
  });
});

describe('a part’s number found by the AI', () => {
  const seen = (...hosts: string[]) => hosts.map((h) => `https://www.${h}/p/1`);
  it('written itself only when seen in two catalogues on the web', () => {
    expect(provenNumber({ search: 'web', numbers: [{ number: '04465-33471', seen: seen('amayama.com', 'megazip.net') }] })).toBe('04465-33471');
    expect(provenNumber({ search: 'web', numbers: [{ number: '04465-33471', seen: [...seen('amayama.com'), 'https://amayama.com/p/2'] }] })).toBeUndefined();
    expect(provenNumber({ search: 'model', numbers: [{ number: '04465-33471', seen: seen('a.com', 'b.com') }] })).toBeUndefined();
    // Two proven numbers (two variants): the manager picks.
    expect(provenNumber({ search: 'web', numbers: [{ number: 'A1', seen: seen('a.com', 'b.com') }, { number: 'B2', seen: seen('a.com', 'b.com') }] })).toBeUndefined();
  });
});
