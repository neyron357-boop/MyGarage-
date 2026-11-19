import { describe, expect, it } from 'vitest';
import { vinBuilt } from './vin';

describe('where a VIN says the car was built', () => {
  it('reads the region off the first characters', () => {
    expect(vinBuilt('JTDBR42E39J016456')).toBe('Japan');
    expect(vinBuilt('4T1B11HK5JU123456')).toBe('USA');
    expect(vinBuilt('1N4AL3AP8JC123456')).toBe('USA');
    expect(vinBuilt('2T1BURHE0JC123456')).toBe('Canada');
    expect(vinBuilt('3N1AB7AP8JY123456')).toBe('Mexico');
    expect(vinBuilt('KMHD35LE2JU123456')).toBe('Korea');
    expect(vinBuilt('LVVDB11B8JD123456')).toBe('China');
    expect(vinBuilt('MR0FZ22G1J1123456')).toBe('Thailand');
    expect(vinBuilt('MALA841CBJM123456')).toBe('India');
    expect(vinBuilt('MHFXW4EY1J1123456')).toBe('Indonesia');
    expect(vinBuilt('WDDGF4HB1JR123456')).toBe('Germany');
    expect(vinBuilt('SALGA2EF2JA123456')).toBe('UK');
    expect(vinBuilt('VF1RFB00X61123456')).toBe('France');
    expect(vinBuilt('6T1BZ3FK70X123456')).toBe('Australia');
    expect(vinBuilt('YV1MK3FA0J1123456')).toBe('Sweden');
    expect(vinBuilt('ZFA1230000J123456')).toBe('Italy');
    expect(vinBuilt('NMTBA3BE20R123456')).toBe('Turkey');
    expect(vinBuilt('')).toBeUndefined();
  });
});
