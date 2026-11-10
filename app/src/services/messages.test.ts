import { describe, expect, it } from 'vitest';
import type { Customer, EstimateVersion, Order, SnapshotItem, Vehicle } from '../domain/types';
import { telegramChatUrl, versionMessage, whatsappUrl } from './messages';

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
    expect(text).toContain('• Oil change — 210.00 AED\n• Brake pads — 63.00 AED\n\nDiscount 10%: -32.30 AED\nTotal: 240.70 AED');
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
