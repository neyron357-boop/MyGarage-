import { describe, expect, it } from 'vitest';
import { mergeVinCar, vinCarLocal, vpicCar } from './vinDecode';

const NOW = new Date('2026-11-24T08:00:00Z');
// A VIN made to the North-American rule (its check digit adds up): Honda, 2003.
const HONDA = '1HGCM82633A004352';
// A Japanese export VIN without a valid check digit: its 10th character is not proven a year.
const TOYOTA_JP = 'JTMHV05J604123456';

describe('what car a VIN is — without AI (v0.81)', () => {
  it('the app’s own table: the maker by the first characters; the year only when the check digit adds up', () => {
    expect(vinCarLocal(HONDA, NOW)).toEqual({ make: 'Honda', year: 2003 });
    expect(vinCarLocal(TOYOTA_JP, NOW)).toEqual({ make: 'Toyota' });
    expect(vinCarLocal('NOT A VIN', NOW)).toEqual({});
  });

  it('the NHTSA decoder’s answer: what it decoded; a VIN with errors — the maker only; a wrong check digit — no year', () => {
    const ok = { Results: [{ Make: 'HONDA', Model: 'Accord', ModelYear: '2003', ErrorCode: '0' }] };
    expect(vpicCar(ok, NOW)).toEqual({ make: 'Honda', model: 'Accord', year: 2003 });
    const checkWrong = { Results: [{ Make: 'TOYOTA', Model: 'Land Cruiser', ModelYear: '2014', ErrorCode: '1' }] };
    expect(vpicCar(checkWrong, NOW)).toEqual({ make: 'Toyota', model: 'Land Cruiser' });
    const broken = { Results: [{ Make: 'NISSAN', Model: 'Patrol', ModelYear: '2018', ErrorCode: '5,6' }] };
    expect(vpicCar(broken, NOW)).toEqual({ make: 'Nissan' });
    expect(vpicCar({ Results: [{ Make: '', Model: '', ModelYear: '', ErrorCode: '8' }] }, NOW)).toEqual({});
    expect(vpicCar(null, NOW)).toEqual({});
    // A year in the future is not a year.
    expect(vpicCar({ Results: [{ Make: 'KIA', ModelYear: '2031', ErrorCode: '0' }] }, NOW)).toEqual({ make: 'Kia' });
  });

  it('the two together: the decoder’s word where it gave one — never another maker than the VIN’s own code', () => {
    expect(mergeVinCar({ make: 'Toyota' }, { make: 'Toyota', model: 'Camry', year: 2019 })).toEqual({ make: 'Toyota', model: 'Camry', year: 2019 });
    expect(mergeVinCar({ make: 'Honda', year: 2003 }, {})).toEqual({ make: 'Honda', year: 2003 });
    expect(mergeVinCar({ make: 'Toyota' }, { make: 'Ford', model: 'Focus' })).toEqual({ make: 'Toyota' });
    expect(mergeVinCar({}, { make: 'Lexus', model: 'LX' })).toEqual({ make: 'Lexus', model: 'LX' });
  });
});
