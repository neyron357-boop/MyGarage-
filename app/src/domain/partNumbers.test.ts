import { describe, expect, it } from 'vitest';
import { formatNumber, numberPlausible, sameNumber } from './partNumbers';

describe('part numbers as the makers write them', () => {
  it('knows the shape of each maker’s numbers', () => {
    expect(numberPlausible('Toyota', '04465-33480')).toBe(true);
    expect(numberPlausible('Toyota', '0446533480')).toBe(true);
    expect(numberPlausible('Toyota', '90915-YZZE1')).toBe(true);
    expect(numberPlausible('Toyota', '04465-3348')).toBe(false);
    expect(numberPlausible('Toyota', 'A0004209000')).toBe(false);
    expect(numberPlausible('Nissan', '15208-9E01A')).toBe(true);
    expect(numberPlausible('Hyundai', '28113-D3300')).toBe(true);
    expect(numberPlausible('Kia', '28113D3300')).toBe(true);
    expect(numberPlausible('Honda', '15400-PLM-A02')).toBe(true);
    expect(numberPlausible('Mercedes-Benz', 'A0004209000')).toBe(true);
    expect(numberPlausible('BMW', '34116761280')).toBe(true);
    expect(numberPlausible('BMW', '34 11 6 761 280')).toBe(true);
    expect(numberPlausible('Volkswagen', '1K0615301AA')).toBe(true);
    expect(numberPlausible('Ford', '7T4Z-2001-A')).toBe(true);
    expect(numberPlausible('Mitsubishi', 'MR968274')).toBe(true);
    expect(numberPlausible('Jeep', '68029887AA')).toBe(true);
    expect(numberPlausible('Land Rover', 'LR012345')).toBe(true);
    expect(numberPlausible('Mazda', 'PE01-14-302A')).toBe(true);
  });

  it('says nothing of a maker it does not know, and no to anything too short', () => {
    expect(numberPlausible('Geely', '1016050230')).toBeUndefined();
    expect(numberPlausible('', '04465-33480')).toBeUndefined();
    expect(numberPlausible('Geely', '1234')).toBe(false);
  });

  it('writes a number the maker’s way', () => {
    expect(formatNumber('Toyota', '0446533480')).toBe('04465-33480');
    expect(formatNumber('toyota', ' 04465 33480 ')).toBe('04465-33480');
    expect(formatNumber('Nissan', '152089E01A')).toBe('15208-9E01A');
    expect(formatNumber('Honda', '15400PLMA02')).toBe('15400-PLM-A02');
    expect(formatNumber('Mercedes', 'A0004209000')).toBe('A000 420 90 00');
    expect(formatNumber('BMW', '34116761280')).toBe('34 11 6 761 280');
    expect(formatNumber('Volkswagen', '1K0615301AA')).toBe('1K0 615 301 AA');
    // Not the maker's shape, or a maker not known: as given.
    expect(formatNumber('Toyota', 'A0004209000')).toBe('A0004209000');
    expect(formatNumber('Geely', '1016050230')).toBe('1016050230');
  });

  it('tells the same number however written', () => {
    expect(sameNumber('04465-33480', '0446533480')).toBe(true);
    expect(sameNumber('04465 33480', '04465-33480')).toBe(true);
    expect(sameNumber('04465-33480', '04465-33481')).toBe(false);
    expect(sameNumber('', '')).toBe(false);
  });
});
