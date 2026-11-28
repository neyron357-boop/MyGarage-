import { describe, expect, it } from 'vitest';
import { vinCheckDigit } from './vin';
import { goesOn, looksLikeRequest, plateOf, requestPlan } from './waRequest';

// A made-up VIN of a Nissan built in the USA, its check digit put right.
const raw = '1N4AL3AP0FN000123';
const VIN = raw.slice(0, 8) + vinCheckDigit(raw) + raw.slice(9);

describe('a WhatsApp request (v0.90, #69)', () => {
  it('worth asking the AI only when a car is named and something is asked of it', () => {
    const models = new Set(['altima', 'patrol']);
    expect(looksLikeRequest(['I want to change engine mounting.', 'Nissan Altima 2015', 'Original or duplicate?'], models)).toBe(true);
    expect(looksLikeRequest(['my patrol makes noise, how much to check?'], models)).toBe(true);
    expect(looksLikeRequest([`VIN ${VIN}`, 'front brake pads'], models)).toBe(true);
    expect(looksLikeRequest(['Okay', 'Thank you'], models)).toBe(false);
    expect(looksLikeRequest(['How much for the engine mount?'], models)).toBe(false);
    expect(looksLikeRequest(['Nissan'], models)).toBe(false);
    // Audit 27/11: in Arabic too — a car named and something asked.
    expect(looksLikeRequest(['ابغى تغيير فحمات الفرامل كامري 2018'], models)).toBe(true);
    expect(looksLikeRequest(['كم سعر بطارية باترول'], models)).toBe(true);
    expect(looksLikeRequest(['شكرا'], models)).toBe(false);
  });

  it('v1.03: a piece that goes on with a request — work asked, no car of its own; a car of its own is a request of its own', () => {
    const models = new Set(['altima', 'patrol']);
    expect(goesOn(['Also change the front brake pads'], models)).toBe(true);
    expect(goesOn(['and the engine mount'], models)).toBe(true);
    expect(goesOn(['front brake pads too'], models)).toBe(true);
    expect(goesOn(['Okay', 'Thank you'], models)).toBe(false);
    expect(goesOn(['thanks bro'], models)).toBe(false);
    expect(goesOn(['Patrol DXB A 77777 needs AC service'], models)).toBe(false);
    expect(goesOn([''], models)).toBe(false);
  });

  it('the plate only whole', () => {
    expect(plateOf({ emirate: 'Dubai', code: 'v', number: '12345' })).toEqual({ emirate: 'DXB', code: 'V', number: '12345' });
    expect(plateOf({ emirate: 'SHJ', code: '3', number: '4567' })).toEqual({ emirate: 'SHJ', code: '3', number: '4567' });
    expect(plateOf({ emirate: '', code: 'V', number: '12345' })).toBeUndefined();
    expect(plateOf({ emirate: 'DXB', code: '', number: '12345' })).toBeUndefined();
    expect(plateOf({ emirate: 'DXB', code: 'V', number: '1234567' })).toBeUndefined();
    expect(plateOf(undefined)).toBeUndefined();
  });

  it('what is taken: original and duplicate — two lines and two options; the VIN only with its check digit', () => {
    const plan = requestPlan({
      isRequest: true,
      car: { make: 'Nissan', model: 'Altima', year: 2015, plate: { emirate: 'DXB', code: 'V', number: '12345' }, vin: VIN },
      items: [
        { name: 'engine mount full set', kind: 'part', both: true },
        { name: 'Wheel alignment', kind: 'work' },
      ],
      owner: 'Sam',
      confidence: 0.9,
    })!;
    expect(plan.lines).toEqual([
      { titleEn: 'ENGINE MOUNT FULL SET ORIGINAL', kind: 'part', side: 'original' },
      { titleEn: 'ENGINE MOUNT FULL SET AFTERMARKET', kind: 'part', side: 'copy' },
      { titleEn: 'WHEEL ALIGNMENT', kind: 'labor' },
    ]);
    expect([plan.make, plan.model, plan.year, plan.vin, plan.options, plan.owner]).toEqual(['Nissan', 'Altima', 2015, VIN, true, 'Sam']);
    const wrong = VIN.slice(0, 16) + (VIN[16] === '1' ? '2' : '1');
    expect(requestPlan({ isRequest: true, car: { make: 'Nissan', model: 'Altima', vin: wrong }, items: [{ name: 'radiator', kind: 'part' }], confidence: 0.9 })!.vin).toBeUndefined();
    // Of another make — not this car's VIN.
    expect(requestPlan({ isRequest: true, car: { make: 'Toyota', model: 'Corolla', vin: VIN }, items: [{ name: 'radiator', kind: 'part' }], confidence: 0.9 })!.vin).toBeUndefined();
  });

  it('not a request, not sure, nothing asked, a make that is no maker — nothing or no car', () => {
    expect(requestPlan({ isRequest: false, items: [{ name: 'x', kind: 'part' }], confidence: 0.9 })).toBeUndefined();
    expect(requestPlan({ isRequest: true, items: [{ name: 'radiator', kind: 'part' }], confidence: 0.4 })).toBeUndefined();
    expect(requestPlan({ isRequest: true, items: [], confidence: 0.9 })).toBeUndefined();
    const odd = requestPlan({ isRequest: true, car: { make: 'Engine', model: 'Mount', year: 1890 }, items: [{ name: 'radiator', kind: 'part' }], confidence: 0.9 })!;
    expect([odd.make, odd.model, odd.year, odd.options]).toEqual(['', '', undefined, false]);
  });
});
