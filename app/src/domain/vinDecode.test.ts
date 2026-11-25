import { describe, expect, it } from 'vitest';
import { mergeVinCar, stemCar, vinCarLocal, vinStem, vpicCar } from './vinDecode';

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

describe('v0.88: what the garage itself knows of a VIN — its other cars of the same maker and model code', () => {
  // A Toyota built in Indonesia: the AI named it «Land Cruiser»; the owner put it right — «Veloz».
  const VELOZ = 'MHFAB1BY4P3069309';
  const veloz = { id: 'v1', vin: VELOZ, make: 'Toyota', model: 'Veloz', engine: '1.5L 4-cyl', type: 'mpv' };
  it('the stem: the first eight characters of a VIN, none of a broken one', () => {
    expect(vinStem(VELOZ)).toBe('MHFAB1BY');
    expect(vinStem('mhfab1by4p3069309')).toBe('MHFAB1BY');
    expect(vinStem('MHFAB1BY4P306930')).toBe('');
  });
  it('another car of the same stem: its make and model as a person wrote them; engine and body where they agree', () => {
    expect(stemCar('MHFAB1BY0R3011111', [veloz])).toEqual({ make: 'Toyota', model: 'Veloz', engine: '1.5L 4-cyl', type: 'mpv' });
    // Not the car itself; not another stem.
    expect(stemCar(VELOZ, [veloz], 'v1')).toBeUndefined();
    expect(stemCar('MHFAB1BZ0R3011111', [veloz])).toBeUndefined();
    // Two models under one stem: neither. Engines that differ: no engine.
    expect(stemCar('MHFAB1BY0R3011111', [veloz, { ...veloz, id: 'v2', model: 'Avanza' }])).toBeUndefined();
    expect(stemCar('MHFAB1BY0R3011111', [veloz, { ...veloz, id: 'v2', engine: '1.3L' }])).toEqual({ make: 'Toyota', model: 'Veloz', type: 'mpv' });
  });
  it('not the AI’s word: a model the AI filled is not taken — until a person put it right', () => {
    const byAi = { ...veloz, model: 'Land Cruiser', vinAi: { filled: ['model', 'year'] } };
    expect(stemCar('MHFAB1BY0R3011111', [byAi])).toBeUndefined();
    expect(stemCar('MHFAB1BY0R3011111', [{ ...byAi, model: 'Veloz', vinAi: { filled: ['year'] } }])?.model).toBe('Veloz');
  });
  it('a make that is not the VIN’s own maker is not taken', () => {
    expect(stemCar('MHFAB1BY0R3011111', [{ ...veloz, make: 'Nissan' }])).toBeUndefined();
  });
});
