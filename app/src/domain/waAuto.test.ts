import { describe, expect, it } from 'vitest';
import { bossText, clientText, isWash, waAutoOf, washText, workText, WA_AUTO } from './waAuto';

const car = { make: 'Toyota', model: 'Camry', year: 2019, plate: { emirate: 'DXB' as const, code: 'A', number: '12345' } };

describe('the settings', () => {
  it('kept in part: the rest are the defaults; numbers kept within reason', () => {
    const s = waAutoOf({ boss: { to: { chat: '971500000001@c.us', name: 'Boss' }, expense: false }, ask: { gapSec: 1, max: 99 }, wash: { words: [' ', ''] }, client: { photos: 9 } });
    expect(s.boss.to?.name).toBe('Boss');
    expect(s.boss.expense).toBe(false);
    expect(s.boss.invoice).toBe(true);
    expect(s.ask.gapSec).toBe(3);
    expect(s.ask.max).toBe(30);
    expect(s.wash.words).toEqual(WA_AUTO.wash.words);
    expect(s.client.photos).toBe(4);
    expect(waAutoOf(undefined)).toEqual(WA_AUTO);
  });
});

describe('the wash', () => {
  it('a line named so, by whole words — a washer is a part', () => {
    expect(isWash('CAR WASH')).toBe(true);
    expect(isWash('FULL CAR WASH + INTERIOR')).toBe(true);
    expect(isWash('мойка кузова')).toBe(true);
    expect(isWash('WINDSHIELD WASHER PUMP')).toBe(false);
    expect(isWash('ENGINE OIL')).toBe(false);
    expect(isWash('POLISH', ['polish'])).toBe(true);
  });
  it('its words: the caption asked for, the plate if asked', () => {
    expect(washText({ car }, 'en', { caption: 'CAR WASH', plate: false })).toBe('CAR WASH');
    expect(washText({ car }, 'en', { caption: '', plate: true })).toBe('CAR WASH\nDubai A 12345');
  });
});

describe('the reports', () => {
  const lines = [{ title: 'BRAKE PADS FRONT', qty: 2 }, { title: 'OIL SERVICE' }];
  it('the work group: the car, what to do, who — never a price', () => {
    const t = workText({ car, number: 358, complaint: 'Noise from the front', lines, mechanics: ['Rashid', 'Imran'], trigger: 'agreed' }, 'en', { complaint: true, lines: true, mechanics: true });
    expect(t).toBe('*Toyota Camry 2019* · Dubai A 12345\nJob #358 · Agreed — to do\nComplaint: Noise from the front\n\nTo do:\n1. BRAKE PADS FRONT × 2\n2. OIL SERVICE\n\nMechanics: Rashid, Imran');
    expect(t).not.toMatch(/AED|\d+\.\d\d/);
    const only = workText({ car, number: 358, complaint: 'x', lines, mechanics: [], trigger: 'checkin' }, 'ru', { complaint: false, lines: false, mechanics: true });
    expect(only).toBe('*Toyota Camry 2019* · Дубай A 12345\nЗаказ #358 · Машина принята');
  });

  it("a company's group: the car, the day, the driver, the mileage, the work — no prices", () => {
    const t = clientText({ car, day: '2026-11-24', driver: 'Ahmed', mileageKm: 123456, lines }, 'en', { driver: true, mileage: true, lines: true, complaint: false });
    expect(t).toBe('*Toyota Camry 2019* · Dubai A 12345\nDate: 24/11/2026\nDriver: Ahmed\nMileage: 123,456 km\n\nWork:\n• BRAKE PADS FRONT × 2\n• OIL SERVICE');
    expect(clientText({ car, day: '2026-11-24', lines }, 'en', { driver: true, mileage: true, lines: false, complaint: false })).toBe('*Toyota Camry 2019* · Dubai A 12345\nDate: 24/11/2026');
  });

  it('the boss: what happened to the money', () => {
    expect(bossText({ kind: 'invoice', number: 'INV-2026-358', car, customer: 'Ali Hassan', total: 47250, jobNumber: 358 }, 'en')).toBe('🧾 *Invoice INV-2026-358* · 472.50 AED\nJob #358 · *Toyota Camry 2019* · Dubai A 12345\nCustomer: Ali Hassan');
    expect(bossText({ kind: 'payment', amount: 20000, method: 'cash', car, customer: 'Ali', jobNumber: 358, due: 27250 }, 'en')).toBe('💵 *Payment received* · 200.00 AED · Cash\nJob #358 · *Toyota Camry 2019* · Dubai A 12345\nCustomer: Ali\nStill due: 272.50 AED');
    expect(bossText({ kind: 'payment', amount: 47250, method: 'card', customer: 'Ali', due: 0 }, 'en')).toBe('💵 *Payment received* · 472.50 AED · Card\nCustomer: Ali\nPaid in full');
    expect(bossText({ kind: 'expense', amount: 12000, method: 'cash', category: 'Parts', vendor: 'Al Noor Auto', jobNumber: 358, car }, 'en')).toBe('💸 *Expense* · 120.00 AED · Cash\nParts · Al Noor Auto\nFor: Job #358 · *Toyota Camry 2019* · Dubai A 12345');
    expect(bossText({ kind: 'expense', amount: 30000, method: 'cash', category: 'Parts', parts: [{ method: 'cash', amount: 10000 }, { method: 'credit', amount: 20000 }] }, 'en').split('\n')[0]).toBe('💸 *Expense* · 300.00 AED · Cash 100.00 AED + On credit 200.00 AED');
    expect(bossText({ kind: 'income', amount: 100000, method: 'transfer', what: 'Debt payment', customer: 'ABC Transport', debt: true }, 'en')).toBe('💵 *Debt payment* · 1,000.00 AED · Transfer\nCustomer: ABC Transport');
    const est = bossText({ kind: 'estimate', number: 358, version: 2, car, customer: 'Ali', lines: [{ title: 'BRAKE PADS FRONT', gross: 47250 }], total: 47250 }, 'ru');
    expect(est.split('\n')[0]).toBe('📋 *Смета v2* · 472,50 AED');
    expect(est).toContain('1. BRAKE PADS FRONT — 472,50 AED');
  });
});
