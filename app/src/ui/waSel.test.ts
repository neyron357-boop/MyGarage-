import { describe, expect, it } from 'vitest';
import { shallow } from './waSel';

describe('shallow — a screen’s part of the WhatsApp store the same (v0.80.2)', () => {
  it('the same values, or objects of the same keys and values', () => {
    expect(shallow(3, 3)).toBe(true);
    expect(shallow(3, 4)).toBe(false);
    const list = [1];
    expect(shallow({ a: list, b: 'x' }, { a: list, b: 'x' })).toBe(true);
    expect(shallow({ a: list }, { a: [1] })).toBe(false);
    expect(shallow({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallow<unknown>(null, {})).toBe(false);
  });
});
