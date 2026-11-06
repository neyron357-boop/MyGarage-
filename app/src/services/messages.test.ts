import { describe, expect, it } from 'vitest';
import { telegramChatUrl, whatsappUrl } from './messages';

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
