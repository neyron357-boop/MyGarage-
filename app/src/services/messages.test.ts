import { describe, expect, it } from 'vitest';
import type { Customer, EstimateVersion, Order, OrderItem, SnapshotItem, Vehicle } from '../domain/types';
import { jobShareText, linesText, partNamesText, telegramChatUrl, versionMessage, whatsappUrl } from './messages';

describe('quotation message', () => {
  it('names the discount once, right before the total', () => {
    const line = (title: string, gross: number, kind: SnapshotItem['kind'] = 'labor'): SnapshotItem => ({ itemId: title, kind, block: 'A', title, qty: 1, unit: 'pcs', net: gross, vat: 0, gross });
    const v = {
      number: 1,
      language: 'en',
      items: [line('Oil change', 21000), line('Discount 10%', -2730, 'discount'), line('Brake pads', 6300, 'part'), line('Discount 10%', -500, 'discount')],
      fixedGross: 24070,
      maxGross: 24070,
      recommendedGross: 0,
      validUntil: '2026-11-17T08:00:00.000Z',
    } as EstimateVersion;
    const ctx = { customer: { name: 'Musa Khan' } as Customer, vehicle: { make: 'Nissan', model: 'Sunny', plate: { emirate: 'DXB', code: 'A', number: '12345' } } as Vehicle, order: { number: 7 } as Order, garageName: 'G' };
    const text = versionMessage(ctx, v);
    expect(text).toContain('• OIL CHANGE — 210.00 AED\n• BRAKE PADS — 63.00 AED\n\nDiscount 10%: -32.30 AED\nTotal: 240.70 AED');
  });
});

describe('the lines as text (copy)', () => {
  it('lists the car, the numbered lines with amounts, the discount and the total', () => {
    const item = (o: Partial<OrderItem>) => ({ kind: 'labor', qty: 1, unitPriceFils: 0, vatRateBp: 500, approvalState: 'draft', ...o }) as OrderItem;
    const text = linesText({ make: 'Honda', model: 'Accord', year: 2017, plate: { emirate: 'DXB', code: 'R', number: '7720' } }, [
      item({ titleEn: 'Front brake pads replacement', unitPriceFils: 10000 }),
      item({ kind: 'part', titleEn: 'Front brake pads (set)', qty: 2, unitPriceFils: 3000 }),
      item({ kind: 'part', titleEn: 'Oil filter' }),
    ], 'en');
    expect(text).toBe('Honda Accord 2017 · Dubai R 7720\n\n1. FRONT BRAKE PADS REPLACEMENT — 105.00 AED\n2. FRONT BRAKE PADS (SET) (2 × 31.50 AED) — 63.00 AED\n3. OIL FILTER — ?\n\nTotal: 168.00 AED (VAT 8.00 AED)');
  });
});

describe('the parts as text (copy)', () => {
  const item = (o: Partial<OrderItem>) => ({ kind: 'part', qty: 1, unitPriceFils: 5000, vatRateBp: 500, approvalState: 'draft', ...o }) as OrderItem;
  const lines = [item({ titleEn: 'Engine belt' }), item({ kind: 'labor', titleEn: 'Belt replacement' }), item({ titleEn: 'Spark plug', qty: 4 }), item({ titleRu: 'Ролик натяжителя' })];
  it('the car and its VIN on top, then the part names numbered, how many when more than one — no prices, no work', () => {
    expect(partNamesText(lines, 'en', { make: 'Honda', model: 'Civic', year: 2010, vin: 'jhmfd1671as402297' })).toBe(
      'Honda Civic 2010\nVIN JHMFD1671AS402297\n\n1. ENGINE BELT\n2. SPARK PLUG × 4\n3. РОЛИК НАТЯЖИТЕЛЯ',
    );
  });
  it('without a VIN or a year: what is known; with nothing known of the car — the parts alone', () => {
    expect(partNamesText(lines, 'en', { make: 'Honda', model: 'Civic' })).toBe('Honda Civic\n\n1. ENGINE BELT\n2. SPARK PLUG × 4\n3. РОЛИК НАТЯЖИТЕЛЯ');
    expect(partNamesText(lines, 'en', { make: '', model: '' })).toBe('1. ENGINE BELT\n2. SPARK PLUG × 4\n3. РОЛИК НАТЯЖИТЕЛЯ');
  });
});

describe('the job for the garage group', () => {
  it('the car, the customer by name only, the lines with amounts and the total', () => {
    const item = (o: Partial<OrderItem>) => ({ kind: 'labor', qty: 1, unitPriceFils: 0, vatRateBp: 500, approvalState: 'draft', ...o }) as OrderItem;
    const car = { make: 'Toyota', model: 'Camry', plate: { emirate: 'DXB', code: 'B', number: '213131' } } as Vehicle;
    const lines = [item({ titleEn: 'Oil change', unitPriceFils: 8000 }), item({ kind: 'part', titleEn: 'Brake pads', qty: 2, unitPriceFils: 5000 })];
    expect(jobShareText(car, { name: 'Nakash', type: 'individual' } as Customer, lines, 'ru')).toBe(
      'Toyota Camry · Дубай B 213131\nКлиент: Nakash\n\n1. OIL CHANGE — 84,00 AED\n2. BRAKE PADS (2 × 52,50 AED) — 105,00 AED\n\nИтого: 189,00 AED (VAT 9,00 AED)',
    );
    // A company by its name; no name — no line for it (and never the phone).
    expect(jobShareText(car, { name: 'Ali', type: 'company', companyName: 'Jaggie Trading' } as Customer, lines, 'en').split('\n')[1]).toBe('Customer: Jaggie Trading');
    expect(jobShareText(car, { name: '', type: 'individual', phone: '+971501234567' } as Customer, lines, 'en')).not.toMatch(/Customer|971/);
    // What the customer complains of, under the name — when it was written down.
    expect(jobShareText(car, { name: 'Nakash', type: 'individual' } as Customer, lines, 'ru', '  Стук спереди при торможении ').split('\n').slice(0, 4)).toEqual([
      'Toyota Camry · Дубай B 213131',
      'Клиент: Nakash',
      'Жалоба: Стук спереди при торможении',
      '',
    ]);
    expect(jobShareText(car, { name: '', type: 'individual' } as Customer, lines, 'en', 'AC not cooling').split('\n')[1]).toBe('Complaint: AC not cooling');
    expect(jobShareText(car, { name: 'Nakash', type: 'individual' } as Customer, lines, 'en', '   ')).not.toMatch(/Complaint/);
  });
});

describe('contact links', () => {
  it('opens the customer chat in Telegram by username or phone', () => {
    expect(telegramChatUrl('+971501234567', '@ivan_petrov')).toBe('https://t.me/ivan_petrov');
    expect(telegramChatUrl('+971501234567', 'ivan_petrov')).toBe('https://t.me/ivan_petrov');
    expect(telegramChatUrl('+971501234567')).toBe('https://t.me/+971501234567');
    expect(telegramChatUrl('+971501234567', '+971 55 987 6543')).toBe('https://t.me/+971559876543');
  });

  it('builds WhatsApp links with digits only', () => {
    expect(whatsappUrl('+971501234567', 'Привет')).toBe('https://wa.me/971501234567?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82');
  });
});
