import { describe, expect, it } from 'vitest';
import { matchPartName, partKey } from './partsVocab';

describe('the dictionary of part names', () => {
  it('knows a name typed right, in Russian or English, in any word order, and names it in English', () => {
    expect(matchPartName('колодки тормозные передние')).toEqual({ fixed: 'КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', english: 'FRONT BRAKE PADS', known: true, changed: false });
    expect(matchPartName('передние тормозные колодки').english).toBe('FRONT BRAKE PADS');
    expect(matchPartName('Масляный фильтр').english).toBe('OIL FILTER');
    expect(matchPartName('фильтр масла').english).toBe('OIL FILTER');
    expect(matchPartName('front brake pads')).toMatchObject({ english: 'FRONT BRAKE PADS', known: true, changed: false });
    expect(matchPartName('brake pad front').english).toBe('FRONT BRAKE PADS');
    expect(matchPartName('Brake Discs Front').english).toBe('FRONT BRAKE DISCS');
    expect(matchPartName('помпа').english).toBe('WATER PUMP');
    expect(matchPartName('свечи зажигания').english).toBe('SPARK PLUGS');
    expect(matchPartName('аккумулятор').english).toBe('BATTERY');
  });

  it('puts typing mistakes right — a letter or two in a word — and keeps the words and their order', () => {
    expect(matchPartName('колодки тормазные пердние')).toEqual({ fixed: 'КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ', english: 'FRONT BRAKE PADS', known: true, changed: true });
    expect(matchPartName('alternater belt')).toEqual({ fixed: 'ALTERNATOR BELT', english: 'ALTERNATOR BELT', known: true, changed: true });
    expect(matchPartName('oil fliter')).toMatchObject({ fixed: 'OIL FILTER', english: 'OIL FILTER', changed: true });
    expect(matchPartName('амартизатор задний')).toMatchObject({ fixed: 'АМОРТИЗАТОР ЗАДНИЙ', english: 'REAR SHOCK ABSORBERS', changed: true });
    // The ending is the manager's: only the stem is put right.
    expect(matchPartName('тормазных колодок').fixed).toBe('ТОРМОЗНЫХ КОЛОДОК');
  });

  it('keeps numbers, sizes and side words, and says the side after the English name', () => {
    expect(matchPartName('фара левая')).toMatchObject({ fixed: 'ФАРА ЛЕВАЯ', english: 'HEADLIGHT LH', known: true });
    expect(matchPartName('headlight rh')).toMatchObject({ english: 'HEADLIGHT RH' });
    expect(matchPartName('шина 265/65 R17')).toMatchObject({ fixed: 'ШИНА 265/65 R17', english: 'TYRE', known: true });
    expect(matchPartName('комплект сцепления').english).toBe('CLUTCH KIT');
  });

  it('does not know what it does not know — the AI’s turn — and never renames', () => {
    expect(matchPartName('флюгер карбюратора').known).toBe(false);
    expect(matchPartName('xyzzy bracket').known).toBe(false);
    // Known words that name no part together: the words are still put right, no English name is made up.
    expect(matchPartName('radiator pads')).toMatchObject({ known: true, english: '' });
    expect(matchPartName('')).toMatchObject({ known: false });
  });

  it('gives one key to one part, whatever the words («колодки передние» and «FRONT BRAKE PADS» are one line)', () => {
    expect(partKey('колодки передние')).toBe('FRONT BRAKE PADS');
    expect(partKey('Front Brake Pads')).toBe('FRONT BRAKE PADS');
    expect(partKey('FRONT BRAKE PADS LH')).toBe('FRONT BRAKE PADS');
    expect(partKey('flux capacitor')).toBe('FLUX CAPACITOR');
  });
});
