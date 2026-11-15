import { describe, expect, it } from 'vitest';
import { checkDigitOk, fixByCheckDigit, isVin, makeMatches, mulkiyaYear, pickVin, vinChars, vinCheckDigit, vinMaker, vinsInText, vinYear, voteVin } from './vin';

const NOW = new Date('2026-11-15T10:00:00Z');
/** The textbook VIN (its check digit is X). */
const US = '1M8GDM9AXKP042788';
/** A VIN with its check digit set right / set wrong. */
const withCheck = (v: string) => v.slice(0, 8) + vinCheckDigit(v) + v.slice(9);
const withoutCheck = (v: string) => {
  const ok = vinCheckDigit(v);
  return v.slice(0, 8) + (ok === '0' ? '1' : '0') + v.slice(9);
};
/** A Gulf-spec Toyota-like VIN that does not add up (made for elsewhere: no check digit). */
const GCC = withoutCheck('JTMHV05J004123456');

describe('a VIN', () => {
  it('is 17 VIN characters, its last four digits, and adds up by its 9th', () => {
    expect(vinCheckDigit(US)).toBe('X');
    expect(checkDigitOk(US)).toBe(true);
    expect(checkDigitOk('11111111111111111')).toBe(true);
    expect(isVin('1M8GDM9AXKP04278')).toBe(false); // 16
    expect(isVin('1M8GDM9AXKP0427B8')).toBe(false); // a letter among the last four
    expect(isVin('1M8GDM9AXKPO42788')).toBe(false); // an O is never in a VIN
    expect(checkDigitOk(GCC)).toBe(false);
    expect(isVin(GCC)).toBe(true);
  });

  it('is read in its own characters: O and Q are 0, I is 1, no spaces or marks', () => {
    expect(vinChars('im8 gdm9-axkp·o42788')).toBe(US);
    expect(vinChars('JTMHV05J-QO4123456')).toBe('JTMHV05J004123456');
  });

  it('is found in the text read off a photo — whole, split by spaces, glued to its label — and nothing made up', () => {
    expect(vinsInText(`CHASSIS NO. ${US}\nMODEL 2016`)).toEqual([US]);
    expect(vinsInText(`Chassis No: ${US.slice(0, 8)} ${US.slice(8)}`)).toEqual([US]);
    expect(vinsInText(`VIN:${US}`)).toEqual([US]);
    expect(vinsInText(`ChassisNo.${US}`)).toEqual([US]);
    expect(vinsInText('IM8GDM9AXKPO42788')).toEqual([US]);
    // A label and a VIN beside it are not cut into a "VIN" across the words.
    expect(vinsInText(`TRAFFIC CODE 12345678 CHASSIS ${US} ENG 2TR1234567`)).toEqual([US]);
    // Text with no VIN: none.
    expect(vinsInText('MOTOR VEHICLES AND LICENSING AGENCY\nEXPIRY DATE 12/03/2027')).toEqual([]);
  });
});

describe('a misread VIN put right by its check digit', () => {
  it('only when one look-alike swap makes it add up', () => {
    // G read as 6 in the 4th place: one swap adds it up again (the check digit decides between the look-alikes).
    const broken = US.slice(0, 3) + '6' + US.slice(4);
    const fixed = fixByCheckDigit(broken);
    expect(fixed === undefined || checkDigitOk(fixed)).toBe(true);
    if (fixed) expect([...fixed].filter((c, i) => c !== broken[i])).toHaveLength(1);
    // A VIN that adds up is not "fixed"; nor is something that is not a VIN.
    expect(fixByCheckDigit(US)).toBeUndefined();
    expect(fixByCheckDigit('NOT A VIN')).toBeUndefined();
  });
});

