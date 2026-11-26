import { describe, expect, it } from 'vitest';
import { barOf } from './stack';

const at = (path: string) => {
  const [pathname, q] = path.split('?');
  return { pathname, search: q ? `?${q}` : '' };
};

describe('barOf — what stays at the bottom under a screen (v0.80)', () => {
  it('the tab screens and the rest: the tab bar with «＋»', () => {
    for (const p of ['/', '/search', '/money', '/whatsapp', '/more', '/customers/c1', '/orders/o1/suppliers']) expect(barOf(at(p))).toBe('true');
  });
  it('a job: the whole screen with «＋» — its address’s other parts aside', () => {
    expect(barOf(at('/orders/o1'))).toBe('plus');
    expect(barOf(at('/orders/o1/intake'))).toBe('plus');
    expect(barOf(at('/orders/o1?side=new'))).toBe('plus');
  });
  it('a job’s notes, work at the car, a WhatsApp chat: nothing (the composer or the form at the bottom)', () => {
    // v0.90: no chat tab on a job — an old address with it is the job.
    expect(barOf(at('/orders/o1?tab=chat'))).toBe('plus');
    expect(barOf(at('/orders/o1?tab=notes&side=o2'))).toBe('false');
    expect(barOf(at('/orders/new'))).toBe('false');
    expect(barOf(at('/orders/o1/invoice'))).toBe('false');
    expect(barOf(at('/whatsapp/chat/123%40lid'))).toBe('false');
  });
});
