import { describe, expect, it } from 'vitest';
import { nameCount, qtyShort } from './sides';

describe('how many a part’s name asks for (v0.70)', () => {
  it('both sides — two', () => {
    for (const name of ['STEERING BOOT LEFT & RIGHT', 'FRONT LINK ROD LEFT AND RIGHT', 'Tie rod end L/R', 'Mirror LH+RH', 'HEADLAMP R.H & L.H', 'Door handle both sides', 'Wiper blade pair', 'Brake pads front & rear', 'Пыльник ШРУСа левый и правый', 'Рычаг лев/прав', 'Опора — обе стороны', 'Свечи пара'])
      expect([name, nameCount(name)]).toEqual([name, 2]);
  });
  it('a count said — that many', () => {
    expect(nameCount('SPARK PLUG X4')).toBe(4);
    expect(nameCount('WHEEL BOLT 20 PCS')).toBe(20);
    expect(nameCount('INJECTOR SET OF 6')).toBe(6);
    expect(nameCount('TYRE ALL FOUR')).toBe(4);
    expect(nameCount('Колпачки 4 шт')).toBe(4);
  });
  it('a side alone, a set, numbers that are not a count — nothing', () => {
    for (const name of ['FRONT SHOCK ABSORBER LH', 'BRAKE PADS (SET)', 'ENGINE MOUNT FULL SET', 'ENGINE OIL 5W-30', 'CHANGE OIL & FILTER (10K KILOMETERS)', '4X4 ACTUATOR', 'BATTERY (12 MONTHS WARRANTY)', 'AC PIPE BIG', 'RIGHT FENDER', 'ТОРМОЗНЫЕ КОЛОДКИ ПЕРЕДНИЕ'])
      expect([name, nameCount(name)]).toEqual([name, undefined]);
  });
});

describe('a part short of what its name says (v0.70)', () => {
  const part = { kind: 'part' as const, titleEn: 'STEERING BOOT LEFT & RIGHT', qty: 1 };
  it('one of «left & right»: two asked', () => expect(qtyShort(part)).toBe(2));
  it('two of them, or the price said to be for both, or the customer’s own, or work: nothing', () => {
    expect(qtyShort({ ...part, qty: 2 })).toBeUndefined();
    expect(qtyShort({ ...part, qtyNoted: 2 })).toBeUndefined();
    expect(qtyShort({ ...part, customerSupplied: true })).toBeUndefined();
    expect(qtyShort({ ...part, kind: 'labor' })).toBeUndefined();
  });
  it('the price said for two, the name now asking for four: asked again', () => expect(qtyShort({ ...part, titleEn: 'TYRES X4', qtyNoted: 2 })).toBe(4));
});
