import { describe, expect, it } from 'vitest';
import { chatLinkNumber } from '../domain/supplierBook';
import { partsRequestText, whatsappUrl } from './messages';

// v0.61.1: the list to a supplier goes by lines and lands in WhatsApp by itself (not pasted into a caption).
describe('the parts request to a supplier', () => {
  const car = { make: 'Toyota', model: 'Camry', year: 2018, vin: 'JTNB11HK5J3012345' };
  const parts = [
    { titleEn: 'front brake pads', partNumber: ' 04465-33471 ', qty: 1 },
    { titleEn: '', titleRu: 'Наконечник рулевой тяги', qty: 2 },
  ];

  it('a line a part, the car in bold, the question last', () => {
    expect(partsRequestText(car, parts)).toBe(
      [
        '*Toyota Camry 2018*',
        'VIN: JTNB11HK5J3012345',
        '',
        '1. FRONT BRAKE PADS (04465-33471)',
        '2. НАКОНЕЧНИК РУЛЕВОЙ ТЯГИ × 2',
        '',
        'Price and availability, please: original / aftermarket?',
      ].join('\n'),
    );
  });

  it('with the sheets — their numbers are the list’s', () => {
    const text = partsRequestText(car, parts, { diagrams: true });
    expect(text.split('\n').slice(-2)).toEqual(['Diagrams in the photos — the same numbers.', 'Price and availability, please: original / aftermarket?']);
  });

  it('no car known — the list first, no blank line before it', () => {
    expect(partsRequestText({ make: '', model: '' }, parts.slice(0, 1))).toBe('1. FRONT BRAKE PADS (04465-33471)\n\nPrice and availability, please: original / aftermarket?');
  });

  it('the link keeps the lines', () => {
    const url = whatsappUrl('+971501234567', partsRequestText(car, parts));
    expect(url).toMatch(/^https:\/\/wa\.me\/971501234567\?text=/);
    expect(decodeURIComponent(url.split('?text=')[1]).split('\n')).toHaveLength(7);
  });

  it('a supplier’s own WhatsApp link: its number, so the list can go with it', () => {
    expect(chatLinkNumber('https://wa.me/971551112233')).toBe('+971551112233');
    expect(chatLinkNumber('https://wa.me/message/ABCDEF')).toBeUndefined();
  });
});
