import { describe, expect, it } from 'vitest';
import { emirateIn, emirateLike, pickPlate, platesInLine, type PlateGuess } from './uaePlate';

const first = (text: string) => {
  const g = platesInLine(text)[0];
  return g && [g.emirate ?? '', g.code, g.number];
};

describe('a UAE plate in a line of reading (v0.28)', () => {
  it('the code and the number, however the reading spaced them', () => {
    expect(first('A 12345')).toEqual(['', 'A', '12345']);
    expect(first('A12345')).toEqual(['', 'A', '12345']);
    expect(first('B12345')).toEqual(['', 'B', '12345']);
    expect(first('AA 1234')).toEqual(['', 'AA', '1234']);
    expect(first('  Q 7  ')).toEqual(['', 'Q', '7']);
  });

  it('the emirate by its word, wherever it is on the plate', () => {
    expect(first('DUBAI A 12345')).toEqual(['DXB', 'A', '12345']);
    expect(first('A 12345 DUBA1')).toEqual(['DXB', 'A', '12345']);
    expect(first('SHARJAH 3 45678')).toEqual(['SHJ', '3', '45678']);
    expect(first('ABU DHABI 1 12345')).toEqual(['AUH', '1', '12345']);
    expect(first('AJMAN B 2345')).toEqual(['AJM', 'B', '2345']);
    expect(first('RAK 1 234')).toEqual(['RAK', '1', '234']);
    expect(emirateIn('U.A.E PRIVATE')).toBeUndefined();
  });

  it('look-alike letters in the number are its digits; the code stays letters', () => {
    expect(first('A 5O432')).toEqual(['', 'A', '50432']);
    expect(first('B I2345')).toEqual(['', 'B', '12345']);
    expect(first('D 8S0Z1')).toEqual(['', 'D', '85021']);
  });

  it('a number code run into the number (no gap read): the last five digits are the number', () => {
    expect(first('112345')).toEqual(['', '1', '12345']);
    expect(first('5012345')).toEqual(['', '50', '12345']);
  });

  it('the plate’s other words and marks are not the code', () => {
    expect(first('PRIVATE A 12345')).toEqual(['', 'A', '12345']);
    expect(first('U.A.E | A - 12345 .')).toEqual(['', 'A', '12345']);
  });

  it('an older plate: the number first, the code after it', () => {
    expect(first('12345 A')).toEqual(['', 'A', '12345']);
  });

  it('nothing that is no plate', () => {
    expect(platesInLine('TOYOTA')).toEqual([]);
    expect(platesInLine('LAND CRUISER')).toEqual([]);
    expect(platesInLine('')).toEqual([]);
    expect(platesInLine('0000')).toEqual([]);
  });

  it('a code with its number is a better guess than a number alone', () => {
    const [a] = platesInLine('A 12345');
    const [b] = platesInLine('12345');
    expect(a.score).toBeGreaterThan(b.score);
  });
});

describe('readings voted into one plate', () => {
  const g = (code: string, number: string, emirate?: PlateGuess['emirate']): PlateGuess => platesInLine(`${emirate === 'DXB' ? 'DUBAI ' : ''}${code} ${number}`).find((x) => x.number === number)!;

  it('two readings that agree: sure; one that missed the code still backs the number', () => {
    const p = pickPlate([{ guesses: [g('A', '12345')], confidence: 80 }, { guesses: platesInLine('12345'), confidence: 70 }]);
    expect(p).toMatchObject({ code: 'A', number: '12345', agree: 2, sure: true });
  });

  it('the number most readings give wins over a slip', () => {
    const p = pickPlate([
      { guesses: [g('A', '12345')], confidence: 80 },
      { guesses: [g('A', '12346')], confidence: 60 },
      { guesses: [g('A', '12345')], confidence: 75 },
    ]);
    expect(p).toMatchObject({ code: 'A', number: '12345', agree: 2, sure: true });
  });

  it('one reading alone: sure only when it is clean, with its code, and the reading was sure of it', () => {
    expect(pickPlate([{ guesses: [g('A', '12345')], confidence: 92 }])?.sure).toBe(true);
    expect(pickPlate([{ guesses: platesInLine('12345'), confidence: 92 }])?.sure).toBe(false);
    expect(pickPlate([{ guesses: [g('A', '12345')], confidence: 30 }])?.sure).toBe(false);
  });

  it('the emirate named by any reading', () => {
    const p = pickPlate([{ guesses: [g('A', '12345')] }, { guesses: platesInLine('DUBAI'), emirate: emirateIn('DUBAI') }, { guesses: [g('A', '12345', 'DXB')] }]);
    expect(p).toMatchObject({ emirate: 'DXB', code: 'A', number: '12345' });
  });

  it('a code guessed out of a run of digits backs no agreement on the code', () => {
    const p = pickPlate([{ guesses: platesInLine('412345'), confidence: 84 }, { guesses: platesInLine('4 12345'), confidence: 40 }]);
    expect(p).toMatchObject({ code: '4', number: '12345', codeAgree: 1 });
  });

  it('nothing read — nothing picked', () => {
    expect(pickPlate([])).toBeUndefined();
    expect(pickPlate([{ guesses: [] }])).toBeUndefined();
  });
});

describe('the emirate in a plate’s own lettering (v0.32)', () => {
  it('a slip of a letter is still the emirate; another word is not', () => {
    expect(emirateLike('DUBRI')).toBe('DXB');
    expect(emirateLike('OUBAI')).toBe('DXB');
    expect(emirateLike('DUBAL')).toBe('DXB');
    expect(emirateLike('SHARIAH')).toBe('SHJ');
    expect(emirateLike('ABU DHABL')).toBe('AUH');
    expect(emirateLike('WR')).toBeUndefined();
    expect(emirateLike('PATHFINDER')).toBeUndefined();
    expect(emirateLike('DUBAI')).toBe('DXB');
  });
});