describe('several misreads of one VIN voted into one', () => {
  it('each place takes the character the reads agree on — or the one they were surest of', () => {
    const a = US.slice(0, 2) + '0' + US.slice(3); // 3rd wrong
    const b = US.slice(0, 11) + 'R' + US.slice(12); // 12th wrong
    const c = US.slice(0, 15) + '3' + US.slice(16); // 16th wrong
    expect(voteVin([{ vin: a }, { vin: b }, { vin: c }])).toBe(US);
    // Two reads, one character apart: the surer read wins it.
    const low = Array(17).fill(90);
    low[11] = 30;
    expect(voteVin([{ vin: b, conf: low }, { vin: US, conf: Array(17).fill(90) }])).toBe(US);
    // Another VIN on the photo takes no part; one read alone is no vote.
    const other = withCheck('JTMHV05JXG4123456');
    expect(voteVin([{ vin: a }, { vin: b }, { vin: c }, { vin: other }])).toBe(US);
    expect(voteVin([{ vin: US }])).toBeUndefined();
  });
});

describe('what a VIN tells', () => {
  it('the model year — the latest its 10th may be, not past next year', () => {
    expect(vinYear(US, NOW)).toBe(2019); // K: 1989 or 2019
    expect(vinYear(withCheck('JTMHV05JXG4123456'), NOW)).toBe(2016); // G
    expect(vinYear(withCheck('JTMHV05JXT4123456'), NOW)).toBe(2026); // T: 2026, not 1996
    expect(vinYear(withCheck('JTMHV05JX54123456'), NOW)).toBe(2005); // 5: 2005 (2035 is not yet)
    expect(vinYear(GCC, NOW)).toBeUndefined(); // 10th "0": no year there
  });

  it('the maker — and whether it is the car’s', () => {
    expect(vinMaker('JTMHV05J004123456')).toBe('toyota');
    expect(makeMatches('JTMHV05J004123456', 'Toyota')).toBe(true);
    expect(makeMatches('JTHBK1GG0E2123456', 'Lexus')).toBe(true);
    expect(makeMatches('JTMHV05J004123456', 'Nissan')).toBe(false);
    expect(makeMatches('WDD2050421R123456', 'Mercedes-Benz')).toBe(true);
    expect(makeMatches('KMHCT41BAGU123456', 'Hyundai')).toBe(true);
    expect(makeMatches('1GNSKBKC5KR123456', 'GMC')).toBe(true);
    expect(makeMatches('JTMHV05J004123456', '')).toBeUndefined();
    expect(makeMatches('X7LLSRB2HAH123456', 'Toyota')).toBeUndefined();
  });

  it('the Mulkiya’s printed model year — only beside its label', () => {
    expect(mulkiyaYear('Vehicle Type: SUV\nModel 2016\nOrigin JAPAN\nExpiry Date 12/03/2027', NOW)).toBe(2016);
    expect(mulkiyaYear('Model:\nOrigin\n2016', NOW)).toBe(2016);
    expect(mulkiyaYear('M0DEL 2019', NOW)).toBe(2019);
    expect(mulkiyaYear('Reg. Date 2024 Exp. Date 2027 Ins. 2026', NOW)).toBeUndefined();
    expect(mulkiyaYear('Model 2031', NOW)).toBeUndefined(); // not yet made
  });
});

/** The same VIN read twice off one photo (two ways of reading it). */
const twice = (vin: string, source = 'plate') => [
  { vin, source },
  { vin, source },
];

