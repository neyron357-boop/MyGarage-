import { describe, expect, it } from 'vitest';
import { fitsPrevious, formatKm, numbersIn, parseKm, pickOdometer, segNumbers, type OdoRead } from './odometer';

const read = (km: number, source: string, extra: Partial<OdoRead> = {}): OdoRead => ({ km, conf: 80, source, ...extra });

describe('the mileage off a dashboard photo (v0.44)', () => {
  it('a dashboard’s numbers: the odometer’s whole number, with its thousands however parted — not a time, tenths, degrees or a speed', () => {
    expect(numbersIn('ODO 123456 km')).toEqual([123456]);
    expect(numbersIn('123 456 km')).toEqual([123456]);
    expect(numbersIn('123,456km')).toEqual([123456]);
    expect(numbersIn('1.234.567')).toEqual([1234567]);
    expect(numbersIn('TRIP A 123.4 km')).toEqual([]);
    expect(numbersIn('12:45  24°C  80%')).toEqual([]);
    expect(numbersIn('120 km/h')).toEqual([]);
    expect(numbersIn('20 40 60 80')).toEqual([20, 40, 60, 80]);
    // A zero the reading took for an O.
    expect(numbersIn('ODO 12O456')).toEqual([120456]);
    expect(numbersIn('O45 km')).toEqual([45]);
  });

  it('two readings that agree on a long number by «km» — sure; a speedometer’s scale is not it', () => {
    const p = pickOdometer([read(120, 'page'), read(140, 'page'), read(87654, 'page', { label: true }), read(87654, 'line:0'), read(180, 'line:1')]);
    // The scale's numbers are not offered either.
    expect(p).toEqual({ km: 87654, sure: true, offered: [87654] });
  });

  it('nothing like a mileage read — nothing offered; a new car’s few hundred km only beside its last visit', () => {
    expect(pickOdometer([read(200, 'page'), read(200, 'line:0'), read(920, 'line:1')])).toEqual({ km: undefined, sure: false, offered: [] });
    expect(pickOdometer([read(450, 'page')], 150)).toMatchObject({ km: 450, offered: [450] });
  });

  it('a seven-segment row’s numbers: an unknown digit parts them — never read as thousands; a clock or a trip — none', () => {
    expect(segNumbers('087654')).toEqual([87654]);
    expect(segNumbers('123456?')).toEqual([123456]);
    expect(segNumbers('12?456')).toEqual([12, 456]);
    expect(segNumbers('12 456')).toEqual([12, 456]);
    expect(segNumbers('10:32')).toEqual([]);
    expect(segNumbers('345.6')).toEqual([]);
    expect(segNumbers('')).toEqual([]);
  });

  it('read once only, or two numbers alike — offered, not sure', () => {
    expect(pickOdometer([read(87654, 'page')])).toMatchObject({ km: 87654, sure: false });
    const two = pickOdometer([read(87654, 'page'), read(87654, 'line:0'), read(87054, 'line:1'), read(87054, 'line:2')]);
    expect(two.sure).toBe(false);
    expect(two.offered.slice(0, 2).sort()).toEqual([87054, 87654]);
    expect(pickOdometer([])).toEqual({ sure: false, offered: [] });
  });

  it('the last visit decides: less than then, or a lifetime more, is not the mileage now', () => {
    expect(fitsPrevious(120_500, 118_200)).toBe(true);
    expect(fitsPrevious(18_200, 118_200)).toBe(false);
    expect(fitsPrevious(418_200, 118_200)).toBe(false);
    // The trip meter's 18 250 reads as well as the odometer, twice each: the one that fits the last visit wins.
    const p = pickOdometer([read(18_250, 'page'), read(18_250, 'line:0'), read(123_460, 'page'), read(123_460, 'line:1')], 118_200);
    expect(p).toMatchObject({ km: 123_460, sure: true });
    // Only less than last time: offered, never sure.
    expect(pickOdometer([read(18_250, 'page'), read(18_250, 'line:0')], 118_200)).toMatchObject({ km: 18_250, sure: false });
  });

  it('typed and shown as it is said', () => {
    expect(formatKm(123456)).toBe('123 456');
    expect(formatKm(950)).toBe('950');
    expect(parseKm('123 456')).toBe(123456);
    expect(parseKm('123,456')).toBe(123456);
    expect(parseKm('')).toBeUndefined();
    expect(parseKm('12a')).toBeUndefined();
    expect(parseKm('99999999')).toBeUndefined();
  });
});
