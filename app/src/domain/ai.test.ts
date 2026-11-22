import { describe, expect, it } from 'vitest';
import { boughtBySpec, carKnown, editDistance, findNote, nameFix, onlyTypos, provenNumber, soleNumber, vinFill } from './ai';

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

describe('what the maker’s catalogue says of a number (v0.55)', () => {
  const seen = (...hosts: string[]) => hosts.map((h) => `https://${h}/p`);
  it('a number on this car’s diagram is proven by that alone; two such — neither', () => {
    expect(provenNumber({ search: 'web', numbers: [{ number: '04465-60280', seen: seen('megazip.net'), fits: true }, { number: '04465-60320', seen: seen('megazip.net') }] }, 'Toyota')).toBe('04465-60280');
    // The variants of a part (left and right, petrol and diesel), each on the diagram: a person picks.
    expect(provenNumber({ search: 'web', numbers: [{ number: '48068-59135', seen: [], fits: true }, { number: '48069-59125', seen: [], fits: true }] }, 'Toyota')).toBeUndefined();
    // On the diagram, but not shaped like the maker's numbers: not written.
    expect(provenNumber({ search: 'web', numbers: [{ number: 'ABC', seen: [], fits: true }] }, 'Toyota')).toBeUndefined();
    // A guess is a guess, whatever it says.
    expect(provenNumber({ search: 'model', numbers: [{ number: '04465-60280', seen: [], fits: true }] }, 'Toyota')).toBeUndefined();
  });

  it('written with nobody looking: the one that came — or the one on this car’s diagram, whatever else came', () => {
    const fit = { number: '04465-60280', seen: seen('megazip.net'), fits: true };
    const other = { number: '04465-60320', seen: seen('partsouq.com') };
    expect(soleNumber({ search: 'web', numbers: [fit, other] }, 'Toyota')).toBe('04465-60280');
    // Proven by two catalogues only (no diagram of this car): another number seen anywhere is a rival.
    const two = { number: '04465-33471', seen: seen('amayama.com', 'megazip.net') };
    expect(soleNumber({ search: 'web', numbers: [two] }, 'Toyota')).toBe('04465-33471');
    expect(soleNumber({ search: 'web', numbers: [two, { number: '04465-06090', seen: seen('a.com') }] }, 'Toyota')).toBeUndefined();
    expect(soleNumber({ search: 'web', numbers: [two, { number: '04465-06090', seen: [] }] }, 'Toyota')).toBe('04465-33471');
    expect(soleNumber({ search: 'web', numbers: [other] }, 'Toyota')).toBeUndefined();
  });

  it('a car to look a part up for has its make or its VIN; tyres and fluids are bought by their kind, not by a number', () => {
    expect([carKnown({ make: 'Toyota' }), carKnown({ make: ' ', vin: 'JTDBR42E39J016456' }), carKnown({ make: '', vin: 'short' }), carKnown(undefined)]).toEqual([true, true, false, false]);
    for (const n of ['2 FRONT TYRES', 'ENGINE OIL 5W30', 'COOLANT', 'SUZUKI 1L ATF (GEAR OIL)', 'BRAKE FLUID', 'AC GAS', 'масло моторное', 'антифриз']) expect([n, boughtBySpec(n)]).toEqual([n, true]);
    for (const n of ['OIL FILTER', 'OIL PUMP', 'TYRE VALVE SENSOR 433', 'COOLANT HOSE', 'BRAKE FLUID RESERVOIR CAP', 'FRONT BRAKE PADS', 'AIR CLEANER', 'GAS SPRING']) expect([n, boughtBySpec(n)]).toEqual([n, false]);
  });
});

describe('the note on what was found (v0.64)', () => {
  const n = (number: string, x: Partial<{ seen: string[]; garage: number; fits: boolean; replaces: string[] }> = {}) => ({ number, seen: [], ...x });
  it('the AI’s own line first, as said', () => {
    expect(findNote({ search: 'web', numbers: [n('04465-12610')], note: '  Two variants by build date:  check the VIN. ' })).toBe('Two variants by build date: check the VIN.');
  });
  it('nothing found — no note', () => {
    expect(findNote({ search: 'web', numbers: [], note: 'x' })).toBeUndefined();
  });
  it('else the app’s own: the catalogue’s diagram, a newer number for an older one, the others', () => {
    expect(findNote({ search: 'web', numbers: [n('04465-60320', { fits: true, replaces: ['04465-60280'] }), n('04465-0K290')] })).toBe(
      "04465-60320 is on the maker's diagram for this model and years — not the engine or the trim. 04465-60320 supersedes 04465-60280 — the same part.",
    );
    expect(findNote({ search: 'web', numbers: [n('04465-60320', { fits: true }), n('04465-0K290')] })).toBe("04465-60320 is on the maker's diagram for this model and years — not the engine or the trim. The others are not on its diagram.");
    expect(findNote({ search: 'web', numbers: [n('A', { fits: true }), n('B', { fits: true })] })).toBe("2 numbers on the model's diagram — variants: check the VIN or build date.");
  });
  it('how sure: two catalogues, one place only, the AI’s memory, the garage’s own jobs', () => {
    // v0.65: two mirrors of one catalogue are one source; two sources say the number exists, not that it fits.
    expect(findNote({ search: 'web', numbers: [n('04465-12610', { seen: ['https://www.amayama.com/p/1', 'https://megazip.net/p/2'] }), n('04465-02220')] })).toBe('None is listed twice — check the VIN with the supplier.');
    expect(findNote({ search: 'web', numbers: [n('04465-12610', { seen: ['https://www.amayama.com/p/1', 'https://www.toyota-parts.example/p/2'] }), n('04465-02220')] })).toBe(
      '04465-12610 is listed by several sources — it exists; its fitment is not proven. The others are seen once or not at all.',
    );
    expect(findNote({ search: 'web', numbers: [n('04465-12610', { seen: ['https://www.amayama.com/p/1'] })] })).toBe('Seen in one place only — confirm with the supplier.');
    expect(findNote({ search: 'model', numbers: [n('04465-12610')] })).toBe("From the AI's memory, not checked online — confirm by VIN before ordering.");
    expect(findNote({ search: 'garage', numbers: [n('90915-YZZE1', { garage: 2 })] })).toBe('Fitted on a car of this model before.');
  });
});