describe('the VIN out of all that was read', () => {
  it('is sure by its check digit read so twice, or by two photos reading the same', () => {
    const two = pickVin(twice(US), [], { make: 'Ford' }, NOW);
    expect([two.vin, two.sure, two.why]).toEqual([US, true, 'check']);
    // Read once only: a lucky misreading may add up too.
    const once = pickVin([{ vin: US, source: 'plate' }], [], { make: 'Ford' }, NOW);
    expect([once.vin, once.sure]).toEqual([US, false]);
    const gccOne = pickVin([{ vin: GCC, source: 'plate' }], [], { make: 'Toyota' }, NOW);
    expect([gccOne.vin, gccOne.sure]).toEqual([GCC, false]);
    const gccTwo = pickVin(
      [
        { vin: GCC, source: 'plate' },
        { vin: GCC, source: 'mulkiya-back' },
      ],
      [],
      { make: 'Toyota' },
      NOW,
    );
    expect([gccTwo.sure, gccTwo.why, gccTwo.makeOk]).toEqual([true, 'photos', true]);
  });

  it('is not sure when its maker is another make, or when another VIN proves itself too', () => {
    const ford = withCheck('1FTFW1ETXDFC10312');
    expect(checkDigitOk(ford)).toBe(true);
    expect(pickVin(twice(ford), [], { make: 'Toyota' }, NOW)).toMatchObject({ sure: false, makeOk: false, maker: 'ford' });
    expect(pickVin(twice(ford), [], { make: 'Ford' }, NOW).sure).toBe(true);
    const other = withCheck('JTMHV05JXG4123456');
    expect(pickVin([...twice(US), ...twice(other, 'mulkiya')], [], {}, NOW).sure).toBe(false);
  });

  it('marks the places other reads of it disagree on — not those of a different VIN altogether', () => {
    const misread = US.slice(0, 5) + 'N' + US.slice(6);
    const p = pickVin([...twice(US), { vin: misread, source: 'plate' }, { vin: withCheck('JTMHV05JXG4123456'), source: 'plate' }], [], {}, NOW);
    expect([p.vin, p.sure, p.doubt]).toEqual([US, true, [5]]);
  });

  it('offers a VIN fitted to its check digit before the misreading it was fitted from', () => {
    const read = US.slice(0, 3) + '6' + US.slice(4);
    const p = pickVin([...twice(read), ...[1, 2].map(() => ({ vin: US, source: 'plate', from: read }))], [], {}, NOW);
    expect([p.vin, p.sure, p.doubt]).toEqual([US, false, [3]]);
  });

  it('a VIN fixed by its check digit needs a second photo, and shows where it was fixed', () => {
    const read = US.slice(0, 3) + '6' + US.slice(4);
    const alone = pickVin([{ vin: US, source: 'plate', from: read }], [], {}, NOW);
    expect([alone.sure, alone.doubt]).toEqual([false, [3]]);
    const backed = pickVin(
      [
        { vin: US, source: 'plate', from: read },
        { vin: US, source: 'mulkiya' },
      ],
      [],
      {},
      NOW,
    );
    expect(backed.sure).toBe(true);
  });

  it('the year: the Mulkiya’s, read the same more than once; else a sure VIN’s own', () => {
    const v = withCheck('JTMHV05JXG4123456'); // 2016
    expect(pickVin([{ vin: v, source: 'plate' }], [2016, 2016], {}, NOW)).toMatchObject({ year: 2016, yearSure: true });
    expect(pickVin(twice(v), [], {}, NOW)).toMatchObject({ year: 2016, yearSure: true });
    // Read once, and just what a sure VIN says of itself: two things that agree.
    expect(pickVin(twice(v), [2016], {}, NOW)).toMatchObject({ year: 2016, yearSure: true });
    // …but not when the VIN is not sure.
    const unsure = pickVin([{ vin: v, source: 'plate', from: v.slice(0, 3) + '6' + v.slice(4) }], [2016], {}, NOW);
    expect([unsure.sure, unsure.yearSure]).toEqual([false, false]);
    // Read once only, or read two ways, or not what the VIN says: to be looked at.
    expect(pickVin([{ vin: GCC, source: 'plate' }], [2016], {}, NOW)).toMatchObject({ year: 2016, yearSure: false });
    expect(pickVin([{ vin: GCC, source: 'plate' }], [2016, 2018], {}, NOW)).toMatchObject({ yearSure: false });
    expect(pickVin(twice(v), [2017, 2017], {}, NOW)).toMatchObject({ year: 2017, yearSure: false });
    // A VIN made for elsewhere (no check digit) says no year of its own.
    expect(pickVin([{ vin: GCC, source: 'a' }, { vin: GCC, source: 'b' }], [], {}, NOW)).toMatchObject({ sure: true, year: undefined });
  });
});
